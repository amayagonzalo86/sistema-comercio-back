import { Inject, Injectable, Logger } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { recordAudit } from '../../../common/audit/audit';
import { localDayRange, tenantTimeZone } from '../../../common/time/local-day-range';
import { SecretBox } from '../../fiscal/arca/secrets';
import { localToday } from '../../reports/domain/period';
import { SalesOrderEntity } from '../../sales/orders/entities/sales-order.entity';
import {
  AiConversationChannel,
  AiConversationEntity,
  AiConversationStatus,
  AiMessageEntity,
  AiMessageRole,
  AiSalesSettingsEntity,
} from '../entities/ai-sales.entities';
import { AiChatMessage, AiToolCall, AllAiProvidersFailedError } from '../providers/ai-provider.types';
import { AiRouter } from '../providers/ai-router';
import { WHATSAPP_CLIENT, WhatsAppClient } from '../whatsapp/whatsapp.client';
import { AiSalesToolbox } from './ai-sales.tools';
import { buildSystemPrompt } from './system-prompt';

/** Iteraciones máximas modelo → herramienta por turno (evita bucles y gasto descontrolado). */
const MAX_TOOL_ROUNDS = 6;
/** Mensajes de historial que se le pasan al modelo. */
const HISTORY_WINDOW = 40;
/** Una conversación sigue abierta si el cliente escribió en las últimas 24 h (ventana de atención de WhatsApp). */
const CONVERSATION_WINDOW_MS = 24 * 60 * 60 * 1000;
const LEASE_MS = 120_000;
const MAX_TOOL_RESULT_CHARS = 5_000;

export const HANDOFF_MESSAGE = 'En este momento no puedo seguir con tu consulta. Ya le aviso a una persona del local para que te responda por acá en breve. ¡Gracias por la paciencia! 🙏';
export const NON_TEXT_MESSAGE = 'Por ahora solo puedo leer mensajes de texto 🙂 ¿Me lo escribís, por favor?';

export interface IncomingCustomerMessage {
  channel: AiConversationChannel;
  contactPhone: string;
  contactName?: string | null;
  /** null = el cliente mandó algo que no es texto (audio, foto…). */
  text: string | null;
  waMessageId?: string | null;
  createdByUserId?: string | null;
  /** Para el simulador: conversación ya existente. */
  conversationId?: string | null;
}

export interface AgentReply {
  conversationId: string;
  replies: string[];
  status: AiConversationStatus;
  duplicate?: boolean;
}

interface StoredToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

/** Abre el token de WhatsApp guardado cifrado (misma clave que los secretos fiscales). */
export function secretBox(): SecretBox {
  return new SecretBox(process.env.FISCAL_ENCRYPTION_KEY || process.env.JWT_ACCESS_SECRET || '');
}

/**
 * Vendedor IA: guarda el mensaje del cliente, toma la conversación (un solo proceso a la vez por conversación),
 * consulta al modelo con las herramientas y responde por WhatsApp.
 */
@Injectable()
export class AiSalesAgent {
  private readonly logger = new Logger(AiSalesAgent.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly router: AiRouter,
    private readonly toolbox: AiSalesToolbox,
    @Inject(WHATSAPP_CLIENT) private readonly whatsapp: WhatsAppClient,
  ) {}

  /** Registra el mensaje entrante y lo procesa. Devuelve las respuestas enviadas (vacío si otro proceso lo atiende). */
  async receive(tenantId: string, settings: AiSalesSettingsEntity, incoming: IncomingCustomerMessage): Promise<AgentReply> {
    const conversation = await this.resolveConversation(tenantId, incoming);
    const content = incoming.text?.trim() || `[El cliente envió un mensaje que no es texto]`;
    try {
      await this.dataSource.getRepository(AiMessageEntity).insert({
        tenantId,
        conversationId: conversation.id,
        role: AiMessageRole.CUSTOMER,
        content: content.slice(0, 4000),
        waMessageId: incoming.waMessageId ?? null,
        processed: false,
        authorUserId: incoming.createdByUserId ?? null,
      });
    } catch (error) {
      // Meta reintenta los webhooks: el mismo wamid ya se registró.
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        return { conversationId: conversation.id, replies: [], status: conversation.status, duplicate: true };
      }
      throw error;
    }
    await this.dataSource.getRepository(AiConversationEntity).update(
      { id: conversation.id, tenantId },
      { lastMessageAt: new Date(), ...(incoming.contactName && !conversation.contactName ? { contactName: incoming.contactName.slice(0, 150) } : {}) },
    );

