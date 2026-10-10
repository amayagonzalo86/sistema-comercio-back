import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Paginated } from '../../common/dto/page-query.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { buildAuditContext } from '../../common/http/request-context';
import { requireAssignedBranch } from '../../common/security/tenant-branch-access';
import { UserRoleEnum } from '../roles/entities/role.entity';
import {
  CancelPurchaseOrderDto,
  CreatePurchaseOrderDto,
  PurchaseOrderFromReplenishmentDto,
  PurchaseOrderQueryDto,
  UpdatePurchaseOrderDto,
} from './dto/purchase-order.dto';
import { PurchaseOrderEntity } from './entities/purchase-order.entity';
import { PurchaseOrdersService } from './purchase-orders.service';

type ActorRequest = Request & { user: { id: string; branchId?: string | null; tenantRole?: string } };

const MANAGE = [UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.STOCK_CLERK, UserRoleEnum.WAREHOUSE];

function actorOf(request: ActorRequest) {
  return { id: request.user.id, branchId: requireAssignedBranch(request.user) ?? request.user.branchId ?? null };
}

/**
 * Pedidos de compra a proveedores.
 * Flujo: crear (borrador) → editar → enviar → recibir con POST /purchases/receipts indicando purchaseOrderId.
 */
@Controller('purchase-orders')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class PurchaseOrdersController {
  constructor(private readonly orders: PurchaseOrdersService) {}

  @Post()
  @Roles(...MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Body() dto: CreatePurchaseOrderDto): Promise<PurchaseOrderEntity> {
    return this.orders.create(tenantId, actorOf(request), dto, buildAuditContext(request));
  }

  /** Borrador automático con los faltantes de una sucursal. */
  @Post('from-replenishment')
  @Roles(...MANAGE)
  @HttpCode(HttpStatus.CREATED)
  fromReplenishment(
    @GetTenantId() tenantId: string,
    @Req() request: ActorRequest,
    @Body() dto: PurchaseOrderFromReplenishmentDto,
  ): Promise<PurchaseOrderEntity> {
    return this.orders.fromReplenishment(tenantId, actorOf(request), dto, buildAuditContext(request));
  }

  @Get()
  @Roles(...MANAGE, UserRoleEnum.USER)
  list(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Query() query: PurchaseOrderQueryDto): Promise<Paginated<PurchaseOrderEntity>> {
    return this.orders.list(tenantId, query, actorOf(request).branchId);
  }

  @Get(':id')
  @Roles(...MANAGE, UserRoleEnum.USER)
  findOne(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Param('id', ParseUUIDPipe) id: string): Promise<PurchaseOrderEntity> {
    return this.orders.findOne(tenantId, id, actorOf(request).branchId);
  }

  @Patch(':id')
  @Roles(...MANAGE)
  update(
    @GetTenantId() tenantId: string,
    @Req() request: ActorRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePurchaseOrderDto,
  ): Promise<PurchaseOrderEntity> {
    return this.orders.update(tenantId, actorOf(request), id, dto, buildAuditContext(request));
  }

  @Post(':id/send')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  @HttpCode(HttpStatus.OK)
  send(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Param('id', ParseUUIDPipe) id: string): Promise<PurchaseOrderEntity> {
    return this.orders.send(tenantId, actorOf(request), id, buildAuditContext(request));
  }

  @Post(':id/cancel')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  @HttpCode(HttpStatus.OK)
  cancel(
    @GetTenantId() tenantId: string,
    @Req() request: ActorRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelPurchaseOrderDto,
  ): Promise<PurchaseOrderEntity> {
    return this.orders.cancel(tenantId, actorOf(request), id, dto, buildAuditContext(request));
  }
}
