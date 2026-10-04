import { Global, Module } from '@nestjs/common';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantsController } from './tenants.controller';
import { AuditEventsController } from './audit-events.controller';
import { AuditEventsService } from './audit-events.service';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PlatformSuperAdminGuard } from '../../common/guards/platform-super-admin.guard';
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
  controllers: [TenantsController, AuditEventsController],
  providers: [TenantContextGuard, PlatformSuperAdminGuard, TenantProvisioningService, AuditEventsService],
  exports: [TypeOrmModule, TenantContextGuard, PlatformSuperAdminGuard],
})
export class PlatformModule {}
