import { Global, Module } from '@nestjs/common';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuditEventEntity } from './entities/audit-event.entity';
import { FiscalProfileEntity } from './entities/fiscal-profile.entity';
import { TenantMembershipEntity } from './entities/tenant-membership.entity';
import { TenantEntity } from './entities/tenant.entity';

@Global()
@Module({
  imports: [
    TypeOrmModule.forFeature([
      TenantEntity,
      TenantMembershipEntity,
      AuditEventEntity,
      FiscalProfileEntity,
    ]),
  ],
  providers: [TenantContextGuard],
  exports: [TypeOrmModule, TenantContextGuard],
})
export class PlatformModule {}
