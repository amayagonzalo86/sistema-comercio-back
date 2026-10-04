import { BadRequestException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { AuditEventEntity } from './entities/audit-event.entity';
import { AuditEventQueryDto } from './dto/audit-event-query.dto';
import { AuditEventsService } from './audit-events.service';

describe('AuditEventsService', () => {
  const queryBuilder = {
    where: jest.fn(),
    andWhere: jest.fn(),
    orderBy: jest.fn(),
    take: jest.fn(),
    getMany: jest.fn(),
  };
  const repository = {
    createQueryBuilder: jest.fn(),
  } as unknown as Repository<AuditEventEntity>;
  let service: AuditEventsService;

  beforeEach(() => {
    jest.clearAllMocks();
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.andWhere.mockReturnValue(queryBuilder);
    queryBuilder.orderBy.mockReturnValue(queryBuilder);
    queryBuilder.take.mockReturnValue(queryBuilder);
    repository.createQueryBuilder = jest.fn().mockReturnValue(queryBuilder);
    service = new AuditEventsService(repository);
  });

  it('always applies tenant isolation and uses keyset pagination', async () => {
    queryBuilder.getMany.mockResolvedValue([{ id: '9007199254740999' }]);

    const filters = Object.assign(new AuditEventQueryDto(), {
      limit: 25,
      cursor: '9007199254741000',
      eventType: 'SALE_COMPLETED',
    });
    const page = await service.findTenantEvents('tenant-a', filters);

    expect(repository.createQueryBuilder).toHaveBeenCalledWith('audit');
    expect(queryBuilder.where).toHaveBeenCalledWith(
      'audit.tenantId = :tenantId',
      { tenantId: 'tenant-a' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'audit.id < :cursor',
      { cursor: '9007199254741000' },
    );
    expect(queryBuilder.andWhere).toHaveBeenCalledWith(
      'audit.eventType = :eventType',
      { eventType: 'SALE_COMPLETED' },
    );
    expect(queryBuilder.take).toHaveBeenCalledWith(26);
    expect(page).toEqual({ items: [{ id: '9007199254740999' }], nextCursor: null });
  });

  it('returns a next cursor without coercing BIGINT IDs to Number', async () => {
    queryBuilder.getMany.mockResolvedValue([
      { id: '9007199254741010' },
      { id: '9007199254741009' },
      { id: '9007199254741008' },
    ]);

    const page = await service.findTenantEvents(
      'tenant-a',
      Object.assign(new AuditEventQueryDto(), { limit: 2 }),
    );

    expect(page.items.map((item) => item.id)).toEqual([
      '9007199254741010',
      '9007199254741009',
    ]);
    expect(page.nextCursor).toBe('9007199254741009');
  });

  it('rejects an inverted date range', async () => {
    await expect(service.findTenantEvents(
      'tenant-a',
      Object.assign(new AuditEventQueryDto(), {
        from: '2026-10-02T00:00:00.000Z',
        to: '2026-10-01T00:00:00.000Z',
      }),
    )).rejects.toBeInstanceOf(BadRequestException);
    expect(repository.createQueryBuilder).not.toHaveBeenCalled();
  });
});
