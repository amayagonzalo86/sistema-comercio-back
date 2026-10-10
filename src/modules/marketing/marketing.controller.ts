import { Body, Controller, Get, Header, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Paginated } from '../../common/dto/page-query.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { buildAuditContext } from '../../common/http/request-context';
import { UserRoleEnum } from '../roles/entities/role.entity';
import {
  CreatePromotionDto,
  CustomerInsightQueryDto,
  InactiveCustomersQueryDto,
  PromotionQueryDto,
  UpdatePromotionDto,
} from './dto/promotion.dto';
import { PromotionEntity } from './entities/promotion.entity';
import { MarketingService } from './marketing.service';

const MANAGE = [UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER];

function branchScope(request: Request): string | null {
  return (request.user as { branchId?: string | null }).branchId ?? null;
}

/** Promociones automáticas y análisis de clientes. */
@Controller('marketing')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class MarketingController {
  constructor(private readonly marketing: MarketingService) {}

  @Post('promotions')
  @Roles(...MANAGE)
  @HttpCode(HttpStatus.CREATED)
  createPromotion(@GetTenantId() tenantId: string, @Req() request: Request, @Body() dto: CreatePromotionDto): Promise<PromotionEntity> {
    return this.marketing.createPromotion(tenantId, (request.user as { id: string }).id, dto, buildAuditContext(request));
  }

  /** ?current=true lista solo las vigentes hoy (útil para mostrarlas en el POS). */
  @Get('promotions')
  @Roles(...MANAGE, UserRoleEnum.CASHIER, UserRoleEnum.SELLER, UserRoleEnum.USER)
  listPromotions(@GetTenantId() tenantId: string, @Query() query: PromotionQueryDto): Promise<Paginated<PromotionEntity>> {
    return this.marketing.listPromotions(tenantId, query);
  }

  @Get('promotions/:id')
  @Roles(...MANAGE, UserRoleEnum.CASHIER, UserRoleEnum.SELLER, UserRoleEnum.USER)
  getPromotion(@GetTenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<PromotionEntity> {
    return this.marketing.getPromotion(tenantId, id);
  }

  /** Activar/desactivar, renombrar o cambiar la vigencia. */
  @Patch('promotions/:id')
  @Roles(...MANAGE)
  updatePromotion(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePromotionDto,
  ): Promise<PromotionEntity> {
    return this.marketing.updatePromotion(tenantId, (request.user as { id: string }).id, id, dto, buildAuditContext(request));
  }

  @Get('customers/top')
  @Roles(...MANAGE, UserRoleEnum.USER)
  topCustomers(@GetTenantId() tenantId: string, @Req() request: Request, @Query() query: CustomerInsightQueryDto) {
    return this.marketing.topCustomers(tenantId, query, branchScope(request));
  }

  @Get('customers/inactive')
  @Roles(...MANAGE, UserRoleEnum.USER)
  inactiveCustomers(@GetTenantId() tenantId: string, @Query() query: InactiveCustomersQueryDto) {
    return this.marketing.inactiveCustomers(tenantId, query);
  }

  @Get('customers/summary')
  @Roles(...MANAGE, UserRoleEnum.USER)
  customerSummary(@GetTenantId() tenantId: string, @Req() request: Request, @Query() query: CustomerInsightQueryDto) {
    return this.marketing.customerSummary(tenantId, query, branchScope(request));
  }

  /** CSV de contactos con consentimiento de marketing. Solo titulares y administradores. */
  @Get('customers/contacts.csv')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  @Header('Content-Type', 'text/csv; charset=utf-8')
  @Header('Content-Disposition', 'attachment; filename="contactos-marketing.csv"')
  exportContacts(@GetTenantId() tenantId: string, @Req() request: Request): Promise<string> {
    return this.marketing.exportContacts(tenantId, (request.user as { id: string }).id, buildAuditContext(request));
  }
}
