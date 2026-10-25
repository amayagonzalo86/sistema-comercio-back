import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { GetTenantId } from '../../../common/decorators/get-tenant.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Paginated } from '../../../common/dto/page-query.dto';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TenantContextGuard } from '../../../common/guards/tenant-context.guard';
import { buildAuditContext } from '../../../common/http/request-context';
import { requireAssignedBranch, requireBranchAccess } from '../../../common/security/tenant-branch-access';
import { UserRoleEnum } from '../../roles/entities/role.entity';
import { CancelSalesOrderDto, CreateSalesOrderDto, SalesOrderQueryDto } from './dto/sales-order.dto';
import { SalesOrderActor, SalesOrdersService, SalesOrderView } from './sales-orders.service';
import { RequiresModule, TenantModule } from '../../../common/modules/tenant-modules';

type RequestActor = { id: string; branchId?: string | null; tenantRole?: string; tenantRoles?: string[] };

/**
 * Pedidos de venta (preventa). El vendedor los arma; el cajero los cobra con POST /sales enviando salesOrderId.
 * Todas las rutas quedan limitadas a la sucursal asignada del usuario cuando la tiene.
 */
@RequiresModule(TenantModule.PRESALE)
@Controller('sales-orders')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class SalesOrdersController {
  constructor(private readonly orders: SalesOrdersService) {}

  @Post()
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER)
  @HttpCode(HttpStatus.CREATED)
  create(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateSalesOrderDto,
  ): Promise<SalesOrderView> {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const actor = request.user as RequestActor;
    requireBranchAccess(actor, dto.branchId);
    return this.orders.create(tenantId, this.toActor(actor), idempotencyKey, dto, buildAuditContext(request));
  }

  @Get()
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER, UserRoleEnum.USER)
  list(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Query() query: SalesOrderQueryDto,
  ): Promise<Paginated<SalesOrderView>> {
    const actor = request.user as RequestActor;
    return this.orders.list(tenantId, query, requireAssignedBranch(actor));
  }

  @Get('by-number/:number')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER, UserRoleEnum.USER)
  findByNumber(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('number', new ParseIntPipe({ errorHttpStatusCode: HttpStatus.BAD_REQUEST })) number: number,
  ): Promise<SalesOrderView> {
    if (number < 1 || number > 4_294_967_295) {
      throw new BadRequestException('Número de pedido inválido.');
    }
    const actor = request.user as RequestActor;
    return this.orders.findByNumber(tenantId, number, requireAssignedBranch(actor));
  }

  @Get(':id')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER, UserRoleEnum.USER)
  findOne(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<SalesOrderView> {
    const actor = request.user as RequestActor;
    return this.orders.findOne(tenantId, id, requireAssignedBranch(actor));
  }

  /** Anula un pedido pendiente. Gerencia y caja anulan cualquiera; el vendedor, solo los suyos. */
  @Post(':id/cancel')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER)
  @HttpCode(HttpStatus.OK)
  cancel(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelSalesOrderDto,
  ): Promise<SalesOrderView> {
    const actor = request.user as RequestActor;
    return this.orders.cancel(tenantId, this.toActor(actor), id, dto, buildAuditContext(request));
  }

  private toActor(actor: RequestActor): SalesOrderActor {
    return { id: actor.id, branchId: requireAssignedBranch(actor), tenantRole: actor.tenantRole, tenantRoles: actor.tenantRoles };
  }
}
