import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEventEntity } from './entities/audit-event.entity';
import { AuditEventQueryDto } from './dto/audit-event-query.dto';
import { PLATFORM_SUPPORT_LABEL, platformOperatorIds } from '../../common/security/platform-operators';

export type AuditActorType = 'USER' | 'PLATFORM_SUPPORT' | 'SYSTEM';

export type AuditEventView = AuditEventEntity & {
  /** Nombre legible de quien hizo la acción (empleado, "Soporte de la plataforma" o "Sistema"). */
  actorName: string;
  actorType: AuditActorType;
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
    if (filters.from) {
      query.andWhere('audit.createdAt >= :from', { from: filters.from });
    }
    if (filters.to) {
      query.andWhere('audit.createdAt <= :to', { to: filters.to });
    }

    const rows = await query
      .orderBy('audit.id', 'DESC')
      .take(limit + 1)
      .getMany();

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    return {
      items: await this.withActors(page),
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
}
