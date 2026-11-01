import { Controller, ForbiddenException, Get, Header, HttpCode, HttpStatus, Logger, Post, Query, Req } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Request } from 'express';
import { timingSafeEqual } from 'node:crypto';
import { DataSource } from 'typeorm';
import { hasTenantModule, TenantModule } from '../../../common/modules/tenant-modules';
import { tenantTimeZone } from '../../../common/time/local-day-range';
import { AiSalesAgent } from '../agent/ai-sales.agent';
import { AiConversationChannel, AiSalesSettingsEntity } from '../entities/ai-sales.entities';
import { IncomingWhatsAppMessage, isValidMetaSignature, parseWhatsAppWebhook } from './whatsapp.client';

const sameSecret = (received: string, expected: string): boolean => {
  const a = Buffer.from(received);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
};

/**
 * Webhook público de WhatsApp Cloud API. No usa JWT: Meta se autentica con la firma HMAC
 * (X-Hub-Signature-256) del cuerpo crudo, y la verificación inicial con WHATSAPP_VERIFY_TOKEN.
 * Responde 200 enseguida y procesa en segundo plano (Meta reintenta si tarda más de unos segundos).
 */
@SkipThrottle()
@Controller('ai-sales/webhook')
export class WhatsAppWebhookController {
  private readonly logger = new Logger(WhatsAppWebhookController.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly agent: AiSalesAgent,
  ) {}

  /** Verificación al registrar el webhook en Meta (devuelve hub.challenge en texto plano). */
  @Get()
  @Header('content-type', 'text/plain; charset=utf-8')
  verify(
    @Query('hub.mode') mode: string | undefined,
    @Query('hub.verify_token') token: string | undefined,
    @Query('hub.challenge') challenge: string | undefined,
  ): string {
    const expected = process.env.WHATSAPP_VERIFY_TOKEN ?? '';
    if (mode === 'subscribe' && expected && typeof token === 'string' && sameSecret(token, expected) && typeof challenge === 'string' && /^[\w-]{1,200}$/.test(challenge)) {
      return challenge;
    }
    throw new ForbiddenException('Token de verificación inválido.');
  }

  @Post()
  @HttpCode(HttpStatus.OK)
  async receive(@Req() request: Request & { rawBody?: Buffer }): Promise<{ received: number }> {
    const appSecret = process.env.WHATSAPP_APP_SECRET ?? '';
    if (!appSecret) throw new ForbiddenException('El webhook de WhatsApp no está configurado en el servidor.');
    if (!isValidMetaSignature(request.rawBody, request.header('x-hub-signature-256'), appSecret)) {
      throw new ForbiddenException('Firma del webhook inválida.');
    }
    const messages = parseWhatsAppWebhook(request.body);
    if (messages.length === 0) return { received: 0 };
    const work = this.handle(messages);
    if (process.env.AI_SALES_SYNC_WEBHOOK === 'true') await work;
    else work.catch((error: unknown) => this.logger.error('Error procesando el webhook de WhatsApp', error));
    return { received: messages.length };
  }

  private async handle(messages: IncomingWhatsAppMessage[]): Promise<void> {
    const repo = this.dataSource.getRepository(AiSalesSettingsEntity);
    const settingsCache = new Map<string, AiSalesSettingsEntity | null>();
    for (const message of messages) {
      if (!settingsCache.has(message.phoneNumberId)) {
        const settings = await repo.findOne({ where: { whatsappPhoneNumberId: message.phoneNumberId } });
        const allowed =
          settings &&
          (await hasTenantModule(this.dataSource.manager, settings.tenantId, TenantModule.AI_SALES, await tenantTimeZone(this.dataSource.manager, settings.tenantId)));
        settingsCache.set(message.phoneNumberId, allowed ? settings : null);
      }
      const settings = settingsCache.get(message.phoneNumberId);
      if (!settings) {
        this.logger.warn(`Mensaje de WhatsApp para un número sin empresa con el módulo activo (${message.phoneNumberId}).`);
        continue;
      }
      try {
        await this.agent.receive(settings.tenantId, settings, {
          channel: AiConversationChannel.WHATSAPP,
          contactPhone: message.from,
          contactName: message.contactName,
          text: message.text,
          waMessageId: message.waMessageId,
        });
      } catch (error) {
        this.logger.error(`No se pudo atender el mensaje ${message.waMessageId}`, error);
      }
    }
  }
}
