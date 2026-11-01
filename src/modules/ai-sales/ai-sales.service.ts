import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource, In } from 'typeorm';
import { recordAudit } from '../../common/audit/audit';
import { Paginated, likePattern, paginated } from '../../common/dto/page-query.dto';
import { RequestAuditContext } from '../../common/http/request-context';
import { BranchEntity } from '../branches/entities/branch.entity';
import { MembershipStatus, TenantMembershipEntity } from '../platform/entities/tenant-membership.entity';
import { SalesOrderEntity } from '../sales/orders/entities/sales-order.entity';
import { AgentReply, AiSalesAgent, secretBox } from './agent/ai-sales.agent';
import { AI_PAYMENT_METHODS, enabledPaymentMethods } from './agent/ai-sales.tools';
import {
  AiConversationQueryDto,
  ConversationStatusDto,
  HumanReplyDto,
  SimulatorMessageDto,
  UpdateAiSalesSettingsDto,
} from './dto/ai-sales.dto';
import {
  AiConversationChannel,
  AiConversationEntity,
  AiConversationStatus,
  AiMessageEntity,
  AiMessageRole,
  AiSalesSettingsEntity,
} from './entities/ai-sales.entities';
import { AiProviderStatus, AiRouter } from './providers/ai-router';

export interface AiSalesSettingsView {
  enabled: boolean;
  assistantName: string;
  greeting: string | null;
  storeInfo: string | null;
  branchId: string | null;
  orderUserId: string | null;
  paymentMethods: string[];
  dailyMessageLimit: number;
  whatsappPhoneNumberId: string | null;
  whatsappDisplayPhone: string | null;
  /** Hay token guardado (el valor nunca se devuelve). */
  hasAccessToken: boolean;
  /** El servidor tiene configurado el webhook de Meta (WHATSAPP_VERIFY_TOKEN y WHATSAPP_APP_SECRET). */
  webhookReady: boolean;
  webhookPath: string;
  providers: AiProviderStatus[];
  updatedAt: string | null;
}

export interface AiConversationSummary {
  id: string;
  channel: AiConversationChannel;
  contactPhone: string;
  contactName: string | null;
  customerPersonId: string | null;
  status: AiConversationStatus;
  handoffReason: string | null;
  salesOrderId: string | null;
  orderNumber: number | null;
  lastMessage: string | null;
  lastMessageRole: AiMessageRole | null;
  lastMessageAt: Date;
  createdAt: Date;
}

export interface AiMessageView {
  id: string;
  role: AiMessageRole;
  content: string;
  toolName: string | null;
  provider: string | null;
  model: string | null;
  authorName: string | null;
  createdAt: Date;
}

export interface AiConversationDetail extends AiConversationSummary {
  messages: AiMessageView[];
  order: {
    id: string;
    number: number;
    status: string;
    estimatedTotal: string;
    paymentPreference: string | null;
    deliveryNotes: string | null;
  } | null;
}

export interface AiUsageView {
  days: number;
  conversations: number;
  orders: number;
  ordersTotal: string;
  handoffs: number;
  replies: number;
  byProvider: Array<{ provider: string; replies: number; inputTokens: number; outputTokens: number }>;
}

const DEFAULT_PAYMENT_METHODS = 'CASH,BANK_TRANSFER,DEBIT_CARD,CREDIT_CARD';
const TOOL_LABELS: Record<string, string> = {
  buscar_productos: 'Buscó productos',
  promociones_vigentes: 'Consultó promociones',
  cotizar_pedido: 'Cotizó el pedido',
  registrar_cliente: 'Registró al cliente',
  confirmar_pedido: 'Confirmó el pedido',
  derivar_a_humano: 'Derivó a una persona',
};

/** Panel del vendedor IA: configuración, conversaciones, respuesta humana, simulador y consumo. */
@Injectable()
export class AiSalesService {
  constructor(
    private readonly dataSource: DataSource,
    private readonly agent: AiSalesAgent,
    private readonly router: AiRouter,
  ) {}

  async loadSettings(tenantId: string): Promise<AiSalesSettingsEntity | null> {
    return this.dataSource.getRepository(AiSalesSettingsEntity).findOne({ where: { tenantId } });
  }

