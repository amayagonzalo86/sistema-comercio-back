import { Injectable, Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';

/** Cliente de envío de WhatsApp (en e2e se reemplaza por uno que guarda los mensajes en memoria). */
export const WHATSAPP_CLIENT = Symbol('WHATSAPP_CLIENT');

/** Límite de WhatsApp para un mensaje de texto. */
export const WHATSAPP_TEXT_LIMIT = 4096;

export interface WhatsAppSendInput {
  phoneNumberId: string;
  accessToken: string;
  to: string;
  text: string;
}

export interface WhatsAppClient {
  /** Devuelve el id del mensaje enviado (wamid) o lanza un error con el motivo. */
  sendText(input: WhatsAppSendInput): Promise<string | null>;
}

/** WhatsApp Cloud API de Meta (graph.facebook.com). */
@Injectable()
export class HttpWhatsAppClient implements WhatsAppClient {
  private readonly logger = new Logger(HttpWhatsAppClient.name);
  private readonly version = /^v\d+\.\d+$/.test(process.env.WHATSAPP_GRAPH_VERSION ?? '') ? (process.env.WHATSAPP_GRAPH_VERSION as string) : 'v21.0';

  async sendText(input: WhatsAppSendInput): Promise<string | null> {
    if (!/^\d{5,40}$/.test(input.phoneNumberId)) throw new Error('Identificador de número de WhatsApp inválido.');
    const response = await fetch(`https://graph.facebook.com/${this.version}/${input.phoneNumberId}/messages`, {
      method: 'POST',
      headers: { authorization: `Bearer ${input.accessToken}`, 'content-type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        recipient_type: 'individual',
        to: input.to,
        type: 'text',
        text: { preview_url: false, body: input.text.slice(0, WHATSAPP_TEXT_LIMIT) },
      }),
      signal: AbortSignal.timeout(15_000),
    });
    const body = await response.text();
    if (!response.ok) {
      this.logger.warn(`WhatsApp rechazó el envío (HTTP ${response.status}): ${body.slice(0, 300)}`);
      throw new Error(`WhatsApp rechazó el envío (HTTP ${response.status}).`);
    }
    try {
      const parsed = JSON.parse(body) as { messages?: Array<{ id?: string }> };
      return parsed.messages?.[0]?.id ?? null;
    } catch {
      return null;
    }
  }
}

/** Verifica X-Hub-Signature-256 (HMAC-SHA256 del cuerpo crudo con el App Secret de Meta) en tiempo constante. */
export function isValidMetaSignature(rawBody: Buffer | undefined, header: string | undefined, appSecret: string): boolean {
  if (!rawBody || !header || !appSecret) return false;
  const match = /^sha256=([a-f0-9]{64})$/i.exec(header.trim());
  if (!match) return false;
  const expected = createHmac('sha256', appSecret).update(rawBody).digest();
  const received = Buffer.from(match[1], 'hex');
  return received.length === expected.length && timingSafeEqual(received, expected);
}

export interface IncomingWhatsAppMessage {
  phoneNumberId: string;
  from: string;
  contactName: string | null;
  waMessageId: string;
  /** Texto del cliente; null si mandó algo que no es texto (audio, imagen, ubicación…). */
  text: string | null;
  type: string;
  timestamp: Date;
}

const asRecord = (value: unknown): Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const asArray = (value: unknown): unknown[] => (Array.isArray(value) ? value : []);
const asString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);

/** Extrae los mensajes entrantes de un webhook de WhatsApp (ignora estados de entrega y otros eventos). */
export function parseWhatsAppWebhook(payload: unknown): IncomingWhatsAppMessage[] {
  const root = asRecord(payload);
  if (root.object !== 'whatsapp_business_account') return [];
  const result: IncomingWhatsAppMessage[] = [];
  for (const entry of asArray(root.entry)) {
    for (const change of asArray(asRecord(entry).changes)) {
      const value = asRecord(asRecord(change).value);
      const phoneNumberId = asString(asRecord(value.metadata).phone_number_id);
      if (!phoneNumberId) continue;
      const names = new Map<string, string>();
      for (const contact of asArray(value.contacts)) {
        const waId = asString(asRecord(contact).wa_id);
        const name = asString(asRecord(asRecord(contact).profile).name);
        if (waId && name) names.set(waId, name.slice(0, 150));
      }
      for (const raw of asArray(value.messages)) {
        const message = asRecord(raw);
        const from = asString(message.from);
        const id = asString(message.id);
        const type = asString(message.type) ?? 'unknown';
        if (!from || !id || !/^\d{6,20}$/.test(from)) continue;
        let text: string | null = null;
        if (type === 'text') text = asString(asRecord(message.text).body);
        else if (type === 'button') text = asString(asRecord(message.button).text);
        else if (type === 'interactive') {
          const interactive = asRecord(message.interactive);
          text = asString(asRecord(interactive.button_reply).title) ?? asString(asRecord(interactive.list_reply).title);
        }
        const seconds = Number(message.timestamp);
        result.push({
          phoneNumberId,
          from,
          contactName: names.get(from) ?? null,
          waMessageId: id.slice(0, 128),
          text: text ? text.slice(0, 2000) : null,
          type,
          timestamp: Number.isFinite(seconds) && seconds > 0 ? new Date(seconds * 1000) : new Date(),
        });
      }
    }
  }
  return result;
}
