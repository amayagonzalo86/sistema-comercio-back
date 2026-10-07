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
  Query,
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
import { SalesQueryService } from './sales-query.service';
import { SaleQueryDto } from './dto/sale-query.dto';
import { Paginated } from '../../common/dto/page-query.dto';
import { SaleEntity } from './entities/sale.entity';
import { SaleReturnsService } from './returns/sale-returns.service';
import { CreateSaleReturnDto } from './returns/dto/sale-return.dto';
import { SaleReturnEntity } from './returns/entities/sale-return.entity';

const VAT_EXEMPTION_ROLES = new Set(['OWNER', 'ADMIN']);

@Controller('sales')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly salesQuery: SalesQueryService,
    private readonly saleReturns: SaleReturnsService,
  ) {}

  /** Listado de ventas con filtros (sucursal, fechas, cliente, vendedor, medio de pago, comprobante). */
  @Get()
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER, UserRoleEnum.USER)
  list(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Query() query: SaleQueryDto,
  ): Promise<Paginated<SaleEntity>> {
    const actor = request.user as { branchId?: string | null; tenantRole?: string };
    return this.salesQuery.list(tenantId, query, requireAssignedBranch(actor) ?? actor.branchId ?? null);
  }

  /**
   * Devolución total (sin líneas) o parcial de una venta. Requiere Idempotency-Key.
   * Reingresa stock si restock=true y, si es en efectivo, registra el egreso en la caja indicada.
   */
  @Post(':id/returns')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER)
  @HttpCode(HttpStatus.CREATED)
  createReturn(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateSaleReturnDto,
  ): Promise<SaleReturnEntity> {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const actor = request.user as { id: string; branchId?: string | null; tenantRole?: string };
    const branchId = requireAssignedBranch(actor) ?? actor.branchId ?? null;
    return this.saleReturns.create(tenantId, { id: actor.id, branchId }, id, idempotencyKey, dto, buildAuditContext(request));
  }

  @Get(':id/returns')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER, UserRoleEnum.USER)
  listReturns(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SaleReturnEntity[]> {
    const actor = request.user as { branchId?: string | null; tenantRole?: string };
    return this.saleReturns.listForSale(tenantId, id, requireAssignedBranch(actor) ?? actor.branchId ?? null);
  }

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
