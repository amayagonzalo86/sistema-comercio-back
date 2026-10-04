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
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { InventoryAuditContext } from '../inventory/product/inventory-audit-context';
import { CreateSaleDto } from './dto/create-sale.dto';
import { SalesService } from './sales.service';

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
    const auditContext: InventoryAuditContext = {
      requestId: (request as Request & { requestId?: string }).requestId,
      ipAddress: request.socket.remoteAddress ?? null,
      userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
    };
    if (['CASHIER', 'SELLER', 'INVENTORY'].includes(actor.tenantRole ?? '') && !actor.branchId) {
      throw new ForbiddenException('El usuario debe tener una sucursal asignada en esta empresa.');
    }
    if (actor.branchId && actor.branchId !== dto.branchId) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
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
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.salesService.findOne(tenantId, id);
  }
}
