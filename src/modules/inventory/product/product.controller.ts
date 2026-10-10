import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Put, Req, UseGuards, BadRequestException, Query, ForbiddenException } from '@nestjs/common';
import { Request } from 'express';
import { buildAuditContext } from '../../../common/http/request-context';
import { UpdateProductVatDto } from './dto/update-product-vat.dto';
import { BranchPriceView, BulkPriceResult, CatalogService, ProductListItem } from './catalog.service';
import {
  BulkPriceUpdateDto,
  EditProductDto,
  PriceHistoryQueryDto,
  ProductListQueryDto,
  UpdateProductStatusDto,
  UpsertBranchPriceDto,
} from './dto/catalog.dto';
import { Paginated } from '../../../common/dto/page-query.dto';
import { ProductPriceHistoryEntity } from './entities/product-price-history.entity';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TenantContextGuard } from '../../../common/guards/tenant-context.guard';
import { GetTenantId } from '../../../common/decorators/get-tenant.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductEntity } from './entities/product.entity';
import { ProductBranchEntity } from './entities/product-branch.entity';
import { ProductsService } from '../../../modules/inventory/product/product.service';
import { UserRoleEnum } from '../../roles/entities/role.entity';
import { AdjustStockDto } from './dto/adjust-stock.dto';
import { InventoryMovementEntity } from './entities/inventory-movement.entity';
import { StockMovementQueryDto } from './dto/stock-movement-query.dto';
import { InventoryAuditContext } from './inventory-audit-context';
import { requireAssignedBranch, requireBranchAccess } from '../../../common/security/tenant-branch-access';

