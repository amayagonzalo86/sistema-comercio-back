import { Body, Controller, Get, Headers, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Req, UseGuards, BadRequestException, Query } from '@nestjs/common';
import { Request } from 'express';
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

@Controller('products')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.STOCK_CLERK )
  @HttpCode(HttpStatus.CREATED)
  async create(@GetTenantId() tenantId: string, @Req() request: Request, @Body() createProductDto: CreateProductDto): Promise<ProductEntity> {
    const actor = request.user as { id: string };
    return await this.productsService.create(tenantId, actor.id, createProductDto);
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
    const actor = request.user as { id: string };
    return this.productsService.adjustStock(tenantId, actor.id, productId, branchId, idempotencyKey, dto);
  }

  @Get(':productId/branches/:branchId/stock-movements')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.STOCK_CLERK)
  async findStockMovements(
    @GetTenantId() tenantId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Query() query: StockMovementQueryDto,
  ): Promise<{ items: InventoryMovementEntity[]; nextCursor: string | null }> {
    return this.productsService.findStockMovements(tenantId, productId, branchId, query);
  }

  @Get(':id')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.STOCK_CLERK)
  async findOne( @Param('id', ParseUUIDPipe) id: string, @GetTenantId() tenantId: string ): Promise<ProductEntity> {
    return await this.productsService.findOne(id, tenantId);
  }

  @Get('branch/:branchId')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.STOCK_CLERK)
  async findByBranch(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @GetTenantId() tenantId: string,
  ): Promise<ProductBranchEntity[]> { return await this.productsService.findByBranch(tenantId, branchId) }
}