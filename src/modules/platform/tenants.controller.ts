import {
  Body,
  Controller,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { PlatformSuperAdminGuard } from '../../common/guards/platform-super-admin.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantProvisioningService } from './tenant-provisioning.service';

type AuthenticatedRequest = Request & { user: { id: string } };

@Controller('platform/tenants')
@UseGuards(AuthGuard('jwt'), PlatformSuperAdminGuard)
export class TenantsController {
  constructor(private readonly tenantProvisioning: TenantProvisioningService) {}

  @Post()
  create(
    @Body() dto: CreateTenantDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.tenantProvisioning.create(dto, request.user.id);
  }
}
