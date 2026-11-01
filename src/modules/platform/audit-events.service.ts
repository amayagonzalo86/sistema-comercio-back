import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEventEntity } from './entities/audit-event.entity';
import { AuditEventQueryDto } from './dto/audit-event-query.dto';
import { PLATFORM_SUPPORT_LABEL, platformOperatorIds } from '../../common/security/platform-operators';
import { localDayRange, tenantTimeZone } from '../../common/time/local-day-range';

export type AuditActorType = 'USER' | 'PLATFORM_SUPPORT' | 'SYSTEM';

export type AuditEventView = AuditEventEntity & {
  /** Nombre legible de quien hizo la acción (empleado, "Soporte de la plataforma" o "Sistema"). */
  actorName: string;
  actorType: AuditActorType;
  /** Nombres legibles de los identificadores que menciona el evento (producto, sucursal, cliente…). */
  refs?: Record<string, string>;
};

export interface AuditEventPage {
  items: AuditEventView[];
  nextCursor: string | null;
}

@Injectable()
export class AuditEventsService {
  constructor(
    @InjectRepository(AuditEventEntity)
    private readonly auditEventRepository: Repository<AuditEventEntity>,
  ) {}

  async findTenantEvents(
    tenantId: string,
    filters: AuditEventQueryDto,
  ): Promise<AuditEventPage> {
    if (filters.from && filters.to && Date.parse(filters.from) > Date.parse(filters.to)) {
      throw new BadRequestException('El filtro from no puede ser posterior a to.');
    }

    const limit = filters.limit ?? 50;
    const query = this.auditEventRepository
      .createQueryBuilder('audit')
      .where('audit.tenantId = :tenantId', { tenantId });

    if (filters.cursor) {
      query.andWhere('audit.id < :cursor', { cursor: filters.cursor });
    }
    if (filters.eventType) {
      query.andWhere('audit.eventType = :eventType', { eventType: filters.eventType });
    }
    if (filters.eventTypes) {
      query.andWhere('audit.eventType IN (:...eventTypes)', { eventTypes: filters.eventTypes.split(',').slice(0, 100) });
    }
    if (filters.aggregateType) {
      query.andWhere('audit.aggregateType = :aggregateType', {
        aggregateType: filters.aggregateType,
      });
    }
    if (filters.aggregateId) {
      query.andWhere('audit.aggregateId = :aggregateId', {
        aggregateId: filters.aggregateId,
      });
    }
    if (filters.actorUserId) {
      query.andWhere('audit.actorUserId = :actorUserId', {
        actorUserId: filters.actorUserId,
      });
    }
    if (filters.requestId) {
      query.andWhere('audit.requestId = :requestId', { requestId: filters.requestId });
    }
    // Fechas AAAA-MM-DD: días completos en la hora local de la empresa; con hora, tal cual.
    const isDay = (value?: string) => Boolean(value && /^\d{4}-\d{2}-\d{2}$/.test(value));
    const timeZone = isDay(filters.from) || isDay(filters.to) ? await tenantTimeZone(this.auditEventRepository.manager, tenantId) : null;
    const range = timeZone ? localDayRange(timeZone, isDay(filters.from) ? filters.from : null, isDay(filters.to) ? filters.to : null) : { start: null, end: null };
    if (filters.from) {
      query.andWhere('audit.createdAt >= :from', { from: range.start ?? filters.from });
    }
    if (filters.to) {
      if (range.end) query.andWhere('audit.createdAt < :to', { to: range.end });
      else query.andWhere('audit.createdAt <= :to', { to: filters.to });
    }

    const rows = await query
      .orderBy('audit.id', 'DESC')
      .take(limit + 1)
      .getMany();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: await this.withReferences(tenantId, await this.withActors(page)),
      nextCursor: hasMore ? page[page.length - 1].id : null,
    };
  }

  /**
   * Agrega el nombre de quien actuó. Las acciones de soporte de la plataforma quedan registradas,
   * pero la empresa las ve como "Soporte de la plataforma", sin id, IP ni navegador del operador.
   */
  private async withActors(events: AuditEventEntity[]): Promise<AuditEventView[]> {
    if (events.length === 0) return [];
    const manager = this.auditEventRepository.manager;
    const actorIds = [...new Set(events.map((event) => event.actorUserId).filter((id): id is string => Boolean(id)))];
    const [operators, names] = await Promise.all([
      platformOperatorIds(manager),
      actorIds.length
        ? (manager.query(
            `SELECT u.id AS id, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), u.username) AS name
               FROM users u LEFT JOIN persons p ON p.id = u.person_id
              WHERE u.id IN (${actorIds.map(() => '?').join(', ')})`,
            actorIds,
          ) as Promise<Array<{ id: string; name: string | null }>>)
        : Promise.resolve([] as Array<{ id: string; name: string | null }>),
    ]);
    const nameById = new Map(names.map((row) => [String(row.id), row.name ? String(row.name) : null]));
    // Los ids de operadores también se quitan de la metadata (por ejemplo, el vendedor de una venta).
    const scrub = (value: unknown): unknown => {
      if (typeof value === 'string') return operators.has(value) ? null : value;
      if (Array.isArray(value)) return value.map(scrub);
      if (value && typeof value === 'object') {
        return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, item]) => [key, scrub(item)]));
      }
      return value;
    };
    for (const event of events) {
      if (operators.size === 0) break;
      if (event.metadata) event.metadata = scrub(event.metadata) as typeof event.metadata;
      if (operators.has(event.aggregateId)) event.aggregateId = PLATFORM_SUPPORT_LABEL;
    }
    return events.map((event) => {
      if (!event.actorUserId) return Object.assign(event, { actorName: 'Sistema', actorType: 'SYSTEM' as const });
      if (operators.has(event.actorUserId)) {
        return Object.assign(event, {
          actorUserId: null,
          ipAddress: null,
          userAgent: null,
          actorName: PLATFORM_SUPPORT_LABEL,
          actorType: 'PLATFORM_SUPPORT' as const,
        });
      }
      return Object.assign(event, { actorName: nameById.get(event.actorUserId) ?? 'Usuario', actorType: 'USER' as const });
    });
  }

  /**
   * Nombres legibles de lo que mencionan los eventos (productos, sucursales, clientes, proveedores, empleados,
   * cajas, ventas): así la auditoría muestra «Yerba mate suave 1 kg · Casa Central» en vez de identificadores.
   */
  private async withReferences(tenantId: string, events: AuditEventView[]): Promise<AuditEventView[]> {
    if (events.length === 0) return events;
    const manager = this.auditEventRepository.manager;
    const ids = { product: new Set<string>(), branch: new Set<string>(), person: new Set<string>(), user: new Set<string>(), register: new Set<string>(), sale: new Set<string>() };
    const KEY_KIND: Record<string, keyof typeof ids> = {
      productId: 'product',
      branchId: 'branch',
      originBranchId: 'branch',
      destinationBranchId: 'branch',
      customerPersonId: 'person',
      supplierPersonId: 'person',
      personId: 'person',
      sellerUserId: 'user',
      authorizedByUserId: 'user',
      registerId: 'register',
      saleId: 'sale',
    };
    const AGGREGATE_KIND: Record<string, keyof typeof ids> = { PRODUCT: 'product', BRANCH: 'branch', PERSON: 'person', USER: 'user', CASH_REGISTER: 'register', SALE: 'sale' };
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    for (const event of events) {
      const aggregateKind = AGGREGATE_KIND[event.aggregateType];
      if (aggregateKind && uuid.test(event.aggregateId)) ids[aggregateKind].add(event.aggregateId);
      for (const [key, value] of Object.entries(event.metadata ?? {})) {
        const kind = KEY_KIND[key];
        if (kind && typeof value === 'string' && uuid.test(value)) ids[kind].add(value);
      }
    }
    const lookup = async (kind: keyof typeof ids, sql: string): Promise<Array<[string, string]>> => {
      const list = [...ids[kind]];
      if (list.length === 0) return [];
      const rows = (await manager.query(sql.replace('(?)', `(${list.map(() => '?').join(', ')})`), [tenantId, ...list])) as Array<{ id: string; label: string | null }>;
      return rows.filter((row) => row.label).map((row) => [String(row.id), String(row.label)]);
    };
    const pairs = (
      await Promise.all([
        lookup('product', `SELECT id, CONCAT(name, ' (', sku, ')') AS label FROM products WHERE tenant_id = ? AND id IN (?)`),
        lookup('branch', `SELECT id, name AS label FROM branches WHERE tenant_id = ? AND id IN (?)`),
        lookup('person', `SELECT id, TRIM(CONCAT_WS(' ', NULLIF(last_name, '-'), first_name)) AS label FROM persons WHERE tenant_id = ? AND id IN (?)`),
        lookup(
          'user',
          `SELECT u.id, COALESCE(NULLIF(TRIM(CONCAT_WS(' ', p.first_name, p.last_name)), ''), u.username) AS label
             FROM users u JOIN tenant_memberships m ON m.user_id = u.id AND m.tenant_id = ? LEFT JOIN persons p ON p.id = u.person_id
            WHERE u.id IN (?)`,
        ),
        lookup('register', `SELECT id, CONCAT(name, ' (', code, ')') AS label FROM cash_registers WHERE tenant_id = ? AND id IN (?)`),
        lookup(
          'sale',
          `SELECT s.id, CONCAT('Venta $ ', FORMAT(s.total, 2, 'es_AR'), COALESCE(CONCAT(' · ', NULLIF(TRIM(CONCAT_WS(' ', NULLIF(p.last_name, '-'), p.first_name)), '')), '')) AS label
             FROM sales s LEFT JOIN persons p ON p.id = s.customer_person_id AND p.tenant_id = s.tenant_id
            WHERE s.tenant_id = ? AND s.id IN (?)`,
        ),
      ])
    ).flat();
    const labels = new Map(pairs);
    return events.map((event) => {
      const refs: Record<string, string> = {};
      if (labels.has(event.aggregateId)) refs[event.aggregateId] = labels.get(event.aggregateId) as string;
      for (const value of Object.values(event.metadata ?? {})) {
        if (typeof value === 'string' && labels.has(value)) refs[value] = labels.get(value) as string;
      }
      return Object.assign(event, { refs });
    });
  }
}
