import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, Put, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { buildAuditContext } from '../../common/http/request-context';
import { requireAssignedBranch } from '../../common/security/tenant-branch-access';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { CreatePointOfSaleDto, FiscalDocumentQueryDto, UpsertFiscalProfileDto } from './dto/fiscal.dto';
import { FiscalService } from './fiscal.service';

type ActorRequest = Request & { user: { id: string; branchId?: string | null; tenantRole?: string } };
const scope = (request: ActorRequest) => requireAssignedBranch(request.user) ?? request.user.branchId ?? null;

const OWNER = [UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN];
const ISSUE = [...OWNER, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER];
const READ = [...ISSUE, UserRoleEnum.SELLER, UserRoleEnum.USER];

/**
 * Factura electrónica ARCA (WSFEv1).
 * Configuración: PUT /fiscal/profile → POST /fiscal/points-of-sale → GET /fiscal/status.
 * Emisión: POST /fiscal/sales/:id/invoice y POST /fiscal/returns/:id/credit-note (idempotentes y reintentables).
 */
@Controller('fiscal')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class FiscalController {
  constructor(private readonly fiscal: FiscalService) {}

  @Get('profile')
  @Roles(...OWNER, UserRoleEnum.MANAGER, UserRoleEnum.USER)
  profile(@GetTenantId() tenantId: string) {
    return this.fiscal.getProfile(tenantId);
  }

  @Put('profile')
  @Roles(...OWNER)
  upsertProfile(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Body() dto: UpsertFiscalProfileDto) {
    return this.fiscal.upsertProfile(tenantId, request.user.id, dto, buildAuditContext(request));
  }

  @Get('points-of-sale')
  @Roles(...READ)
  pointsOfSale(@GetTenantId() tenantId: string) {
    return this.fiscal.listPointsOfSale(tenantId);
  }

  @Post('points-of-sale')
  @Roles(...OWNER)
  @HttpCode(HttpStatus.CREATED)
  createPointOfSale(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Body() dto: CreatePointOfSaleDto) {
    return this.fiscal.createPointOfSale(tenantId, request.user.id, dto, buildAuditContext(request));
  }

  /** Verifica servidores de ARCA y credenciales (certificado/clave) de la empresa. */
  @Get('status')
  @Roles(...OWNER, UserRoleEnum.MANAGER)
  status(@GetTenantId() tenantId: string) {
    return this.fiscal.status(tenantId);
  }

  /** Tabla oficial de condiciones frente al IVA del receptor, consultada en ARCA. */
  @Get('receiver-conditions')
  @Roles(...OWNER)
  receiverConditions(@GetTenantId() tenantId: string) {
    return this.fiscal.receiverConditions(tenantId);
  }

  @Post('sales/:id/invoice')
  @Roles(...ISSUE)
  @HttpCode(HttpStatus.OK)
  invoiceSale(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.fiscal.invoiceSale(tenantId, request.user.id, id, scope(request), buildAuditContext(request));
  }

  @Post('returns/:id/credit-note')
  @Roles(...ISSUE)
  @HttpCode(HttpStatus.OK)
  creditNote(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.fiscal.creditNoteForReturn(tenantId, request.user.id, id, scope(request), buildAuditContext(request));
  }

  @Get('documents')
  @Roles(...READ)
  documents(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Query() query: FiscalDocumentQueryDto) {
    return this.fiscal.listDocuments(tenantId, query, scope(request));
  }

  /** Datos completos para imprimir el comprobante, incluido el QR obligatorio. */
  @Get('documents/:id')
  @Roles(...READ)
  document(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.fiscal.getDocument(tenantId, id, scope(request));
  }
}
