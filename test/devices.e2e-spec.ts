import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import cookieParser from 'cookie-parser';
import { generateKeyPairSync, KeyObject, sign } from 'node:crypto';
import request from 'supertest';
import { App } from 'supertest/types';
import { DataSource } from 'typeorm';
import { AppModule } from '../src/app.module';
import { AdminSeederService } from '../src/database/seeders/admin-seeder.service';

/** Equipo simulado: llave P-256 como la que genera el navegador con WebCrypto. */
class FakeDevice {
  private readonly privateKey: KeyObject;
  readonly publicKey: Record<string, unknown>;
  constructor(readonly name: string) {
    const pair = generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
    this.privateKey = pair.privateKey;
    this.publicKey = pair.publicKey.export({ format: 'jwk' }) as Record<string, unknown>;
  }
  proof(challenge: string) {
    return {
      publicKey: this.publicKey,
      challenge,
      signature: sign('sha256', Buffer.from(challenge), { key: this.privateKey, dsaEncoding: 'ieee-p1363' }).toString('base64url'),
      name: this.name,
    };
  }
}

/** Equipos autorizados: solo entran los navegadores aprobados por la plataforma (sin depender de la IP). */
describe('Equipos autorizados (e2e)', () => {
  let app: INestApplication<App>;
  let adminToken = '';
  let tenantId = '';

  const http = () => request(app.getHttpServer());
  const asAdmin = (method: 'get' | 'post' | 'patch', path: string, body?: object) => {
    const call = http()[method](`/api/v1${path}`).set('Authorization', `Bearer ${adminToken}`);
    return body ? call.send(body) : call;
  };
  const expectStatus = (response: request.Response, status: number) => {
    if (response.status !== status) {
      throw new Error(`${response.request.method} ${response.request.url} -> ${response.status}: ${JSON.stringify(response.body)}`);
    }
  };
  const login = async (username: string, password: string, device?: FakeDevice) => {
    const challenge = (await http().post('/api/v1/auth/device-challenge')).body.challenge as string;
    return http().post('/api/v1/auth/login').send({ username, password, ...(device ? { device: device.proof(challenge) } : {}) });
  };

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleFixture.createNestApplication();
    app.use(cookieParser());
    app.setGlobalPrefix('api/v1');
    app.useGlobalPipes(
      new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true, transformOptions: { enableImplicitConversion: true } }),
    );
    await app.init();
    await app.get(DataSource).synchronize(true);
    await app.get(AdminSeederService).seed();
    const admin = await login('admin', process.env.ADMIN_BOOTSTRAP_PASSWORD as string);
    expectStatus(admin, 200);
    adminToken = admin.body.tokens.accessToken as string;
    tenantId = (JSON.parse(Buffer.from(adminToken.split('.')[1], 'base64url').toString()) as { tenantId: string }).tenantId;
  });

  afterAll(async () => {
    await app?.close();
  });

  it('registra, aprueba, exige y da de baja equipos', async () => {
    expectStatus(
      await asAdmin('post', '/employees', {
        firstName: 'Carla',
        lastName: 'Caja',
        username: 'carla.caja',
        password: 'Carla-Caja-2026',
        roles: ['MANAGER'],
      }),
      201,
    );
    // Segundo usuario para la PC de la red local (el ingreso tiene un tope de intentos por usuario).
    expectStatus(
      await asAdmin('post', '/employees', { firstName: 'Luis', lastName: 'Lan', username: 'luis.lan', password: 'Luis-Lan-2026x', roles: ['MANAGER'] }),
      201,
    );
    const caja1 = new FakeDevice('Caja 1');
    const intruso = new FakeDevice('PC desconocida');

    // Sin exigir: entra igual y el equipo queda registrado como pendiente (para aprobarlo antes de activar).
    const free = await login('carla.caja', 'Carla-Caja-2026', caja1);
    expectStatus(free, 200);
    let view = await asAdmin('get', `/platform/tenants/${tenantId}/devices`);
    expectStatus(view, 200);
    expect(view.body).toMatchObject({ deviceApprovalRequired: false, counts: { PENDING: 1, APPROVED: 0 } });
    const caja1Row = view.body.devices[0] as { id: string; code: string; name: string; status: string; lastUser: string };
    expect(caja1Row).toMatchObject({ name: 'Caja 1', status: 'PENDING', lastUser: 'Carla Caja' });
    expect(caja1Row.code).toMatch(/^[0-9A-F]{4}-[0-9A-F]{4}$/);

    // Se puede exigir aunque no haya ninguno aprobado: la PC queda bloqueada con su código hasta la aprobación.
    view = await asAdmin('patch', `/platform/tenants/${tenantId}/device-approval`, { required: true });
    expectStatus(view, 200);
    expect(view.body).toMatchObject({ deviceApprovalRequired: true, counts: { APPROVED: 0, PENDING: 1 } });
    const blocked = await login('carla.caja', 'Carla-Caja-2026', caja1);
    expectStatus(blocked, 403);
    expect(blocked.body.details).toBe(`DEVICE_PENDING:${caja1Row.code}`);
    expectStatus(await asAdmin('post', `/platform/tenants/${tenantId}/devices/${caja1Row.id}/approve`, { name: 'Caja 1 – Centro' }), 200);

    // La sesión abierta antes de exigir sigue valiendo: venía de un equipo que ahora está aprobado.
    expectStatus(await http().get('/api/v1/branches').set('Authorization', `Bearer ${free.body.tokens.accessToken as string}`), 200);

    // Equipo aprobado: entra.
    const ok = await login('carla.caja', 'Carla-Caja-2026', caja1);
    expectStatus(ok, 200);
    const okToken = ok.body.tokens.accessToken as string;
    const okCookie = ok.headers['set-cookie'];
    expectStatus(await http().get('/api/v1/branches').set('Authorization', `Bearer ${okToken}`), 200);

    // Contraseña correcta pero equipo desconocido: queda pendiente con código y no entra.
    const pending = await login('carla.caja', 'Carla-Caja-2026', intruso);
    expectStatus(pending, 403);
    expect(pending.body.details).toMatch(/^DEVICE_PENDING:[0-9A-F]{4}-[0-9A-F]{4}$/);
    // Sin prueba de equipo (otro programa, modo incógnito sin llave): no entra.
    const noDevice = await login('carla.caja', 'Carla-Caja-2026');
    expectStatus(noDevice, 403);
    expect(noDevice.body.details).toBe('DEVICE_REQUIRED');
    // Contraseña incorrecta: no registra equipos (nadie de afuera llena la lista).
    expectStatus(await login('carla.caja', 'mal-clave-123', new FakeDevice('Spam')), 401);
    expect((await asAdmin('get', `/platform/tenants/${tenantId}/devices?status=PENDING`)).body.devices.map((device: { name: string }) => device.name)).toEqual(['PC desconocida']);
    // Firma de otro equipo con la llave pública robada: rechazada.
    const challenge = (await http().post('/api/v1/auth/device-challenge')).body.challenge as string;
    const forged = { ...intruso.proof(challenge), publicKey: caja1.publicKey };
    expectStatus(await http().post('/api/v1/auth/login').send({ username: 'carla.caja', password: 'Carla-Caja-2026', device: forged }), 401);

    // Navegador por http (sin WebCrypto): se identifica con un secreto propio y sigue el mismo circuito.
    const lanToken = Buffer.alloc(32, 7).toString('base64url');
    const lanLogin = () => http().post('/api/v1/auth/login').send({ username: 'luis.lan', password: 'Luis-Lan-2026x', device: { token: lanToken, name: 'PC red local' } });
    const lanPending = await lanLogin();
    expectStatus(lanPending, 403);
    const lanCode = (lanPending.body.details as string).replace('DEVICE_PENDING:', '');
    const lanRow = (await asAdmin('get', `/platform/tenants/${tenantId}/devices?status=PENDING`)).body.devices.find(
      (device: { code: string }) => device.code === lanCode,
    ) as { id: string; name: string };
    expect(lanRow.name).toBe('PC red local');
    expectStatus(await asAdmin('post', `/platform/tenants/${tenantId}/devices/${lanRow.id}/approve`), 200);
    expectStatus(await lanLogin(), 200);
    // Otro secreto (otra PC) no entra con el código ya aprobado.
    expectStatus(
      await http().post('/api/v1/auth/login').send({ username: 'luis.lan', password: 'Luis-Lan-2026x', device: { token: Buffer.alloc(32, 8).toString('base64url') } }),
      403,
    );

    // El operador de la plataforma entra desde cualquier equipo (es quien aprueba).
    expectStatus(await login('admin', process.env.ADMIN_BOOTSTRAP_PASSWORD as string), 200);

    // Baja: se cortan sus sesiones (la renovación falla) y no vuelve a entrar.
    expectStatus(await asAdmin('post', `/platform/tenants/${tenantId}/devices/${caja1Row.id}/revoke`), 200);
    expectStatus(await http().get('/api/v1/branches').set('Authorization', `Bearer ${okToken}`), 401);
    expectStatus(await http().post('/api/v1/auth/refresh').set('Cookie', okCookie), 401);
    const revoked = await login('carla.caja', 'Carla-Caja-2026', caja1);
    expectStatus(revoked, 403);
    expect(revoked.body.details).toBe('DEVICE_REVOKED');

    const audit = await asAdmin('get', '/audit-events?eventType=DEVICE_REVOKED');
    expect(audit.body.items[0].metadata).toMatchObject({ name: 'Caja 1 – Centro' });
    expect((await asAdmin('get', '/platform/tenants')).body.find((item: { id: string }) => item.id === tenantId).deviceApprovalRequired).toBe(true);

    // Al dejar de exigir, vuelve a entrar cualquiera con usuario y contraseña.
    expectStatus(await asAdmin('patch', `/platform/tenants/${tenantId}/device-approval`, { required: false }), 200);
    expectStatus(await login('carla.caja', 'Carla-Caja-2026'), 200);
  });
});
