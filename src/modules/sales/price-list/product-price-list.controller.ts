import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { GetTenantId } from '../../../common/decorators/get-tenant.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TenantContextGuard } from '../../../common/guards/tenant-context.guard';
import { buildAuditContext } from '../../../common/http/request-context';
import { requireBranchAccess } from '../../../common/security/tenant-branch-access';
import { UserRoleEnum } from '../../roles/entities/role.entity';
import { CreatePriceListDto, UpdatePriceListDto } from './dto/price-list.dto';
import { PriceListService } from './price-list.service';

type ActorRequest = Request & { user: { id: string; branchId?: string | null; tenantRole?: string } };

/** Administran las listas: titular, administración y encargado. */
const MANAGE = [UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER];
/** Las ven quienes venden o consultan precios. */
const READ = [...MANAGE, UserRoleEnum.CASHIER, UserRoleEnum.SELLER, UserRoleEnum.STOCK_CLERK, UserRoleEnum.WAREHOUSE, UserRoleEnum.USER];

@Controller('price-lists')
@UseGuards(JwtAuthGuard, TenantContextGuard, RolesGuard)
export class ProductPriceListController {
  constructor(private readonly priceLists: PriceListService) {}

  /** Listas activas (con ?includeInactive=true también las desactivadas; las eliminadas nunca). */
  @Get()
  @Roles(...READ)
  list(@GetTenantId() tenantId: string, @Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean) {
    return this.priceLists.list(tenantId, includeInactive === true);
  }

  @Get(':id')
  @Roles(...READ)
  findOne(@GetTenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string) {
    return this.priceLists.findOne(tenantId, id);
  }

  @Post()
  @Roles(...MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Body() dto: CreatePriceListDto) {
    return this.priceLists.create(tenantId, request.user.id, dto, buildAuditContext(request));
  }

  @Patch(':id')
  @Roles(...MANAGE)
  update(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePriceListDto) {
    return this.priceLists.update(tenantId, request.user.id, id, dto, buildAuditContext(request));
  }

  @Delete(':id')
  @Roles(...MANAGE)
  remove(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.priceLists.remove(tenantId, request.user.id, id, buildAuditContext(request));
  }

  @Get(':priceListId/products/:productId/branches/:branchId/calculated-price')
  @Roles(...READ)
  getCalculatedPrice(
    @Param('priceListId', ParseUUIDPipe) priceListId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @GetTenantId() tenantId: string,
    @Req() request: ActorRequest,
  ) {
    requireBranchAccess(request.user, branchId);
    return this.priceLists.getCalculatedProductPrice(tenantId, productId, branchId, priceListId);
  }
}
