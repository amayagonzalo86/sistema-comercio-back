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
  Patch,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { ArrayMaxSize, IsArray, IsOptional, IsUUID } from 'class-validator';
import { GetTenantId } from '../../../common/decorators/get-tenant.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TenantContextGuard } from '../../../common/guards/tenant-context.guard';
import { buildAuditContext } from '../../../common/http/request-context';
import { requireAssignedBranch } from '../../../common/security/tenant-branch-access';
import { UserRoleEnum } from '../../roles/entities/role.entity';
import { CustomerAccountsService } from './customer-accounts.service';
import {
  AccountSettingsDto,
  CreateCreditAuthorizationDto,
  CreateReceiptDto,
  CustomerAccountQueryDto,
  StatementQueryDto,
  UpdateCreditDto,
} from './dto/customer-account.dto';

type ActorRequest = Request & { user: { id: string; branchId?: string | null; tenantRole?: string } };

const scope = (request: ActorRequest) => requireAssignedBranch(request.user) ?? request.user.branchId ?? null;

class BillInterestDto {
  /** Movimientos (ventas a cuenta) a los que se les cobran intereses; si no se envía, todos los vencidos. */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  entryIds?: string[];
}

/** Cuentas corrientes de clientes: deudores, resumen, crédito, recibos e intereses por mora. */
@Controller('customer-accounts')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class CustomerAccountsController {
  constructor(private readonly accounts: CustomerAccountsService) {}

  @Get('settings')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.USER)
  settings(@GetTenantId() tenantId: string) {
    return this.accounts.settings(tenantId);
  }

  /** Tasa de interés por mora: decisión comercial de titular o administración. */
  @Put('settings')
  @Roles(UserRoleEnum.ADMIN)
  updateSettings(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Body() dto: AccountSettingsDto) {
    return this.accounts.updateSettings(tenantId, request.user.id, dto, buildAuditContext(request));
  }

  @Get()
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.USER)
  list(@GetTenantId() tenantId: string, @Query() query: CustomerAccountQueryDto) {
    return this.accounts.list(tenantId, query);
  }

  @Get(':personId')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.USER)
  detail(@GetTenantId() tenantId: string, @Param('personId', ParseUUIDPipe) personId: string, @Query() query: StatementQueryDto) {
    return this.accounts.detail(tenantId, personId, query);
  }

  /** Habilitar la cuenta corriente, límite y plazo: titular, administración o encargado. Queda auditado. */
  @Patch(':personId/credit')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  updateCredit(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Param('personId', ParseUUIDPipe) personId: string, @Body() dto: UpdateCreditDto) {
    return this.accounts.updateCredit(tenantId, request.user.id, personId, dto, buildAuditContext(request));
  }

  /** Autoriza una venta a cuenta por encima del límite o con deuda vencida (una venta, hasta fin del día). */
  @Post(':personId/authorizations')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  authorize(
    @GetTenantId() tenantId: string,
    @Req() request: ActorRequest,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() dto: CreateCreditAuthorizationDto,
  ) {
    return this.accounts.authorize(tenantId, request.user.id, personId, dto, buildAuditContext(request));
  }

  /** Recibo de cobranza (Idempotency-Key obligatorio). */
  @Post(':personId/receipts')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER)
  @HttpCode(HttpStatus.CREATED)
  createReceipt(
    @GetTenantId() tenantId: string,
    @Req() request: ActorRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() dto: CreateReceiptDto,
  ) {
    if (!idempotencyKey) throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    return this.accounts.createReceipt(tenantId, { id: request.user.id, branchId: scope(request) }, personId, idempotencyKey, dto, buildAuditContext(request));
  }

  /** Notas de débito por intereses por mora (pendientes de cobro, asociadas a cada factura). */
  @Post(':personId/interest')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  billInterest(
    @GetTenantId() tenantId: string,
    @Req() request: ActorRequest,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Param('personId', ParseUUIDPipe) personId: string,
    @Body() dto: BillInterestDto,
  ) {
    if (!idempotencyKey) throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    return this.accounts.billInterest(tenantId, { id: request.user.id, branchId: scope(request) }, personId, idempotencyKey, dto.entryIds, buildAuditContext(request));
  }
}

@Controller('customer-receipts')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class CustomerReceiptsController {
  constructor(private readonly accounts: CustomerAccountsService) {}

  @Get(':id')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.USER)
  receipt(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.accounts.receipt(tenantId, id, scope(request));
  }
}
