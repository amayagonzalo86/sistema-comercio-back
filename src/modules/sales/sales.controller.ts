import {
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
  BadRequestException,
  ForbiddenException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { buildAuditContext } from '../../common/http/request-context';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { requireAssignedBranch, requireBranchAccess } from '../../common/security/tenant-branch-access';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { InventoryAuditContext } from '../inventory/product/inventory-audit-context';
import { CreateSaleDto } from './dto/create-sale.dto';
import { SalesService } from './sales.service';

const VAT_EXEMPTION_ROLES = new Set(['OWNER', 'ADMIN']);

@Controller('sales')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class SalesController {
  constructor(private readonly salesService: SalesService) {}

  @Post()
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateSaleDto,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const actor = request.user as { id: string; branchId?: string | null; tenantRole?: string };
    const auditContext: InventoryAuditContext = buildAuditContext(request);
    requireBranchAccess(actor, dto.branchId);
    // Quitar el IVA de una venta es una decisión fiscal: solo titulares y administradores.
    if (dto.vatExemption && !VAT_EXEMPTION_ROLES.has(actor.tenantRole ?? '')) {
      throw new ForbiddenException('Solo el titular o un administrador pueden registrar ventas exentas de IVA.');
    }
    return this.salesService.create(
      tenantId,
      actor.id,
      idempotencyKey,
      dto,
      auditContext,
      actor.branchId ?? null,
    );
  }

  @Get(':id')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER)
  findOne(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    const actor = request.user as { branchId?: string | null; tenantRole?: string };
    requireAssignedBranch(actor);
    return this.salesService.findOne(tenantId, id, actor.branchId ?? null);
  }
}
