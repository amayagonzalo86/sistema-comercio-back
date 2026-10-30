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
import { hasAnyTenantRole } from '../../common/security/tenant-roles';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { InventoryAuditContext } from '../inventory/product/inventory-audit-context';
import { CreateSaleDto, QuoteSaleDto } from './dto/create-sale.dto';
import { SaleQuote, SalesService } from './sales.service';
import { SalesQueryService } from './sales-query.service';
import { SaleQueryDto } from './dto/sale-query.dto';
import { Paginated } from '../../common/dto/page-query.dto';
import { SaleEntity } from './entities/sale.entity';
import { SaleReturnsService } from './returns/sale-returns.service';
import { CreateSaleReturnDto } from './returns/dto/sale-return.dto';
import { SaleReturnEntity } from './returns/entities/sale-return.entity';
import { SaleAdjustmentsService } from './adjustments/sale-adjustments.service';
import { CreateSaleAdjustmentDto } from './adjustments/dto/sale-adjustment.dto';
import { SaleAdjustmentEntity } from './adjustments/entities/sale-adjustment.entity';

const VAT_EXEMPTION_ROLES = new Set(['OWNER', 'ADMIN']);
const CREDIT_OVERRIDE_ROLES = new Set(['OWNER', 'ADMIN', 'MANAGER']);

@Controller('sales')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class SalesController {
  constructor(
    private readonly salesService: SalesService,
    private readonly salesQuery: SalesQueryService,
    private readonly saleReturns: SaleReturnsService,
    private readonly saleAdjustments: SaleAdjustmentsService,
  ) {}

  /** Calcula la venta (promociones, IVA, clase de comprobante y total a cobrar) sin registrarla. */
  @Post('quote')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER)
  @HttpCode(HttpStatus.OK)
  quote(@GetTenantId() tenantId: string, @Req() request: Request, @Body() dto: QuoteSaleDto): Promise<SaleQuote> {
    const actor = request.user as { branchId?: string | null; tenantRole?: string };
    requireBranchAccess(actor, dto.branchId);
    return this.salesService.quote(tenantId, dto, actor.branchId ?? null);
  }

  /** Régimen de IVA de la sucursal y comprobantes que puede emitir la empresa (para el punto de venta). */
  @Get('vat-regime')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER, UserRoleEnum.WAREHOUSE, UserRoleEnum.STOCK_CLERK, UserRoleEnum.USER)
  vatRegime(@GetTenantId() tenantId: string, @Req() request: Request, @Query('branchId', ParseUUIDPipe) branchId: string) {
    const actor = request.user as { branchId?: string | null; tenantRole?: string; tenantRoles?: string[] };
    requireBranchAccess(actor, branchId);
    return this.salesService.vatRegimeFor(tenantId, branchId);
  }

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

  /**
   * Nota de crédito o débito por importe (sin mover mercadería) sobre una venta facturada. Requiere Idempotency-Key.
   * El comprobante electrónico se emite después con POST /fiscal/adjustments/:id/note.
   */
  @Post(':id/adjustments')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER)
  @HttpCode(HttpStatus.CREATED)
  createAdjustment(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateSaleAdjustmentDto,
  ): Promise<SaleAdjustmentEntity> {
    if (!idempotencyKey) throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    const actor = request.user as { id: string; branchId?: string | null; tenantRole?: string };
    const branchId = requireAssignedBranch(actor) ?? actor.branchId ?? null;
    return this.saleAdjustments.create(tenantId, { id: actor.id, branchId }, id, idempotencyKey, dto, buildAuditContext(request));
  }

  @Get(':id/adjustments')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER, UserRoleEnum.USER)
  listAdjustments(@GetTenantId() tenantId: string, @Req() request: Request, @Param('id', ParseUUIDPipe) id: string) {
    const actor = request.user as { branchId?: string | null; tenantRole?: string };
    return this.saleAdjustments.listForSale(tenantId, id, requireAssignedBranch(actor) ?? actor.branchId ?? null);
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

  /**
   * Registra (cobra) una venta. Solo caja y gerencia: el vendedor no cobra, arma pedidos en /sales-orders
   * y la caja los cobra enviando salesOrderId. Así cada cobro tiene un responsable de caja identificado.
   */
  @Post()
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER)
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
    const actor = request.user as { id: string; branchId?: string | null; tenantRole?: string; tenantRoles?: string[] };
    const auditContext: InventoryAuditContext = buildAuditContext(request);
    requireBranchAccess(actor, dto.branchId);
    // Quitar el IVA de una venta es una decisión fiscal: solo titulares y administradores.
    if (dto.vatExemption && !hasAnyTenantRole(actor, VAT_EXEMPTION_ROLES)) {
      throw new ForbiddenException('Solo el titular o un administrador pueden registrar ventas exentas de IVA.');
    }
    if (dto.vatRegime && !hasAnyTenantRole(actor, VAT_EXEMPTION_ROLES)) {
      throw new ForbiddenException('Solo el titular o un administrador pueden cambiar el régimen de IVA de una venta.');
    }
    return this.salesService.create(
      tenantId,
      actor.id,
      idempotencyKey,
      dto,
      auditContext,
      actor.branchId ?? null,
      // Vender a cuenta por encima del límite o con deuda vencida: decisión de titular, administración o encargado.
      { canOverrideCredit: hasAnyTenantRole(actor, CREDIT_OVERRIDE_ROLES) },
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
