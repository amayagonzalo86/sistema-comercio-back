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
import { GetTenantId } from '../../../common/decorators/get-tenant.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { Paginated } from '../../../common/dto/page-query.dto';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TenantContextGuard } from '../../../common/guards/tenant-context.guard';
import { buildAuditContext } from '../../../common/http/request-context';
import { requireAssignedBranch } from '../../../common/security/tenant-branch-access';
import { UserRoleEnum } from '../../roles/entities/role.entity';
import { LowStockQueryDto, ReplenishmentQueryDto, StockMatrixQueryDto } from './dto/stock-insights.dto';
import {
  CancelStockTransferDto,
  CreateStockTransferDto,
  ReceiveStockTransferDto,
  StockTransferQueryDto,
} from './dto/stock-transfer.dto';
import { StockTransferEntity } from './entities/stock-transfer.entity';
import { LowStockRow, ReplenishmentView, StockInsightsService, StockMatrixRow } from './stock-insights.service';
import { StockTransfersService, TransferActor } from './stock-transfers.service';

type ActorRequest = Request & { user: { id: string; branchId?: string | null; tenantRole?: string } };

const OPERATE = [UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.STOCK_CLERK, UserRoleEnum.WAREHOUSE];
const READ = [...OPERATE, UserRoleEnum.USER];

function actorOf(request: ActorRequest): TransferActor {
  const branchId = requireAssignedBranch(request.user) ?? request.user.branchId ?? null;
  return { id: request.user.id, branchId };
}

/** Transferencias de mercadería entre sucursales. */
@Controller('stock-transfers')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class StockTransfersController {
  constructor(private readonly transfers: StockTransfersService) {}

  /** Despacha mercadería: descuenta del origen y queda en tránsito. Requiere encabezado Idempotency-Key. */
  @Post()
  @Roles(...OPERATE)
  @HttpCode(HttpStatus.CREATED)
  create(
    @GetTenantId() tenantId: string,
    @Req() request: ActorRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateStockTransferDto,
  ): Promise<StockTransferEntity> {
    if (!idempotencyKey) throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    return this.transfers.create(tenantId, actorOf(request), idempotencyKey, dto, buildAuditContext(request));
  }

  @Get()
  @Roles(...READ)
  list(
    @GetTenantId() tenantId: string,
    @Req() request: ActorRequest,
    @Query() query: StockTransferQueryDto,
  ): Promise<Paginated<StockTransferEntity>> {
    return this.transfers.list(tenantId, query, actorOf(request).branchId);
  }

  @Get(':id')
  @Roles(...READ)
  findOne(
    @GetTenantId() tenantId: string,
    @Req() request: ActorRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<StockTransferEntity> {
    return this.transfers.findOne(tenantId, id, actorOf(request).branchId);
  }

  /** Recibe en destino. Sin líneas recibe todo; con líneas registra faltantes. */
  @Post(':id/receive')
  @Roles(...OPERATE)
  @HttpCode(HttpStatus.OK)
  receive(
    @GetTenantId() tenantId: string,
    @Req() request: ActorRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReceiveStockTransferDto,
  ): Promise<StockTransferEntity> {
    return this.transfers.receive(tenantId, actorOf(request), id, dto, buildAuditContext(request));
  }

  /** Anula una transferencia en tránsito y devuelve el stock al origen. */
  @Post(':id/cancel')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  @HttpCode(HttpStatus.OK)
  cancel(
    @GetTenantId() tenantId: string,
    @Req() request: ActorRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelStockTransferDto,
  ): Promise<StockTransferEntity> {
    return this.transfers.cancel(tenantId, actorOf(request), id, dto, buildAuditContext(request));
  }
}

/** Monitoreo de stock en todas las sucursales. */
@Controller('inventory')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class InventoryInsightsController {
  constructor(private readonly insights: StockInsightsService) {}

  /** Matriz producto × sucursal con stock y alertas. */
  @Get('stock-matrix')
  @Roles(...READ)
  matrix(@GetTenantId() tenantId: string, @Query() query: StockMatrixQueryDto): Promise<Paginated<StockMatrixRow>> {
    return this.insights.matrix(tenantId, query);
  }

  /** Productos por debajo del mínimo (de su sucursal o de todas). */
  @Get('low-stock')
  @Roles(...READ, UserRoleEnum.CASHIER, UserRoleEnum.SELLER)
  lowStock(
    @GetTenantId() tenantId: string,
    @Req() request: ActorRequest,
    @Query() query: LowStockQueryDto,
  ): Promise<Paginated<LowStockRow>> {
    return this.insights.lowStock(tenantId, query, actorOf(request).branchId);
  }

  /** Plan sugerido de reposición: transferencias entre sucursales y compras necesarias. */
  @Get('replenishment')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.USER)
  replenishment(@GetTenantId() tenantId: string, @Query() query: ReplenishmentQueryDto): Promise<ReplenishmentView> {
    return this.insights.replenishment(tenantId, query);
  }
}
