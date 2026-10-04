import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditEventEntity } from './entities/audit-event.entity';
import { FiscalProfileEntity } from './entities/fiscal-profile.entity';
import { TenantMembershipEntity } from './entities/tenant-membership.entity';
import { TenantEntity } from './entities/tenant.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TenantEntity,
      TenantMembershipEntity,
      AuditEventEntity,
      FiscalProfileEntity,
    ]),
  ],
  exports: [TypeOrmModule],
})
export class PlatformModule {}
