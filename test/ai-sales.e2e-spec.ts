import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { createHmac, randomUUID } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AdminSeederService } from '../src/database/seeders/admin-seeder.service';
import {
  AiChatMessage,
  AiChatRequest,
  AiChatResult,
  AiProvider,
  AiProviderError,
} from '../src/modules/ai-sales/providers/ai-provider.types';
import { AI_PROVIDERS } from '../src/modules/ai-sales/providers/ai-router';
import { WHATSAPP_CLIENT, WhatsAppClient, WhatsAppSendInput } from '../src/modules/ai-sales/whatsapp/whatsapp.client';

const APP_SECRET = 'meta-app-secret-de-prueba-0123456789';
const VERIFY_TOKEN = 'verificacion-erp-2026';
const PHONE_NUMBER_ID = '109876543210';
const CUSTOMER_PHONE = '5492901555123';

process.env.WHATSAPP_APP_SECRET = APP_SECRET;
process.env.WHATSAPP_VERIFY_TOKEN = VERIFY_TOKEN;
process.env.AI_SALES_SYNC_WEBHOOK = 'true';

/** Proveedor que se quedó sin crédito: el enrutador debe saltar al siguiente. */
class BrokeProvider implements AiProvider {
  readonly name = 'anthropic' as const;
  readonly model = 'sin-credito';
  calls = 0;
  async chat(): Promise<AiChatResult> {
    this.calls += 1;
    throw new AiProviderError('anthropic', 'QUOTA', 'HTTP 400: Your credit balance is too low', 400);
  }
}

const lastToolResult = (messages: AiChatMessage[], name: string): Record<string, unknown> | null => {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === 'tool' && message.name === name) return JSON.parse(message.content) as Record<string, unknown>;
  }
  return null;
};

/** Modelo guionado: decide qué herramienta usar según el último mensaje (como haría el modelo real). */
class ScriptedProvider implements AiProvider {
  readonly name = 'openai' as const;
  readonly model = 'guion-de-prueba';
  readonly requests: AiChatRequest[] = [];

  async chat(request: AiChatRequest): Promise<AiChatResult> {
    this.requests.push(request);
    const messages = request.messages;
    const last = messages[messages.length - 1];
    const result = (text: string, toolCalls: AiChatResult['toolCalls'] = []): AiChatResult => ({
      text,
      toolCalls,
      usage: { inputTokens: 100, outputTokens: 20 },
      provider: this.name,
      model: this.model,
    });
    const productId = () => {
      const search = lastToolResult(messages, 'buscar_productos') as { productos?: Array<{ productoId: string }> } | null;
      return search?.productos?.[0]?.productoId ?? 'sin-producto';
    };
    if (last.role === 'tool') {
      if (last.name === 'buscar_productos') {
        const found = JSON.parse(last.content) as { productos: Array<{ nombre: string; precio: string }> };
        return result(`Tenemos ${found.productos[0].nombre} a ${found.productos[0].precio}. ¿Cuántas querés?`);
      }
      if (last.name === 'confirmar_pedido') {
        const order = JSON.parse(last.content) as { pedidoNumero?: number; total?: string; error?: string };
        return result(order.error ? `No pude: ${order.error}` : `¡Listo! Tu pedido es el N° ${order.pedidoNumero} por ${order.total}.`);
      }
      if (last.name === 'derivar_a_humano') return result('Te paso con una persona del local, ya te escribe. 🙌');
      const quote = lastToolResult(messages, 'cotizar_pedido') as { total?: string } | null;
      return result(`Resumen: 3 gaseosas, total ${quote?.total ?? '?'}, pagás en efectivo y retirás. ¿Confirmás?`);
    }
    const text = last.role === 'user' ? last.content.toLowerCase() : '';
    if (text.includes('gaseosa')) {
      return result('', [{ id: 'call-1', name: 'buscar_productos', arguments: { texto: 'gaseosa' } }]);
    }
    if (text.includes('quiero 3')) {
      return result('Dale, te armo el pedido.', [
        { id: 'call-2', name: 'cotizar_pedido', arguments: { items: [{ productoId: productId(), cantidad: 3 }] } },
        { id: 'call-3', name: 'registrar_cliente', arguments: { nombre: 'Juan', apellido: 'Pérez', dni: '30.111.222', direccion: 'Maipú 1200' } },
      ]);
    }
    if (text.trim() === 'sí' || text.trim() === 'si') {
      return result('', [
        {
          id: 'call-4',
          name: 'confirmar_pedido',
          arguments: {
            items: [{ productoId: productId(), cantidad: 3 }],
            formaPago: 'CASH',
            entrega: 'RETIRO',
            comentarios: 'Pasa a las 18 hs',
            clienteConfirmo: true,
          },
        },
      ]);
    }
    if (text.includes('descuento')) {
      return result('', [{ id: 'call-5', name: 'derivar_a_humano', arguments: { motivo: 'Pide un descuento especial' } }]);
    }
    return result('¡Hola! Soy Sofía, ¿qué estás buscando?');
  }
}

