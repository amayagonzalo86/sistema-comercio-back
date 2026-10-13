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
  const managerQuery = jest.fn();
  const repository = {
    createQueryBuilder: jest.fn(),
    manager: { query: managerQuery },
  } as unknown as Repository<AuditEventEntity>;
  let service: AuditEventsService;

  beforeEach(() => {
    jest.clearAllMocks();
    queryBuilder.where.mockReturnValue(queryBuilder);
    queryBuilder.andWhere.mockReturnValue(queryBuilder);
    queryBuilder.orderBy.mockReturnValue(queryBuilder);
    queryBuilder.take.mockReturnValue(queryBuilder);
    repository.createQueryBuilder = jest.fn().mockReturnValue(queryBuilder);
    managerQuery.mockResolvedValue([]);
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
    expect(page).toEqual({ items: [{ id: '9007199254740999', actorName: 'Sistema', actorType: 'SYSTEM' }], nextCursor: null });
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

  it('muestra el nombre del empleado y oculta la identidad del soporte de la plataforma', async () => {
    queryBuilder.getMany.mockResolvedValue([
      { id: '3', actorUserId: 'operator-1', ipAddress: '200.1.1.1', userAgent: 'Chrome' },
      { id: '2', actorUserId: 'employee-1', ipAddress: '10.0.0.5', userAgent: 'Firefox' },
    ]);
    managerQuery.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('users_roles')
          ? [{ user_id: 'operator-1' }]
          : [
              { id: 'operator-1', name: 'Dueño del Sistema' },
              { id: 'employee-1', name: 'Julián Sosa' },
            ],
      ),
    );

    const page = await service.findTenantEvents('tenant-a', new AuditEventQueryDto());

    expect(page.items[0]).toMatchObject({ actorUserId: null, ipAddress: null, userAgent: null, actorName: 'Soporte de la plataforma', actorType: 'PLATFORM_SUPPORT' });
    expect(JSON.stringify(page.items[0])).not.toContain('Dueño del Sistema');
    expect(page.items[1]).toMatchObject({ actorUserId: 'employee-1', ipAddress: '10.0.0.5', actorName: 'Julián Sosa', actorType: 'USER' });
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
