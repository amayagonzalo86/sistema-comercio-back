import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { GetTenantId } from '../../../common/decorators/get-tenant.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TenantContextGuard } from '../../../common/guards/tenant-context.guard';
import { buildAuditContext } from '../../../common/http/request-context';
import { requireAssignedBranch } from '../../../common/security/tenant-branch-access';
import { UserRoleEnum } from '../../roles/entities/role.entity';
import { ChecksService } from './checks.service';
import { CheckQueryDto, UpdateCheckStatusDto } from './dto/check.dto';

type ActorRequest = Request & { user: { id: string; branchId?: string | null; tenantRole?: string } };

const scope = (request: ActorRequest) => requireAssignedBranch(request.user) ?? request.user.branchId ?? null;

/** Cheques recibidos en cobros: cartera, vencimientos y estado (depositado, acreditado, rechazado). */
@Controller('checks')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class ChecksController {
  constructor(private readonly checks: ChecksService) {}

  @Get()
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.USER)
  list(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Query() query: CheckQueryDto) {
    return this.checks.list(tenantId, query, scope(request));
  }

  /** Lo actualizan titular, administración y encargado (tesorería). Queda auditado. */
  @Patch(':id/status')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  updateStatus(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCheckStatusDto) {
    return this.checks.updateStatus(tenantId, request.user.id, id, dto, scope(request), buildAuditContext(request));
  }
}
