import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { DataSource } from 'typeorm';
import { UserEntity } from '../users/entities/user.entity';
import { AuditEventEntity } from './entities/audit-event.entity';
import {
  MembershipStatus,
  TenantMembershipEntity,
  TenantRole,
} from './entities/tenant-membership.entity';
import { TenantEntity, TenantStatus } from './entities/tenant.entity';
import { CreateTenantDto } from './dto/create-tenant.dto';

@Injectable()
export class TenantProvisioningService {
  constructor(private readonly dataSource: DataSource) {}

  async create(dto: CreateTenantDto, actorUserId: string): Promise<TenantEntity> {
    const queryRunner = this.dataSource.createQueryRunner();
    await queryRunner.connect();
    await queryRunner.startTransaction();

    try {
      const owner = await queryRunner.manager.findOne(UserEntity, {
        where: { id: dto.ownerUserId, isActive: true },
      });
      if (!owner) {
        throw new NotFoundException('El usuario propietario no existe o está inactivo.');
      }

      const tenant = queryRunner.manager.create(TenantEntity, {
        slug: dto.slug.trim().toLowerCase(),
        legalName: dto.legalName.trim(),
        tradeName: dto.tradeName?.trim() || null,
        taxId: dto.taxId || null,
        status: TenantStatus.TRIAL,
      });
      const savedTenant = await queryRunner.manager.save(TenantEntity, tenant);

      const membership = queryRunner.manager.create(TenantMembershipEntity, {
        tenantId: savedTenant.id,
        userId: owner.id,
        role: TenantRole.OWNER,
        status: MembershipStatus.ACTIVE,
        acceptedAt: new Date(),
      });
      await queryRunner.manager.save(TenantMembershipEntity, membership);

      const auditEvent = queryRunner.manager.create(AuditEventEntity, {
        tenantId: savedTenant.id,
        actorUserId,
        eventType: 'TENANT_CREATED',
        aggregateType: 'TENANT',
        aggregateId: savedTenant.id,
        metadata: { slug: savedTenant.slug },
      });
      await queryRunner.manager.save(AuditEventEntity, auditEvent);

      await queryRunner.commitTransaction();
      return savedTenant;
    } catch (error) {
      await queryRunner.rollbackTransaction();
      if (error instanceof NotFoundException) throw error;
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        (error.code === 'ER_DUP_ENTRY' || error.code === '23505')
      ) {
        throw new ConflictException('El slug o CUIT ya está registrado.');
      }
      throw error;
    } finally {
      await queryRunner.release();
    }
  }
}
