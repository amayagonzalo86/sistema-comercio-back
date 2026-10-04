import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AuditEventEntity } from './entities/audit-event.entity';
import { AuditEventQueryDto } from './dto/audit-event-query.dto';

export interface AuditEventPage {
  items: AuditEventEntity[];
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
    const items = hasMore ? rows.slice(0, limit) : rows;
    return {
      items,
      nextCursor: hasMore ? items[items.length - 1].id : null,
    };
  }
}
