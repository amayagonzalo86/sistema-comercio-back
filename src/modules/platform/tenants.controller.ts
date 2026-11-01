import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseEnumPipe,
  ParseUUIDPipe,
  Put,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { buildAuditContext } from '../../common/http/request-context';
import { UpdateBranchVatRegimeDto, UpdateTenantDisplayNameDto, UpdateTenantVatRegimeDto } from './dto/vat-regime.dto';
import { PlatformTenantVatView, PlatformVatService } from './platform-vat.service';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { PlatformSuperAdminGuard } from '../../common/guards/platform-super-admin.guard';
import { CreateTenantDto } from './dto/create-tenant.dto';
import { TenantProvisioningService } from './tenant-provisioning.service';
import { TenantModule } from '../../common/modules/tenant-modules';
import { UpdateTenantModuleDto } from './dto/tenant-module.dto';
import { PlatformModulesService, TenantModulesView } from './platform-modules.service';
import { PlatformDevicesService, TenantDevicesView } from './platform-devices.service';
import { ApproveDeviceDto, RenameDeviceDto, TrustedDeviceQueryDto, UpdateDeviceApprovalDto } from './dto/trusted-device.dto';
import { TrustedDeviceStatus } from '../auth/entities/trusted-device.entity';

type AuthenticatedRequest = Request & { user: { id: string } };

@Controller('platform/tenants')
@UseGuards(AuthGuard('jwt'), PlatformSuperAdminGuard)
export class TenantsController {
  constructor(
    private readonly tenantProvisioning: TenantProvisioningService,
    private readonly platformVat: PlatformVatService,
    private readonly platformModules: PlatformModulesService,
    private readonly platformDevices: PlatformDevicesService,
  ) {}

  /** Equipos de la empresa (pendientes primero) y si exige equipos autorizados. */
  @Get(':tenantId/devices')
  devices(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Query() query: TrustedDeviceQueryDto): Promise<TenantDevicesView> {
    return this.platformDevices.view(tenantId, query.status as TrustedDeviceStatus | undefined);
  }

  /** Exigir equipos autorizados (requiere al menos un equipo aprobado). */
  @Patch(':tenantId/device-approval')
  setDeviceApproval(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: UpdateDeviceApprovalDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<TenantDevicesView> {
    return this.platformDevices.setRequired(tenantId, dto.required, request.user.id, buildAuditContext(request));
  }

  @Post(':tenantId/devices/:deviceId/approve')
  @HttpCode(HttpStatus.OK)
  approveDevice(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: ApproveDeviceDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<TenantDevicesView> {
    return this.platformDevices.approve(tenantId, deviceId, dto.name, request.user.id, buildAuditContext(request));
  }

  /** Baja: cierra las sesiones del equipo y bloquea su ingreso. */
  @Post(':tenantId/devices/:deviceId/revoke')
  @HttpCode(HttpStatus.OK)
  revokeDevice(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Req() request: AuthenticatedRequest,
  ): Promise<TenantDevicesView> {
    return this.platformDevices.revoke(tenantId, deviceId, request.user.id, buildAuditContext(request));
  }

  @Patch(':tenantId/devices/:deviceId')
  renameDevice(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('deviceId', ParseUUIDPipe) deviceId: string,
    @Body() dto: RenameDeviceDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<TenantDevicesView> {
    return this.platformDevices.rename(tenantId, deviceId, dto.name, request.user.id, buildAuditContext(request));
  }

  /** Módulos de la empresa (plan base + los contratados), sucursales activas y límite del plan. */
  @Get(':tenantId/modules')
  modules(@Param('tenantId', ParseUUIDPipe) tenantId: string): Promise<TenantModulesView> {
    return this.platformModules.view(tenantId);
  }

  /** Activa o desactiva un módulo, con vencimiento opcional. Queda auditado. Desactivar no borra datos. */
  @Put(':tenantId/modules/:module')
  setModule(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('module', new ParseEnumPipe(TenantModule)) module: TenantModule,
    @Body() dto: UpdateTenantModuleDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<TenantModulesView> {
    return this.platformModules.update(tenantId, module, dto, request.user.id, buildAuditContext(request));
  }

  /** Empresas con su régimen de IVA y el de cada sucursal. */
  @Get()
  list(): Promise<PlatformTenantVatView[]> {
    return this.platformVat.list();
  }

  /** Nombre de la empresa que se muestra en el encabezado del sistema (no cambia los comprobantes). */
  @Patch(':tenantId/display-name')
  setDisplayName(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: UpdateTenantDisplayNameDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PlatformTenantVatView> {
    return this.platformVat.setDisplayName(tenantId, dto.displayName, request.user.id, buildAuditContext(request));
  }

  /** Régimen de IVA por defecto de la empresa (por ejemplo, Tierra del Fuego — Ley 19.640). */
  @Patch(':tenantId/vat-regime')
  setTenantVatRegime(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Body() dto: UpdateTenantVatRegimeDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PlatformTenantVatView> {
    return this.platformVat.setTenantRegime(tenantId, dto.defaultVatRegime, request.user.id, buildAuditContext(request));
  }

  /** Régimen propio de una sucursal; null vuelve a usar el de la empresa. */
  @Patch(':tenantId/branches/:branchId/vat-regime')
  setBranchVatRegime(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @Body() dto: UpdateBranchVatRegimeDto,
    @Req() request: AuthenticatedRequest,
  ): Promise<PlatformTenantVatView> {
    return this.platformVat.setBranchRegime(tenantId, branchId, dto.vatRegime, request.user.id, buildAuditContext(request));
  }

  @Post()
  create(
    @Body() dto: CreateTenantDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.tenantProvisioning.create(dto, request.user.id);
  }
}