@Controller('products')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly catalogService: CatalogService,
  ) {}

  /** Catálogo paginado con búsqueda (nombre, SKU, código de barras) y filtros. */
  @Get()
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER, UserRoleEnum.STOCK_CLERK, UserRoleEnum.WAREHOUSE, UserRoleEnum.USER)
  async list(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Query() query: ProductListQueryDto,
  ): Promise<Paginated<ProductListItem>> {
    const actor = request.user as { branchId?: string | null; tenantRole?: string };
    return this.catalogService.list(tenantId, query, requireAssignedBranch(actor));
  }

  /** Categorías y marcas existentes, para armar filtros. */
  @Get('facets')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER, UserRoleEnum.STOCK_CLERK, UserRoleEnum.WAREHOUSE, UserRoleEnum.USER)
  facets(@GetTenantId() tenantId: string) {
    return this.catalogService.facets(tenantId);
  }

  /**
   * Ajuste masivo de precios por porcentaje (por categoría, marca, productos y/o sucursales).
   * Enviar primero con "dryRun": true para ver la vista previa y luego con false para aplicar.
   */
  @Post('price-updates')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  @HttpCode(HttpStatus.OK)
  bulkPriceUpdate(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Body() dto: BulkPriceUpdateDto,
  ): Promise<BulkPriceResult> {
    const actor = request.user as { id: string; branchId?: string | null };
    return this.catalogService.bulkPriceUpdate(tenantId, actor.id, dto, actor.branchId ?? null, this.auditContext(request));
  }

  /** Edita los datos generales del producto (nombre, SKU, categoría, marca, etc.). */
  @Patch(':id')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  edit(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) productId: string,
    @Body() dto: EditProductDto,
  ): Promise<ProductEntity> {
    const actor = request.user as { id: string };
    return this.catalogService.edit(tenantId, actor.id, productId, dto, this.auditContext(request));
  }

  /** Activa o desactiva un producto (no se borra: conserva el historial de ventas). */
  @Patch(':id/status')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  setStatus(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductStatusDto,
  ): Promise<ProductEntity> {
    const actor = request.user as { id: string };
    return this.catalogService.setStatus(tenantId, actor.id, productId, dto, this.auditContext(request));
  }

  /** Precio, costo, margen y stock mínimo en una sucursal (la habilita si no estaba). */
  @Put(':id/branches/:branchId')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  upsertBranchPrice(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) productId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: UpsertBranchPriceDto,
  ): Promise<BranchPriceView> {
    const actor = request.user as { id: string; branchId?: string | null; tenantRole?: string };
    if (actor.branchId && actor.branchId !== branchId) {
      throw new ForbiddenException('Solo puede modificar precios de su sucursal.');
    }
    return this.catalogService.upsertBranchPrice(tenantId, actor.id, productId, branchId, dto, this.auditContext(request));
  }

  /** Historial de cambios de costo y precio de un producto. */
  @Get(':id/price-history')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.USER)
  priceHistory(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) productId: string,
    @Query() query: PriceHistoryQueryDto,
  ): Promise<Paginated<ProductPriceHistoryEntity>> {
    const actor = request.user as { branchId?: string | null };
    return this.catalogService.priceHistory(tenantId, productId, query, actor.branchId ?? null);
  }

  @Post()
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.STOCK_CLERK)
  @HttpCode(HttpStatus.CREATED)
  async create(@GetTenantId() tenantId: string, @Req() request: Request, @Body() createProductDto: CreateProductDto): Promise<ProductEntity> {
    const actor = request.user as { id: string; branchId?: string | null; tenantRole?: string };
    const assignedBranchId = requireAssignedBranch(actor);
    if (assignedBranchId && createProductDto.branchSettings.some((setting) => setting.branchId !== assignedBranchId)) {
      throw new ForbiddenException('No puede configurar stock en otra sucursal.');
    }
    return await this.productsService.create(tenantId, actor.id, createProductDto, this.auditContext(request));
  }

  @Post(':productId/branches/:branchId/stock-adjustments')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.STOCK_CLERK)
  @HttpCode(HttpStatus.CREATED)
  async adjustStock(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: AdjustStockDto,
  ): Promise<InventoryMovementEntity> {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const actor = request.user as { id: string; branchId?: string | null; tenantRole?: string };
    requireBranchAccess(actor, branchId);
    return this.productsService.adjustStock(tenantId, actor.id, productId, branchId, idempotencyKey, dto, this.auditContext(request));
  }

  private auditContext(request: Request): InventoryAuditContext {
    return buildAuditContext(request);
  }

  /**
   * Asigna o quita el IVA de un producto. Solo titulares, administradores y gerentes.
   * Ejemplos de cuerpo:
   *  { "vatTreatment": "TAXED", "taxRate": 10.5, "priceIncludesVat": true, "reason": "Alimento canasta básica" }
   *  { "vatTreatment": "EXEMPT", "reason": "Libro - exento art. 7 Ley de IVA" }
   */
  @Patch(':id/vat')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  @HttpCode(HttpStatus.OK)
  async updateVat(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) productId: string,
    @Body() dto: UpdateProductVatDto,
  ): Promise<ProductEntity> {
    const actor = request.user as { id: string };
    return this.productsService.updateVat(tenantId, actor.id, productId, dto, this.auditContext(request));
  }

  @Get(':productId/branches/:branchId/stock-movements')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.STOCK_CLERK)
  async findStockMovements(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: StockMovementQueryDto,
  ): Promise<{ items: InventoryMovementEntity[]; nextCursor: string | null }> {
    requireBranchAccess(request.user as { branchId?: string | null; tenantRole?: string }, branchId);
    return this.productsService.findStockMovements(tenantId, productId, branchId, query);
  }

  @Get(':id')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.STOCK_CLERK)
  async findOne( @Param('id', ParseUUIDPipe) id: string, @GetTenantId() tenantId: string, @Req() request: Request ): Promise<ProductEntity> {
    const actor = request.user as { branchId?: string | null; tenantRole?: string };
    requireAssignedBranch(actor);
    return await this.productsService.findOne(id, tenantId, actor.branchId ?? null);
  }

  @Get('branch/:branchId')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.STOCK_CLERK)
  async findByBranch(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Req() request: Request,
    @GetTenantId() tenantId: string,
  ): Promise<ProductBranchEntity[]> {
    requireBranchAccess(request.user as { branchId?: string | null; tenantRole?: string }, branchId);
    return this.productsService.findByBranch(tenantId, branchId);
  }

}