class FakeWhatsApp implements WhatsAppClient {
  readonly sent: WhatsAppSendInput[] = [];
  async sendText(input: WhatsAppSendInput): Promise<string> {
    this.sent.push(input);
    return `wamid.out.${this.sent.length}`;
  }
}

/** Vendedor IA por WhatsApp: webhook firmado de Meta → IA con herramientas → pedido listo para cobrar en caja. */
describe('Vendedor IA por WhatsApp (e2e)', () => {
  let app: INestApplication<App>;
  let token = '';
  let operatorId = '';
  let tenantId = '';
  const broke = new BrokeProvider();
  const scripted = new ScriptedProvider();
  const whatsapp = new FakeWhatsApp();

  const api = (method: 'get' | 'post' | 'put' | 'patch' | 'delete', path: string, body?: object, idempotent = false) => {
    let call = request(app.getHttpServer())[method](`/api/v1${path}`).set('Authorization', `Bearer ${token}`);
    if (idempotent) call = call.set('Idempotency-Key', randomUUID());
    return body ? call.send(body) : call;
  };
  const expectStatus = (response: request.Response, status: number) => {
    if (response.status !== status) {
      throw new Error(`${response.request.method} ${response.request.url} -> ${response.status}: ${JSON.stringify(response.body)}`);
    }
  };
  let waCounter = 0;
  const webhookBody = (text: string | null, type = 'text') => ({
    object: 'whatsapp_business_account',
    entry: [
      {
        id: 'WABA',
        changes: [
          {
            field: 'messages',
            value: {
              messaging_product: 'whatsapp',
              metadata: { display_phone_number: '5492901400000', phone_number_id: PHONE_NUMBER_ID },
              contacts: [{ profile: { name: 'Juan' }, wa_id: CUSTOMER_PHONE }],
              messages: [
                {
                  from: CUSTOMER_PHONE,
                  id: `wamid.in.${(waCounter += 1)}`,
                  timestamp: String(Math.floor(Date.now() / 1000)),
                  type,
                  ...(type === 'text' ? { text: { body: text } } : { audio: { id: 'media-1' } }),
                },
              ],
            },
          },
        ],
      },
    ],
  });
  const sendWebhook = (payload: object, secret = APP_SECRET) => {
    const raw = JSON.stringify(payload);
    const signature = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`;
    return request(app.getHttpServer())
      .post('/api/v1/ai-sales/webhook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(raw);
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(AI_PROVIDERS)
      .useValue([broke, scripted])
      .overrideProvider(WHATSAPP_CLIENT)
      .useValue(whatsapp)
      .compile();
    app = moduleFixture.createNestApplication({ rawBody: true });
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.init();
    await app.get(DataSource).synchronize(true);
    await app.get(AdminSeederService).seed();
    const login = await request(app.getHttpServer())
      .post('/api/v1/auth/login')
      .send({ username: 'admin', password: process.env.ADMIN_BOOTSTRAP_PASSWORD });
    expectStatus(login, 200);
    token = login.body.tokens.accessToken as string;
    operatorId = login.body.user.id as string;
    tenantId = (JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()) as { tenantId: string }).tenantId;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('verifica el webhook, vende por WhatsApp y deja el pedido en la cola de caja', async () => {
    // ── Verificación de Meta ──
    const verified = await request(app.getHttpServer())
      .get(`/api/v1/ai-sales/webhook?hub.mode=subscribe&hub.verify_token=${VERIFY_TOKEN}&hub.challenge=1158201444`);
    expectStatus(verified, 200);
    expect(verified.text).toBe('1158201444');
    expectStatus(await request(app.getHttpServer()).get('/api/v1/ai-sales/webhook?hub.mode=subscribe&hub.verify_token=otro&hub.challenge=1'), 403);

    // ── Módulo premium: sin contratar, el panel se bloquea ──
    expectStatus(await api('put', `/platform/tenants/${tenantId}/modules/AI_SALES`, { enabled: false }), 200);
    const blocked = await api('get', '/ai-sales/settings');
    expectStatus(blocked, 403);
    expect(blocked.body.details).toBe('MODULE_NOT_ENABLED:AI_SALES');
    expectStatus(await api('put', `/platform/tenants/${tenantId}/modules/AI_SALES`, { enabled: true }), 200);

    // ── Catálogo ──
    const branch = await api('post', '/branches', { code: 'WAPP', name: 'Sucursal WhatsApp' });
    expectStatus(branch, 201);
    const branchId = branch.body.id as string;
    const product = await api('post', '/products', {
      sku: 'GAS-WA',
      name: 'Gaseosa 500 ml',
      category: 'Bebidas',
      taxRate: 21,
      branchSettings: [{ branchId, costPrice: 600, profitMargin: 66.67, sellingPrice: 1000, stock: 50, minStock: 5 }],
    });
    expectStatus(product, 201);

    // ── Configuración: activar exige sucursal y usuario de pedidos; el token no se devuelve ──
    const base = {
      enabled: true,
      assistantName: 'Sofía',
      greeting: '¡Hola! Soy Sofía 😊',
      storeInfo: 'Envíos en Ushuaia: $ 2.500, de lunes a sábado. Retiro en San Martín 123 de 9 a 20 hs.',
      paymentMethods: ['CASH', 'BANK_TRANSFER', 'CREDIT_CARD'],
      dailyMessageLimit: 500,
      whatsappPhoneNumberId: PHONE_NUMBER_ID,
      whatsappDisplayPhone: '+54 9 2901 40-0000',
      whatsappAccessToken: 'EAAG-token-de-prueba-muy-largo-123456',
    };
    expectStatus(await api('put', '/ai-sales/settings', base), 400);
    const saved = await api('put', '/ai-sales/settings', { ...base, branchId, orderUserId: operatorId });
    expectStatus(saved, 200);
    expect(saved.body).toMatchObject({ enabled: true, hasAccessToken: true, webhookReady: true, branchId, paymentMethods: ['CASH', 'BANK_TRANSFER', 'CREDIT_CARD'] });
    expect(JSON.stringify(saved.body)).not.toContain('EAAG-token');
    expect(saved.body.providers.map((provider: { provider: string }) => provider.provider)).toEqual(['anthropic', 'openai']);
    const settingsAudit = await api('get', '/audit-events?eventType=AI_SALES_SETTINGS_UPDATED');
    expect(settingsAudit.body.items[0].metadata).toMatchObject({ accessToken: 'SET' });
    expect(JSON.stringify(settingsAudit.body.items[0])).not.toContain('EAAG-token');

    // ── Firma inválida: rechazado sin procesar ──
    expectStatus(await sendWebhook(webhookBody('hola'), 'otro-secreto'), 403);
    expect(whatsapp.sent).toHaveLength(0);

    // ── Conversación: busca, cotiza, registra, confirma ──
    expectStatus(await sendWebhook(webhookBody('Hola! tienen gaseosa?')), 200);
    // El primer proveedor no tiene crédito: respondió el respaldo.
    expect(broke.calls).toBe(1);
    expect(whatsapp.sent).toHaveLength(1);
    expect(whatsapp.sent[0]).toMatchObject({ phoneNumberId: PHONE_NUMBER_ID, accessToken: 'EAAG-token-de-prueba-muy-largo-123456', to: CUSTOMER_PHONE });
    expect(whatsapp.sent[0].text).toContain('Gaseosa 500 ml a $ ');
    // Las instrucciones incluyen la información del local y la regla de precios.
    expect(scripted.requests[0].system).toContain('Envíos en Ushuaia');
    expect(scripted.requests[0].system).toContain('Nunca inventes');
    expect(scripted.requests[0].tools.map((tool) => tool.name)).toEqual([
      'buscar_productos',
      'promociones_vigentes',
      'cotizar_pedido',
      'registrar_cliente',
      'confirmar_pedido',
      'derivar_a_humano',
    ]);

    // Reintento de Meta con el mismo wamid: no responde dos veces.
    const repeated = webhookBody('Hola! tienen gaseosa?');
    repeated.entry[0].changes[0].value.messages[0].id = `wamid.in.${waCounter}`;
    expectStatus(await sendWebhook(repeated), 200);
    expect(whatsapp.sent).toHaveLength(1);

    expectStatus(await sendWebhook(webhookBody('Quiero 3, retiro en el local y pago en efectivo. Soy Juan Pérez, DNI 30.111.222')), 200);
    expect(whatsapp.sent[1].text).toMatch(/total \$ [\d.]+,\d{2}/);

    expectStatus(await sendWebhook(webhookBody('sí')), 200);
    expect(whatsapp.sent[2].text).toMatch(/pedido es el N° \d+/);

    // Audio: respuesta amable sin gastar IA.
    const iaCalls = scripted.requests.length;
    expectStatus(await sendWebhook(webhookBody(null, 'audio')), 200);
    expect(whatsapp.sent[3].text).toContain('solo puedo leer mensajes de texto');
    expect(scripted.requests.length).toBe(iaCalls);

    // ── El pedido llega a la caja con origen, forma de pago y entrega ──
    const queue = await api('get', '/sales-orders?status=PENDING');
    expectStatus(queue, 200);
    const order = queue.body.items.find((item: { source: string }) => item.source === 'WHATSAPP_AI');
    expect(order).toMatchObject({
      source: 'WHATSAPP_AI',
      paymentPreference: 'Efectivo',
      contactPhone: CUSTOMER_PHONE,
      customerName: expect.stringContaining('Pérez'),
      itemsCount: 1,
    });
    expect(order.deliveryNotes).toContain('RETIRA en el local');
    expect(order.deliveryNotes).toContain('Pasa a las 18 hs');
    const customer = await api('get', '/persons?role=customers&search=30111222');
    expect(customer.body.items[0]).toMatchObject({ firstName: 'Juan', lastName: 'Pérez', nationalId: '30111222', phone: CUSTOMER_PHONE });

    // ── Panel: conversación con el pedido vinculado ──
    const conversations = await api('get', '/ai-sales/conversations');
    expectStatus(conversations, 200);
    expect(conversations.body.items[0]).toMatchObject({ status: 'ORDER_PLACED', orderNumber: order.number, contactName: 'Pérez, Juan' });
    const conversationId = conversations.body.items[0].id as string;
    const detail = await api('get', `/ai-sales/conversations/${conversationId}`);
    expectStatus(detail, 200);
    expect(detail.body.order).toMatchObject({ number: order.number, paymentPreference: 'Efectivo' });
    expect(detail.body.messages.some((message: { role: string; content: string }) => message.role === 'TOOL' && message.content.startsWith('Confirmó el pedido: pedido N°'))).toBe(true);
    const aiAudit = await api('get', '/audit-events?eventType=AI_ORDER_CREATED');
    expect(aiAudit.body.items[0].metadata).toMatchObject({ number: order.number, conversationId, paymentPreference: 'Efectivo' });

    // ── Pide un descuento: pasa a una persona y el asistente deja de responder ──
    expectStatus(await sendWebhook(webhookBody('me hacés un descuento?')), 200);
    expect((await api('get', `/ai-sales/conversations/${conversationId}`)).body).toMatchObject({ status: 'HANDOFF', handoffReason: 'Pide un descuento especial' });
    const sentBefore = whatsapp.sent.length;
    const callsBefore = scripted.requests.length;
    expectStatus(await sendWebhook(webhookBody('hola? sigue ahí?')), 200);
    expect(whatsapp.sent.length).toBe(sentBefore);
    expect(scripted.requests.length).toBe(callsBefore);
    // Responde una persona del local por WhatsApp.
    const human = await api('post', `/ai-sales/conversations/${conversationId}/reply`, { text: 'Hola Juan, soy Marta. Te puedo ofrecer el 3x2 vigente.' });
    expectStatus(human, 200);
    expect(whatsapp.sent[whatsapp.sent.length - 1].text).toContain('soy Marta');
    expect(human.body.messages[human.body.messages.length - 1]).toMatchObject({ role: 'HUMAN' });
    // Vuelve a atender el asistente.
    const resumed = await api('post', `/ai-sales/conversations/${conversationId}/status`, { action: 'RESUME' });
    expect(resumed.body.status).toBe('ORDER_PLACED');

    // ── Simulador: mismas herramientas sin enviar WhatsApp ──
    const sentBeforeSim = whatsapp.sent.length;
    const sim = await api('post', '/ai-sales/simulator', { text: 'Busco gaseosa', restart: true });
    expectStatus(sim, 200);
    expect(sim.body.replies[0]).toContain('Gaseosa 500 ml');
    expect(sim.body.conversation.channel).toBe('SIMULATOR');
    expect(whatsapp.sent.length).toBe(sentBeforeSim);

    // ── Consumo por proveedor ──
    const usage = await api('get', '/ai-sales/usage');
    expectStatus(usage, 200);
    expect(usage.body.orders).toBe(1);
    expect(usage.body.byProvider.find((row: { provider: string }) => row.provider === 'openai').replies).toBeGreaterThanOrEqual(3);
  });
});
