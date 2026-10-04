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
  Query,
  Req,
  UseGuards,
  BadRequestException,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { requireAssignedBranch, requireBranchAccess } from '../../common/security/tenant-branch-access';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { InventoryAuditContext } from '../inventory/product/inventory-audit-context';
import { CashMovementQueryDto } from './dto/cash-movement-query.dto';
import { CloseCashSessionDto } from './dto/close-cash-session.dto';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import { CreateCashRegisterDto } from './dto/create-cash-register.dto';
import { OpenCashSessionDto } from './dto/open-cash-session.dto';
import { CashService } from './cash.service';

type CashActor = { id: string; branchId?: string | null; tenantRole?: string };

@Controller('cash')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class CashController {
  constructor(private readonly cashService: CashService) {}

  @Post('registers')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  createRegister(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Body() dto: CreateCashRegisterDto,
  ) {
    const actor = request.user as CashActor;
    requireBranchAccess(actor, dto.branchId);
    return this.cashService.createRegister(
      tenantId,
      actor.id,
      dto,
      requireAssignedBranch(actor),
      this.auditContext(request),
    );
  }

  @Get('registers')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER)
  listRegisters(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Query('branchId') branchId?: string,
  ) {
    const actor = request.user as CashActor;
    if (branchId) requireBranchAccess(actor, branchId);
    return this.cashService.listRegisters(tenantId, requireAssignedBranch(actor), branchId);
  }

  @Post('registers/:registerId/sessions')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER)
  @HttpCode(HttpStatus.CREATED)
  openSession(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('registerId', ParseUUIDPipe) registerId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: OpenCashSessionDto,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const actor = request.user as CashActor;
    return this.cashService.openSession(
      tenantId,
      actor.id,
      registerId,
      idempotencyKey,
      dto,
      requireAssignedBranch(actor),
      this.auditContext(request),
    );
  }

  @Get('sessions/:sessionId')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER)
  findSession(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.cashService.findSession(
      tenantId,
      sessionId,
      requireAssignedBranch(request.user as CashActor),
    );
  }

  @Post('sessions/:sessionId/movements')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER)
  @HttpCode(HttpStatus.CREATED)
  recordMovement(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CreateCashMovementDto,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const actor = request.user as CashActor;
    return this.cashService.recordMovement(
      tenantId,
      actor.id,
      sessionId,
      idempotencyKey,
      dto,
      requireAssignedBranch(actor),
      this.auditContext(request),
    );
  }

  @Get('sessions/:sessionId/movements')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER)
  listMovements(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Query() query: CashMovementQueryDto,
  ) {
    return this.cashService.listMovements(
      tenantId,
      sessionId,
      requireAssignedBranch(request.user as CashActor),
      query,
    );
  }

  @Post('sessions/:sessionId/close')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER)
  @HttpCode(HttpStatus.OK)
  closeSession(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CloseCashSessionDto,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const actor = request.user as CashActor;
    return this.cashService.closeSession(
      tenantId,
      actor.id,
      sessionId,
      idempotencyKey,
      dto,
      requireAssignedBranch(actor),
      this.auditContext(request),
    );
  }

  private auditContext(request: Request): InventoryAuditContext {
    return {
      requestId: (request as Request & { requestId?: string }).requestId,
      ipAddress: request.socket.remoteAddress ?? null,
      userAgent: request.headers['user-agent']?.slice(0, 512) ?? null,
    };
  }
}
