import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { DeadStockQueryDto, ReportQueryDto, TopProductsQueryDto } from './dto/report-query.dto';
import { DashboardResponse, ReportsService } from './reports.service';

const REPORT_ROLES = [UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.USER];

function branchScope(request: Request): string | null {
  return (request.user as { branchId?: string | null }).branchId ?? null;
}

/**
 * Tablero y reportes del dueño. Titulares, administradores y contadores ven todas las sucursales;
 * un encargado con sucursal asignada ve solo la suya.
 */
@Controller('reports')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
@Roles(...REPORT_ROLES)
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  /** KPIs del período vs. período anterior, desglose por sucursal, hoy y alertas operativas. */
  @Get('dashboard')
  dashboard(@GetTenantId() tenantId: string, @Req() request: Request, @Query() query: ReportQueryDto): Promise<DashboardResponse> {
    return this.reports.dashboard(tenantId, query, branchScope(request));
  }

  @Get('sales-by-day')
  salesByDay(@GetTenantId() tenantId: string, @Req() request: Request, @Query() query: ReportQueryDto) {
    return this.reports.salesByDay(tenantId, query, branchScope(request));
  }

  @Get('sales-by-hour')
  salesByHour(@GetTenantId() tenantId: string, @Req() request: Request, @Query() query: ReportQueryDto) {
    return this.reports.salesByHour(tenantId, query, branchScope(request));
  }

  @Get('top-products')
  topProducts(@GetTenantId() tenantId: string, @Req() request: Request, @Query() query: TopProductsQueryDto) {
    return this.reports.topProducts(tenantId, query, branchScope(request));
  }

  @Get('sales-by-category')
  salesByCategory(@GetTenantId() tenantId: string, @Req() request: Request, @Query() query: ReportQueryDto) {
    return this.reports.salesByCategory(tenantId, query, branchScope(request));
  }

  @Get('sales-by-payment-method')
  salesByPaymentMethod(@GetTenantId() tenantId: string, @Req() request: Request, @Query() query: ReportQueryDto) {
    return this.reports.salesByPaymentMethod(tenantId, query, branchScope(request));
  }

  @Get('sales-by-seller')
  salesBySeller(@GetTenantId() tenantId: string, @Req() request: Request, @Query() query: ReportQueryDto) {
    return this.reports.salesBySeller(tenantId, query, branchScope(request));
  }

  @Get('stock-valuation')
  stockValuation(@GetTenantId() tenantId: string, @Req() request: Request, @Query() query: ReportQueryDto) {
    return this.reports.stockValuation(tenantId, query, branchScope(request));
  }

  @Get('dead-stock')
  deadStock(@GetTenantId() tenantId: string, @Req() request: Request, @Query() query: DeadStockQueryDto) {
    return this.reports.deadStock(tenantId, query, branchScope(request));
  }
}