    if (incoming.text === null && conversation.status === AiConversationStatus.ACTIVE) {
      await this.markProcessed(tenantId, conversation.id);
      await this.reply(tenantId, settings, conversation, NON_TEXT_MESSAGE, null);
      return { conversationId: conversation.id, replies: [NON_TEXT_MESSAGE], status: conversation.status };
    }
    return this.process(tenantId, settings, conversation.id);
  }

  /** Procesa los mensajes pendientes con un «alquiler» de la conversación para no responder dos veces. */
  async process(tenantId: string, settings: AiSalesSettingsEntity, conversationId: string): Promise<AgentReply> {
    const replies: string[] = [];
    let status = AiConversationStatus.ACTIVE;
    for (let pass = 0; pass < 5; pass += 1) {
      if (!(await this.acquire(tenantId, conversationId))) break;
      try {
        const outcome = await this.runTurn(tenantId, settings, conversationId);
        replies.push(...outcome.replies);
        status = outcome.status;
      } finally {
        await this.release(tenantId, conversationId);
      }
      // Si el cliente escribió mientras se procesaba, se atiende en otra vuelta.
      const pending = await this.dataSource.getRepository(AiMessageEntity).count({
        where: { tenantId, conversationId, role: AiMessageRole.CUSTOMER, processed: false },
      });
      if (pending === 0) break;
    }
    const conversation = await this.dataSource.getRepository(AiConversationEntity).findOne({ where: { id: conversationId, tenantId } });
    return { conversationId, replies, status: conversation?.status ?? status };
  }

  private async runTurn(tenantId: string, settings: AiSalesSettingsEntity, conversationId: string): Promise<{ replies: string[]; status: AiConversationStatus }> {
    const conversationRepo = this.dataSource.getRepository(AiConversationEntity);
    const messageRepo = this.dataSource.getRepository(AiMessageEntity);
    const conversation = await conversationRepo.findOne({ where: { id: conversationId, tenantId } });
    if (!conversation) return { replies: [], status: AiConversationStatus.CLOSED };
    const pending = await messageRepo.find({
      where: { tenantId, conversationId, role: AiMessageRole.CUSTOMER, processed: false },
      select: { id: true },
    });
    if (pending.length === 0) return { replies: [], status: conversation.status };
    const pendingIds = pending.map((message) => message.id);

    // Atiende una persona (o está cerrada / el asistente apagado): el mensaje queda para el panel.
    if (
      conversation.status === AiConversationStatus.HANDOFF ||
      conversation.status === AiConversationStatus.CLOSED ||
      !settings.enabled
    ) {
      await this.markProcessed(tenantId, conversationId, pendingIds);
      return { replies: [], status: conversation.status };
    }

    if (!this.router.configured) {
      await this.markProcessed(tenantId, conversationId, pendingIds);
      await this.handoff(tenantId, conversation, 'No hay proveedores de IA configurados en el servidor.');
      await this.reply(tenantId, settings, conversation, HANDOFF_MESSAGE, null);
      return { replies: [HANDOFF_MESSAGE], status: AiConversationStatus.HANDOFF };
    }

    if (await this.dailyLimitReached(tenantId, settings)) {
      await this.markProcessed(tenantId, conversationId, pendingIds);
      await this.handoff(tenantId, conversation, `Se alcanzó el límite diario de ${settings.dailyMessageLimit} respuestas del asistente.`);
      await this.reply(tenantId, settings, conversation, HANDOFF_MESSAGE, null);
      return { replies: [HANDOFF_MESSAGE], status: AiConversationStatus.HANDOFF };
    }

    const system = await this.systemPrompt(tenantId, settings, conversation);
    const tools = this.toolbox.definitions(settings);
    const history = await this.history(tenantId, conversationId);
    const usage = { inputTokens: 0, outputTokens: 0 };
    let provider: string | null = null;
    let model: string | null = null;
    let finalText = '';

    try {
      for (let round = 0; round < MAX_TOOL_ROUNDS; round += 1) {
        const result = await this.router.chat({ system, messages: history, tools, maxTokens: 800 });
        usage.inputTokens += result.usage.inputTokens;
        usage.outputTokens += result.usage.outputTokens;
        provider = result.provider;
        model = result.model;
        if (result.toolCalls.length === 0) {
          finalText = result.text;
          break;
        }
        const calls = result.toolCalls.slice(0, 5);
        history.push({ role: 'assistant', content: result.text, toolCalls: calls });
        for (const call of calls) {
          const outcome = await this.toolbox.execute({ tenantId, settings, conversation }, call);
          const content = compactResult(outcome.result);
          await this.storeToolCall(tenantId, conversationId, call, content);
          history.push({ role: 'tool', toolCallId: call.id, name: call.name, content });
        }
      }
    } catch (error) {
      if (!(error instanceof AllAiProvidersFailedError)) throw error;
      this.logger.warn(`Vendedor IA sin proveedores disponibles (${tenantId}): ${error.message}`);
      await this.markProcessed(tenantId, conversationId, pendingIds);
      if (conversation.status === AiConversationStatus.ACTIVE || conversation.status === AiConversationStatus.ORDER_PLACED) {
        await this.handoff(tenantId, conversation, 'La IA no está disponible (sin crédito o sin respuesta de todos los proveedores).');
      }
      await this.reply(tenantId, settings, conversation, HANDOFF_MESSAGE, null);
      return { replies: [HANDOFF_MESSAGE], status: AiConversationStatus.HANDOFF };
    }

    if (!finalText.trim()) {
      finalText = conversation.status === AiConversationStatus.HANDOFF
        ? 'Listo, ya le avisé a una persona del local para que te responda por acá en breve. 🙌'
        : '¿Me contás un poco más qué estás buscando así te ayudo mejor?';
    }
    await this.markProcessed(tenantId, conversationId, pendingIds);
    await this.reply(tenantId, settings, conversation, finalText, { provider, model, ...usage });
    return { replies: [finalText], status: conversation.status };
  }

  private async resolveConversation(tenantId: string, incoming: IncomingCustomerMessage): Promise<AiConversationEntity> {
    const repo = this.dataSource.getRepository(AiConversationEntity);
    if (incoming.conversationId) {
      const existing = await repo.findOne({ where: { id: incoming.conversationId, tenantId, channel: incoming.channel } });
      if (existing && existing.status !== AiConversationStatus.CLOSED) return existing;
    }
    if (!incoming.conversationId) {
      const latest = await repo.findOne({
        where: { tenantId, channel: incoming.channel, contactPhone: incoming.contactPhone },
        order: { lastMessageAt: 'DESC' },
      });
      if (
        latest &&
        latest.status !== AiConversationStatus.CLOSED &&
        (latest.status === AiConversationStatus.HANDOFF || Date.now() - latest.lastMessageAt.getTime() < CONVERSATION_WINDOW_MS)
      ) {
        return latest;
      }
    }
    return repo.save(
      repo.create({
        tenantId,
        channel: incoming.channel,
        contactPhone: incoming.contactPhone.slice(0, 30),
        contactName: incoming.contactName?.slice(0, 150) ?? null,
        status: AiConversationStatus.ACTIVE,
        lastMessageAt: new Date(),
        createdByUserId: incoming.createdByUserId ?? null,
      }),
    );
  }

  private async acquire(tenantId: string, conversationId: string): Promise<boolean> {
    const now = new Date();
    const result = await this.dataSource
      .createQueryBuilder()
      .update(AiConversationEntity)
      .set({ processingUntil: new Date(now.getTime() + LEASE_MS) })
      .where('id = :conversationId AND tenant_id = :tenantId AND (processing_until IS NULL OR processing_until < :now)', { conversationId, tenantId, now })
      .execute();
    return (result.affected ?? 0) > 0;
  }

  private async release(tenantId: string, conversationId: string): Promise<void> {
    await this.dataSource.getRepository(AiConversationEntity).update({ id: conversationId, tenantId }, { processingUntil: null });
  }

  private async markProcessed(tenantId: string, conversationId: string, ids?: string[]): Promise<void> {
    await this.dataSource.getRepository(AiMessageEntity).update(
      { tenantId, conversationId, role: AiMessageRole.CUSTOMER, processed: false, ...(ids ? { id: In(ids) } : {}) },
      { processed: true },
    );
  }

  private async dailyLimitReached(tenantId: string, settings: AiSalesSettingsEntity): Promise<boolean> {
    const timeZone = await tenantTimeZone(this.dataSource.manager, tenantId);
    const today = localToday(timeZone);
    const { start } = localDayRange(timeZone, today, today);
    const sent = await this.dataSource
      .getRepository(AiMessageEntity)
      .createQueryBuilder('m')
      .where('m.tenantId = :tenantId', { tenantId })
      .andWhere('m.role = :role', { role: AiMessageRole.ASSISTANT })
      .andWhere('m.createdAt >= :start', { start })
      .getCount();
    return sent >= settings.dailyMessageLimit;
  }

  private async systemPrompt(tenantId: string, settings: AiSalesSettingsEntity, conversation: AiConversationEntity): Promise<string> {
    const [tenantRows, branchRows] = await Promise.all([
      this.dataSource.query('SELECT COALESCE(trade_name, name) AS name, time_zone AS timeZone FROM tenants WHERE id = ? LIMIT 1', [tenantId]) as Promise<Array<{ name: string; timeZone: string | null }>>,
      settings.branchId
        ? (this.dataSource.query('SELECT name FROM branches WHERE id = ? AND tenant_id = ? LIMIT 1', [settings.branchId, tenantId]) as Promise<Array<{ name: string }>>)
        : Promise.resolve([] as Array<{ name: string }>),
    ]);
    const timeZone = await tenantTimeZone(this.dataSource.manager, tenantId);
    const order = conversation.salesOrderId
      ? await this.dataSource.getRepository(SalesOrderEntity).findOne({ where: { id: conversation.salesOrderId, tenantId }, select: { id: true, number: true } })
      : null;
    const prompt = buildSystemPrompt({
      settings,
      tenantName: tenantRows[0]?.name ?? 'el local',
      branchName: branchRows[0]?.name ?? null,
      customerRegistered: Boolean(conversation.customerPersonId),
      orderNumber: order?.number ?? null,
      localDateTime: new Intl.DateTimeFormat('es-AR', { timeZone, dateStyle: 'full', timeStyle: 'short' }).format(new Date()),
    });
    return settings.greeting?.trim() ? `${prompt}\n\nSALUDO para el primer mensaje de la conversación: ${settings.greeting.trim()}` : prompt;
  }

  /** Historial en formato neutral. Las llamadas a herramientas guardadas se reconstruyen como pares llamada/resultado. */
  private async history(tenantId: string, conversationId: string): Promise<AiChatMessage[]> {
    const rows = (
      await this.dataSource.getRepository(AiMessageEntity).find({
        where: { tenantId, conversationId },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: HISTORY_WINDOW,
      })
    ).reverse();
    const messages: AiChatMessage[] = [];
    let group: StoredToolCall[] = [];
    const flush = (): void => {
      if (group.length === 0) return;
      messages.push({ role: 'assistant', content: '', toolCalls: group.map((call) => ({ id: call.id, name: call.name, arguments: call.args })) });
      for (const call of group) {
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: typeof call.result === 'string' ? call.result : JSON.stringify(call.result) });
      }
      group = [];
    };
    for (const row of rows) {
      if (row.role === AiMessageRole.TOOL) {
        const stored = parseStoredToolCall(row.content);
        if (stored) group.push(stored);
        continue;
      }
      flush();
      if (row.role === AiMessageRole.CUSTOMER) messages.push({ role: 'user', content: row.content });
      else if (row.role === AiMessageRole.ASSISTANT) messages.push({ role: 'assistant', content: row.content });
      else if (row.role === AiMessageRole.HUMAN) messages.push({ role: 'assistant', content: `[Respondió una persona del local] ${row.content}` });
    }
    flush();
    // Un resultado de herramienta huérfano al principio de la ventana no tiene su llamada: se descarta.
    while (messages.length > 0 && messages[0].role === 'tool') messages.shift();
    return messages;
  }

  private async storeToolCall(tenantId: string, conversationId: string, call: AiToolCall, result: string): Promise<void> {
    await this.dataSource.getRepository(AiMessageEntity).insert({
      tenantId,
      conversationId,
      role: AiMessageRole.TOOL,
      toolName: call.name.slice(0, 60),
      content: JSON.stringify({ id: call.id, name: call.name, args: call.arguments, result }),
      processed: true,
    });
  }

  /** Guarda la respuesta y la envía por WhatsApp (en el simulador solo se guarda). */
  async reply(
    tenantId: string,
    settings: AiSalesSettingsEntity,
    conversation: AiConversationEntity,
    text: string,
    meta: { provider: string | null; model: string | null; inputTokens: number; outputTokens: number } | null,
    role: AiMessageRole = AiMessageRole.ASSISTANT,
    authorUserId: string | null = null,
  ): Promise<void> {
    let waMessageId: string | null = null;
    let sendError: string | null = null;
    if (conversation.channel === AiConversationChannel.WHATSAPP) {
      try {
        waMessageId = await this.sendWhatsApp(settings, conversation.contactPhone, text);
      } catch (error) {
        sendError = error instanceof Error ? error.message : String(error);
        this.logger.warn(`No se pudo enviar el WhatsApp de la conversación ${conversation.id}: ${sendError}`);
      }
    }
    const repo = this.dataSource.getRepository(AiMessageEntity);
    await repo.insert({
      tenantId,
      conversationId: conversation.id,
      role,
      content: text.slice(0, 4000),
      waMessageId,
      provider: meta?.provider?.slice(0, 20) ?? null,
      model: meta?.model?.slice(0, 80) ?? null,
      inputTokens: meta?.inputTokens ?? 0,
      outputTokens: meta?.outputTokens ?? 0,
      processed: true,
      authorUserId,
    });
    if (sendError) {
      await repo.insert({
        tenantId,
        conversationId: conversation.id,
        role: AiMessageRole.SYSTEM,
        content: `No se pudo entregar el mensaje anterior por WhatsApp: ${sendError}`.slice(0, 1000),
        processed: true,
      });
    }
  }

  async sendWhatsApp(settings: AiSalesSettingsEntity, to: string, text: string): Promise<string | null> {
    const phoneNumberId = settings.whatsappPhoneNumberId;
    if (!phoneNumberId) throw new Error('Falta configurar el número de WhatsApp.');
    const sealed =
      settings.whatsappTokenSealed ??
      (
        await this.dataSource.getRepository(AiSalesSettingsEntity).findOne({
          where: { id: settings.id },
          select: { id: true, whatsappTokenSealed: true },
        })
      )?.whatsappTokenSealed ??
      null;
    const accessToken = sealed ? secretBox().open(sealed) : process.env.WHATSAPP_ACCESS_TOKEN;
    if (!accessToken) throw new Error('Falta el token de acceso de WhatsApp.');
    return this.whatsapp.sendText({ phoneNumberId, accessToken, to, text });
  }

  private async handoff(tenantId: string, conversation: AiConversationEntity, reason: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      await manager.update(AiConversationEntity, { id: conversation.id, tenantId }, { status: AiConversationStatus.HANDOFF, handoffReason: reason.slice(0, 300) });
      await recordAudit(manager, {
        tenantId,
        actorUserId: null,
        eventType: 'AI_HANDOFF',
        aggregateType: 'AI_CONVERSATION',
        aggregateId: conversation.id,
        metadata: { reason: reason.slice(0, 300), contactPhone: conversation.contactPhone, by: 'SYSTEM' },
        context: { userAgent: 'vendedor-ia-whatsapp' },
      });
    });
    conversation.status = AiConversationStatus.HANDOFF;
    conversation.handoffReason = reason.slice(0, 300);
  }
}

function compactResult(result: Record<string, unknown>): string {
  const json = JSON.stringify(result);
  if (json.length <= MAX_TOOL_RESULT_CHARS) return json;
  return JSON.stringify({ truncado: true, resumen: json.slice(0, MAX_TOOL_RESULT_CHARS - 200) });
}

function parseStoredToolCall(content: string): StoredToolCall | null {
  try {
    const parsed = JSON.parse(content) as Partial<StoredToolCall>;
    if (typeof parsed.id !== 'string' || typeof parsed.name !== 'string') return null;
    return {
      id: parsed.id,
      name: parsed.name,
      args: typeof parsed.args === 'object' && parsed.args !== null ? parsed.args : {},
      result: parsed.result ?? null,
    };
  } catch {
    return null;
  }
}
