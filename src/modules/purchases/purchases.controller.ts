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
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { buildAuditContext } from '../../common/http/request-context';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { requireAssignedBranch, requireBranchAccess } from '../../common/security/tenant-branch-access';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { CreatePurchaseReceiptDto } from './dto/create-purchase-receipt.dto';
import { PurchasesService } from './purchases.service';

@Controller('purchases/receipts')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class PurchasesController {
  constructor(private readonly purchasesService: PurchasesService) {}

  @Post()
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.STOCK_CLERK)
  @HttpCode(HttpStatus.CREATED)
  async receive(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreatePurchaseReceiptDto,
  ): Promise<Record<string, unknown>> {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const actor = request.user as { id: string; branchId?: string | null; tenantRole?: string };
    requireBranchAccess(actor, dto.branchId);
    return this.purchasesService.receive(
      tenantId,
      actor.id,
      idempotencyKey,
      dto,
      actor.branchId ?? null,
      buildAuditContext(request),
    );
  }

  @Get(':id')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.STOCK_CLERK)
  async findOne(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<Record<string, unknown>> {
    const actor = request.user as { branchId?: string | null; tenantRole?: string };
    const branchId = requireAssignedBranch(actor);
    return this.purchasesService.findOne(tenantId, id, branchId);
  }
}