  async getSettings(tenantId: string): Promise<AiSalesSettingsView> {
    const settings = await this.dataSource.getRepository(AiSalesSettingsEntity).findOne({
      where: { tenantId },
      select: {
        id: true,
        tenantId: true,
        enabled: true,
        assistantName: true,
        greeting: true,
        storeInfo: true,
        branchId: true,
        orderUserId: true,
        paymentMethods: true,
        dailyMessageLimit: true,
        whatsappPhoneNumberId: true,
        whatsappDisplayPhone: true,
        whatsappTokenSealed: true,
        updatedAt: true,
      },
    });
    return this.toView(settings);
  }

  async updateSettings(tenantId: string, actorUserId: string, dto: UpdateAiSalesSettingsDto, context: RequestAuditContext): Promise<AiSalesSettingsView> {
    const branchId = dto.branchId ?? null;
    const orderUserId = dto.orderUserId ?? null;
    if (branchId) {
      const branch = await this.dataSource.getRepository(BranchEntity).findOne({ where: { id: branchId, tenantId, status: true }, select: { id: true } });
      if (!branch) throw new BadRequestException('La sucursal no existe o no está activa.');
    }
    if (orderUserId) {
      const membership = await this.dataSource.getRepository(TenantMembershipEntity).findOne({
        where: { tenantId, userId: orderUserId, status: MembershipStatus.ACTIVE },
        select: { id: true, branchId: true },
      });
      if (!membership) throw new BadRequestException('El usuario de pedidos no pertenece a la empresa o no está activo.');
      if (membership.branchId && branchId && membership.branchId !== branchId) {
        throw new BadRequestException('El usuario de pedidos está asignado a otra sucursal.');
      }
    }
    if (dto.enabled && (!branchId || !orderUserId)) {
      throw new BadRequestException('Para activar el asistente elegí la sucursal y el usuario que figura como vendedor de los pedidos.');
    }
    const methods = [...new Set(dto.paymentMethods)].filter((method) => (AI_PAYMENT_METHODS as readonly string[]).includes(method));
    if (methods.length === 0) throw new BadRequestException('Elegí al menos un medio de pago.');

    try {
      await this.dataSource.transaction(async (manager) => {
        const repo = manager.getRepository(AiSalesSettingsEntity);
        const current =
          (await repo.findOne({ where: { tenantId }, lock: { mode: 'pessimistic_write' } })) ??
          repo.create({ tenantId, assistantName: 'Sofía', paymentMethods: DEFAULT_PAYMENT_METHODS, dailyMessageLimit: 500, enabled: false });
        const before = {
          enabled: current.enabled,
          assistantName: current.assistantName,
          branchId: current.branchId ?? null,
          orderUserId: current.orderUserId ?? null,
          paymentMethods: current.paymentMethods,
          dailyMessageLimit: current.dailyMessageLimit,
          whatsappPhoneNumberId: current.whatsappPhoneNumberId ?? null,
          whatsappDisplayPhone: current.whatsappDisplayPhone ?? null,
          greeting: current.greeting ?? null,
          storeInfo: current.storeInfo ?? null,
        };
        current.enabled = dto.enabled;
        current.assistantName = dto.assistantName;
        current.greeting = dto.greeting ?? null;
        current.storeInfo = dto.storeInfo ?? null;
        current.branchId = branchId;
        current.orderUserId = orderUserId;
        current.paymentMethods = methods.join(',');
        current.dailyMessageLimit = dto.dailyMessageLimit;
        current.whatsappPhoneNumberId = dto.whatsappPhoneNumberId ?? null;
        current.whatsappDisplayPhone = dto.whatsappDisplayPhone ?? null;
        current.updatedByUserId = actorUserId;
        let tokenChange: 'SET' | 'CLEARED' | null = null;
        if (dto.whatsappAccessToken) {
          current.whatsappTokenSealed = secretBox().seal(dto.whatsappAccessToken);
          tokenChange = 'SET';
        } else if (dto.clearAccessToken) {
          current.whatsappTokenSealed = null;
          tokenChange = 'CLEARED';
        }
        const saved = await repo.save(current);
        const after: Record<string, unknown> = {
          enabled: saved.enabled,
          assistantName: saved.assistantName,
          branchId: saved.branchId ?? null,
          orderUserId: saved.orderUserId ?? null,
          paymentMethods: saved.paymentMethods,
          dailyMessageLimit: saved.dailyMessageLimit,
          whatsappPhoneNumberId: saved.whatsappPhoneNumberId ?? null,
          whatsappDisplayPhone: saved.whatsappDisplayPhone ?? null,
          greeting: saved.greeting ?? null,
          storeInfo: saved.storeInfo ?? null,
        };
        const changed = Object.keys(after).filter((key) => (before as Record<string, unknown>)[key] !== after[key]);
        await recordAudit(manager, {
          tenantId,
          actorUserId,
          eventType: 'AI_SALES_SETTINGS_UPDATED',
          aggregateType: 'AI_SALES_SETTINGS',
          aggregateId: saved.id,
          // El token nunca va a la auditoría: solo si se cambió o se borró.
          metadata: {
            changed,
            enabled: saved.enabled,
            branchId: saved.branchId ?? null,
            orderUserId: saved.orderUserId ?? null,
            paymentMethods: saved.paymentMethods,
            dailyMessageLimit: saved.dailyMessageLimit,
            ...(tokenChange ? { accessToken: tokenChange } : {}),
          },
          context,
        });
      });
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
        throw new ConflictException('Ese número de WhatsApp (Phone number ID) ya está vinculado a otra empresa.');
      }
      throw error;
    }
    return this.getSettings(tenantId);
  }

  async listConversations(tenantId: string, query: AiConversationQueryDto): Promise<Paginated<AiConversationSummary>> {
    const qb = this.dataSource
      .getRepository(AiConversationEntity)
      .createQueryBuilder('c')
      .where('c.tenantId = :tenantId', { tenantId });
    if (query.status) qb.andWhere('c.status = :status', { status: query.status });
    if (query.channel) qb.andWhere('c.channel = :channel', { channel: query.channel });
    if (query.search) {
      const digits = query.search.replace(/\D/g, '');
      qb.andWhere(
        digits.length >= 3 ? '(c.contactName LIKE :term OR c.contactPhone LIKE :digits)' : 'c.contactName LIKE :term',
        { term: likePattern(query.search), digits: `%${digits}%` },
      );
    }
    const [rows, total] = await qb
      .orderBy('c.lastMessageAt', 'DESC')
      .addOrderBy('c.id', 'DESC')
      .skip((query.page - 1) * query.limit)
      .take(query.limit)
      .getManyAndCount();
    return paginated(await this.summaries(tenantId, rows), total, query.page, query.limit);
  }

  async getConversation(tenantId: string, id: string): Promise<AiConversationDetail> {
    const conversation = await this.dataSource.getRepository(AiConversationEntity).findOne({ where: { id, tenantId } });
    if (!conversation) throw new NotFoundException('Conversación no encontrada.');
    const [summary] = await this.summaries(tenantId, [conversation]);
    const rows = (
      await this.dataSource.getRepository(AiMessageEntity).find({
        where: { tenantId, conversationId: id },
        order: { createdAt: 'DESC', id: 'DESC' },
        take: 300,
      })
    ).reverse();
    const authorIds = [...new Set(rows.map((row) => row.authorUserId).filter((value): value is string => Boolean(value)))];
    const authors = authorIds.length
      ? ((await this.dataSource.query(
          `SELECT u.id, TRIM(CONCAT(COALESCE(p.first_name, ''), ' ', COALESCE(p.last_name, ''))) AS name
             FROM users u LEFT JOIN persons p ON p.id = u.person_id
            WHERE u.id IN (${authorIds.map(() => '?').join(',')})`,
          authorIds,
        )) as Array<{ id: string; name: string }>)
      : [];
    const authorNames = new Map(authors.map((author) => [author.id, author.name || null]));
    const order = conversation.salesOrderId
      ? await this.dataSource.getRepository(SalesOrderEntity).findOne({ where: { id: conversation.salesOrderId, tenantId } })
      : null;
    return {
      ...summary,
      messages: rows.map((row) => ({
        id: row.id,
        role: row.role,
        // Las consultas internas del asistente se muestran resumidas (los datos crudos quedan en la base).
        content: row.role === AiMessageRole.TOOL ? toolSummary(row.toolName, row.content) : row.content,
        toolName: row.toolName ?? null,
        provider: row.provider ?? null,
        model: row.model ?? null,
        authorName: row.authorUserId ? authorNames.get(row.authorUserId) ?? null : null,
        createdAt: row.createdAt,
      })),
      order: order
        ? {
            id: order.id,
            number: order.number,
            status: order.status,
            estimatedTotal: order.estimatedTotal,
            paymentPreference: order.paymentPreference ?? null,
            deliveryNotes: order.deliveryNotes ?? null,
          }
        : null,
    };
  }

  /** Una persona del local responde: se envía por WhatsApp y la conversación queda tomada (el asistente deja de responder). */
  async humanReply(tenantId: string, actorUserId: string, id: string, dto: HumanReplyDto, context: RequestAuditContext): Promise<AiConversationDetail> {
    const conversation = await this.dataSource.getRepository(AiConversationEntity).findOne({ where: { id, tenantId } });
    if (!conversation) throw new NotFoundException('Conversación no encontrada.');
    const settings = await this.loadSettings(tenantId);
    if (!settings) throw new BadRequestException('Configurá el asistente antes de responder.');
    if (conversation.status !== AiConversationStatus.HANDOFF) {
      await this.changeStatus(tenantId, actorUserId, conversation, AiConversationStatus.HANDOFF, 'Tomada por una persona del local.', context);
    }
    await this.agent.reply(tenantId, settings, conversation, dto.text, null, AiMessageRole.HUMAN, actorUserId);
    await this.dataSource.getRepository(AiConversationEntity).update({ id, tenantId }, { lastMessageAt: new Date() });
    return this.getConversation(tenantId, id);
  }

  async setStatus(tenantId: string, actorUserId: string, id: string, dto: ConversationStatusDto, context: RequestAuditContext): Promise<AiConversationDetail> {
    const conversation = await this.dataSource.getRepository(AiConversationEntity).findOne({ where: { id, tenantId } });
    if (!conversation) throw new NotFoundException('Conversación no encontrada.');
    if (dto.action === 'PAUSE') {
      await this.changeStatus(tenantId, actorUserId, conversation, AiConversationStatus.HANDOFF, 'Asistente pausado por una persona del local.', context);
    } else if (dto.action === 'RESUME') {
      const next = conversation.salesOrderId ? AiConversationStatus.ORDER_PLACED : AiConversationStatus.ACTIVE;
      await this.changeStatus(tenantId, actorUserId, conversation, next, null, context);
    } else {
      await this.changeStatus(tenantId, actorUserId, conversation, AiConversationStatus.CLOSED, conversation.handoffReason ?? null, context);
    }
    return this.getConversation(tenantId, id);
  }

  /** Probar el asistente desde el panel: mismas herramientas y precios, sin enviar WhatsApp. */
  async simulate(tenantId: string, actorUserId: string, dto: SimulatorMessageDto): Promise<AgentReply & { conversation: AiConversationDetail }> {
    const settings = await this.loadSettings(tenantId);
    if (!settings?.branchId || !settings.orderUserId) {
      throw new BadRequestException('Configurá la sucursal y el usuario de pedidos antes de probar el asistente.');
    }
    const contactPhone = `SIM-${actorUserId.replace(/-/g, '').slice(0, 26)}`;
    if (dto.restart) {
      await this.dataSource.getRepository(AiConversationEntity).update(
        { tenantId, channel: AiConversationChannel.SIMULATOR, contactPhone, status: In([AiConversationStatus.ACTIVE, AiConversationStatus.HANDOFF, AiConversationStatus.ORDER_PLACED]) },
        { status: AiConversationStatus.CLOSED },
      );
    }
    // En el simulador el asistente responde aunque todavía no esté activado para WhatsApp.
    const reply = await this.agent.receive(tenantId, { ...settings, enabled: true } as AiSalesSettingsEntity, {
      channel: AiConversationChannel.SIMULATOR,
      contactPhone,
      contactName: 'Prueba del panel',
      text: dto.text,
      createdByUserId: actorUserId,
      conversationId: dto.restart ? null : dto.conversationId ?? null,
    });
    return { ...reply, conversation: await this.getConversation(tenantId, reply.conversationId) };
  }

  async usage(tenantId: string, days = 30): Promise<AiUsageView> {
    const since = new Date(Date.now() - days * 86_400_000);
    const [providers, conversations, orders, handoffs] = await Promise.all([
      this.dataSource.query(
        `SELECT COALESCE(provider, 'sin IA') AS provider, COUNT(*) AS replies, COALESCE(SUM(input_tokens), 0) AS inputTokens, COALESCE(SUM(output_tokens), 0) AS outputTokens
           FROM ai_messages WHERE tenant_id = ? AND role = 'ASSISTANT' AND created_at >= ? GROUP BY COALESCE(provider, 'sin IA') ORDER BY replies DESC`,
        [tenantId, since],
      ) as Promise<Array<{ provider: string; replies: string | number; inputTokens: string | number; outputTokens: string | number }>>,
      this.dataSource.query(`SELECT COUNT(*) AS total FROM ai_conversations WHERE tenant_id = ? AND channel = 'WHATSAPP' AND created_at >= ?`, [tenantId, since]) as Promise<Array<{ total: string | number }>>,
      this.dataSource.query(
        `SELECT COUNT(*) AS total, COALESCE(SUM(estimated_total), 0) AS amount FROM sales_orders WHERE tenant_id = ? AND source = 'WHATSAPP_AI' AND status <> 'CANCELLED' AND created_at >= ?`,
        [tenantId, since],
      ) as Promise<Array<{ total: string | number; amount: string | number }>>,
      this.dataSource.query(`SELECT COUNT(*) AS total FROM audit_events WHERE tenant_id = ? AND event_type = 'AI_HANDOFF' AND created_at >= ?`, [tenantId, since]) as Promise<Array<{ total: string | number }>>,
    ]);
    const byProvider = providers.map((row) => ({
      provider: row.provider,
      replies: Number(row.replies),
      inputTokens: Number(row.inputTokens),
      outputTokens: Number(row.outputTokens),
    }));
    return {
      days,
      conversations: Number(conversations[0]?.total ?? 0),
      orders: Number(orders[0]?.total ?? 0),
      ordersTotal: Number(orders[0]?.amount ?? 0).toFixed(2),
      handoffs: Number(handoffs[0]?.total ?? 0),
      replies: byProvider.reduce((sum, row) => sum + row.replies, 0),
      byProvider,
    };
  }

  private async changeStatus(
    tenantId: string,
    actorUserId: string,
    conversation: AiConversationEntity,
    status: AiConversationStatus,
    reason: string | null,
    context: RequestAuditContext,
  ): Promise<void> {
    const previous = conversation.status;
    await this.dataSource.transaction(async (manager) => {
      await manager.update(AiConversationEntity, { id: conversation.id, tenantId }, { status, handoffReason: reason });
      if (status === AiConversationStatus.ACTIVE || status === AiConversationStatus.ORDER_PLACED) {
        // Lo que escribió el cliente mientras atendía una persona ya fue visto: el asistente sigue desde lo próximo.
        await manager.update(AiMessageEntity, { tenantId, conversationId: conversation.id, role: AiMessageRole.CUSTOMER, processed: false }, { processed: true });
      }
      await recordAudit(manager, {
        tenantId,
        actorUserId,
        eventType: 'AI_CONVERSATION_STATUS_CHANGED',
        aggregateType: 'AI_CONVERSATION',
        aggregateId: conversation.id,
        metadata: { from: previous, to: status, contactPhone: conversation.contactPhone, reason },
        context,
      });
    });
    conversation.status = status;
    conversation.handoffReason = reason;
  }

  private async summaries(tenantId: string, rows: AiConversationEntity[]): Promise<AiConversationSummary[]> {
    if (rows.length === 0) return [];
    const ids = rows.map((row) => row.id);
    const last = (await this.dataSource.query(
      `SELECT m.conversation_id AS conversationId, m.role, m.content
         FROM ai_messages m
         JOIN (SELECT conversation_id, MAX(created_at) AS at FROM ai_messages
                WHERE tenant_id = ? AND conversation_id IN (${ids.map(() => '?').join(',')}) AND role IN ('CUSTOMER', 'ASSISTANT', 'HUMAN')
                GROUP BY conversation_id) latest
           ON latest.conversation_id = m.conversation_id AND latest.at = m.created_at
        WHERE m.tenant_id = ? AND m.role IN ('CUSTOMER', 'ASSISTANT', 'HUMAN')`,
      [tenantId, ...ids, tenantId],
    )) as Array<{ conversationId: string; role: AiMessageRole; content: string }>;
    const lastByConversation = new Map(last.map((row) => [row.conversationId, row]));
    const orderIds = rows.map((row) => row.salesOrderId).filter((value): value is string => Boolean(value));
    const orders = orderIds.length
      ? await this.dataSource.getRepository(SalesOrderEntity).find({ where: { tenantId, id: In(orderIds) }, select: { id: true, number: true } })
      : [];
    const orderNumbers = new Map(orders.map((order) => [order.id, order.number]));
    return rows.map((row) => {
      const message = lastByConversation.get(row.id);
      return {
        id: row.id,
        channel: row.channel,
        contactPhone: row.contactPhone,
        contactName: row.contactName ?? null,
        customerPersonId: row.customerPersonId ?? null,
        status: row.status,
        handoffReason: row.handoffReason ?? null,
        salesOrderId: row.salesOrderId ?? null,
        orderNumber: row.salesOrderId ? orderNumbers.get(row.salesOrderId) ?? null : null,
        lastMessage: message ? message.content.slice(0, 140) : null,
        lastMessageRole: message?.role ?? null,
        lastMessageAt: row.lastMessageAt,
        createdAt: row.createdAt,
      };
    });
  }

  private toView(settings: AiSalesSettingsEntity | null): AiSalesSettingsView {
    return {
      enabled: settings?.enabled ?? false,
      assistantName: settings?.assistantName ?? 'Sofía',
      greeting: settings?.greeting ?? null,
      storeInfo: settings?.storeInfo ?? null,
      branchId: settings?.branchId ?? null,
      orderUserId: settings?.orderUserId ?? null,
      paymentMethods: settings ? enabledPaymentMethods(settings) : DEFAULT_PAYMENT_METHODS.split(','),
      dailyMessageLimit: settings?.dailyMessageLimit ?? 500,
      whatsappPhoneNumberId: settings?.whatsappPhoneNumberId ?? null,
      whatsappDisplayPhone: settings?.whatsappDisplayPhone ?? null,
      hasAccessToken: Boolean(settings?.whatsappTokenSealed) || Boolean(process.env.WHATSAPP_ACCESS_TOKEN),
      webhookReady: Boolean(process.env.WHATSAPP_VERIFY_TOKEN && process.env.WHATSAPP_APP_SECRET),
      webhookPath: '/api/v1/ai-sales/webhook',
      providers: this.router.status(),
      updatedAt: settings?.updatedAt ? settings.updatedAt.toISOString() : null,
    };
  }
}

function toolSummary(toolName: string | null | undefined, content: string): string {
  const label = TOOL_LABELS[toolName ?? ''] ?? `Consulta ${toolName ?? ''}`.trim();
  try {
    const parsed = JSON.parse(content) as { args?: Record<string, unknown>; result?: unknown };
    const result = typeof parsed.result === 'string' ? (JSON.parse(parsed.result) as Record<string, unknown>) : null;
    const detail =
      toolName === 'buscar_productos' && typeof parsed.args?.texto === 'string'
        ? `: «${parsed.args.texto}»`
        : toolName === 'confirmar_pedido' && result && typeof result.pedidoNumero === 'number'
          ? `: pedido N° ${result.pedidoNumero} por ${String(result.total ?? '')}`
          : toolName === 'cotizar_pedido' && result && typeof result.total === 'string'
            ? `: total ${result.total}`
            : toolName === 'derivar_a_humano' && typeof parsed.args?.motivo === 'string'
              ? `: ${parsed.args.motivo}`
              : '';
    const failed = result && typeof result.error === 'string' ? ` (no se pudo: ${result.error})` : '';
    return `${label}${detail}${failed}`;
  } catch {
    return label;
  }
}
