import { createHmac } from 'node:crypto';
import { isValidMetaSignature, parseWhatsAppWebhook } from './whatsapp.client';

describe('Webhook de WhatsApp', () => {
  const secret = 'app-secret';
  const body = Buffer.from('{"object":"whatsapp_business_account"}');
  const signature = `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;

  it('acepta solo la firma HMAC correcta del cuerpo crudo', () => {
    expect(isValidMetaSignature(body, signature, secret)).toBe(true);
    expect(isValidMetaSignature(body, signature, 'otro')).toBe(false);
    expect(isValidMetaSignature(Buffer.from('{}'), signature, secret)).toBe(false);
    expect(isValidMetaSignature(body, undefined, secret)).toBe(false);
    expect(isValidMetaSignature(body, 'sha1=abc', secret)).toBe(false);
    expect(isValidMetaSignature(undefined, signature, secret)).toBe(false);
  });

  it('extrae mensajes de texto, botones y no texto; ignora estados de entrega', () => {
    const messages = parseWhatsAppWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          changes: [
            {
              value: {
                metadata: { phone_number_id: '1234567' },
                contacts: [{ wa_id: '5491100000000', profile: { name: 'Ana' } }],
                messages: [
                  { from: '5491100000000', id: 'wamid.1', timestamp: '1760000000', type: 'text', text: { body: 'hola' } },
                  { from: '5491100000000', id: 'wamid.2', timestamp: '1760000001', type: 'interactive', interactive: { button_reply: { title: 'Sí' } } },
                  { from: '5491100000000', id: 'wamid.3', timestamp: '1760000002', type: 'image', image: { id: 'x' } },
                  { from: 'no-es-numero', id: 'wamid.4', type: 'text', text: { body: 'x' } },
                ],
              },
            },
            { value: { metadata: { phone_number_id: '1234567' }, statuses: [{ id: 'wamid.1', status: 'read' }] } },
          ],
        },
      ],
    });
    expect(messages.map((message) => [message.waMessageId, message.text, message.contactName])).toEqual([
      ['wamid.1', 'hola', 'Ana'],
      ['wamid.2', 'Sí', 'Ana'],
      ['wamid.3', null, 'Ana'],
    ]);
    expect(messages[0].timestamp.toISOString()).toBe(new Date(1760000000 * 1000).toISOString());
    expect(parseWhatsAppWebhook({ object: 'page' })).toEqual([]);
  });
});
