import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { requireAssignedBranch, requireBranchAccess } from '../../common/security/tenant-branch-access';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { CreateSupplierPaymentDto } from './dto/create-supplier-payment.dto';
import { SupplierPayableQueryDto } from './dto/supplier-payable-query.dto';
import { SupplierAccountsService } from './supplier-accounts.service';

const FINANCE_ROLES = [UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER];

@Controller()
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class SupplierAccountsController {
  constructor(private readonly supplierAccountsService: SupplierAccountsService) {}

  @Get('supplier-payables')
  @Roles(...FINANCE_ROLES)
  async findPayables(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Query() query: SupplierPayableQueryDto,
  ): Promise<{ items: Array<Record<string, unknown>>; nextCursor: string | null }> {
    const actor = request.user as { branchId?: string | null; tenantRole?: string };
    const assignedBranch = requireAssignedBranch(actor);
    if (query.branchId) requireBranchAccess(actor, query.branchId);
    return this.supplierAccountsService.findPayables(
      tenantId,
      query,
      assignedBranch ?? query.branchId ?? null,
    );
  }

  @Get('supplier-payments/:id')
  @Roles(...FINANCE_ROLES)
  async findPayment(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    const actor = request.user as { branchId?: string | null; tenantRole?: string };
    const branchId = requireAssignedBranch(actor);
    return this.supplierAccountsService.findPayment(tenantId, id, branchId);
  }

  @Post('supplier-payments')
  @Roles(...FINANCE_ROLES)
  @HttpCode(HttpStatus.CREATED)
  async createPayment(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateSupplierPaymentDto,
  ): Promise<Record<string, unknown>> {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const actor = request.user as { id: string; branchId?: string | null; tenantRole?: string };
    requireBranchAccess(actor, dto.branchId);
    return this.supplierAccountsService.createPayment(
      tenantId,
      actor.id,
      idempotencyKey,
      dto,
      actor.branchId ?? null,
      {
        requestId: (request as Request & { requestId?: string }).requestId,
        ipAddress: request.socket.remoteAddress ?? null,
        userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
      },
    );
  }
}
