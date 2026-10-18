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
import { CashXReportDto, CloseCashSessionDto } from './dto/close-cash-session.dto';
import { CashSessionQueryDto } from './dto/cash-session-query.dto';
import { actorTenantRoles } from '../../common/security/tenant-roles';
import { CreateCashMovementDto } from './dto/create-cash-movement.dto';
import { CreateCashRegisterDto } from './dto/create-cash-register.dto';
import { OpenCashSessionDto } from './dto/open-cash-session.dto';
import { CashService } from './cash.service';

type CashActor = { id: string; branchId?: string | null; tenantRole?: string; tenantRoles?: string[] };

/** Caja (apertura, movimientos, cierres X/Z, historial): titular, administración y encargados. */
const CASH_ADMIN_ROLES = [UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER] as const;

/** El cajero solo ve qué caja está abierta (para cobrar), sin importes. */
function seesCashAmounts(actor: CashActor): boolean {
  return actorTenantRoles(actor).some((role) => role === 'OWNER' || role === 'ADMIN' || role === 'MANAGER');
}

@Controller('cash')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class CashController {
  constructor(private readonly cashService: CashService) {}

  @Post('registers')
  @Roles(...CASH_ADMIN_ROLES)
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
    return this.cashService.listRegisters(tenantId, requireAssignedBranch(actor), branchId, seesCashAmounts(actor));
  }

  @Post('registers/:registerId/sessions')
  @Roles(...CASH_ADMIN_ROLES)
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

  /** Historial de cajas. */
  @Get('sessions')
  @Roles(...CASH_ADMIN_ROLES)
  listSessions(@GetTenantId() tenantId: string, @Req() request: Request, @Query() query: CashSessionQueryDto) {
    const actor = request.user as CashActor;
    if (query.branchId) requireBranchAccess(actor, query.branchId);
    return this.cashService.listSessions(tenantId, requireAssignedBranch(actor), query);
  }

  /** Detalle de una caja con su resumen y sus cierres X/Z. */
  @Get('sessions/:sessionId')
  @Roles(...CASH_ADMIN_ROLES)
  findSession(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
  ) {
    return this.cashService.sessionDetail(tenantId, sessionId, requireAssignedBranch(request.user as CashActor));
  }

  /** Cierre X: informe parcial; la caja sigue abierta. */
  @Post('sessions/:sessionId/x-reports')
  @Roles(...CASH_ADMIN_ROLES)
  @HttpCode(HttpStatus.CREATED)
  xReport(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CashXReportDto,
  ) {
    if (!idempotencyKey) {
      throw new BadRequestException('El encabezado Idempotency-Key es obligatorio.');
    }
    const actor = request.user as CashActor;
    return this.cashService.xReport(tenantId, actor.id, sessionId, idempotencyKey, dto, requireAssignedBranch(actor), this.auditContext(request));
  }

  /** Productos vendidos y ventas de la caja (detalle). */
  @Get('sessions/:sessionId/sales')
  @Roles(...CASH_ADMIN_ROLES)
  sessionSales(@GetTenantId() tenantId: string, @Req() request: Request, @Param('sessionId', ParseUUIDPipe) sessionId: string) {
    return this.cashService.sessionSalesDetail(tenantId, sessionId, requireAssignedBranch(request.user as CashActor));
  }

  /** Detalle de un cierre X o Z: lo cobrado hasta ese cierre. */
  @Get('reports/:reportId/sales')
  @Roles(...CASH_ADMIN_ROLES)
  reportSales(@GetTenantId() tenantId: string, @Req() request: Request, @Param('reportId', ParseUUIDPipe) reportId: string) {
    return this.cashService.reportSalesDetail(tenantId, reportId, requireAssignedBranch(request.user as CashActor));
  }

  /** Cierre X o Z para imprimir. */
  @Get('reports/:reportId')
  @Roles(...CASH_ADMIN_ROLES)
  getReport(@GetTenantId() tenantId: string, @Req() request: Request, @Param('reportId', ParseUUIDPipe) reportId: string) {
    return this.cashService.getReport(tenantId, reportId, requireAssignedBranch(request.user as CashActor));
  }

  @Post('sessions/:sessionId/movements')
  @Roles(...CASH_ADMIN_ROLES)
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
  @Roles(...CASH_ADMIN_ROLES)
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

  /** Cierre Z: arqueo y cierre definitivo de la caja. */
  @Post('sessions/:sessionId/close')
  @Roles(...CASH_ADMIN_ROLES)
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
