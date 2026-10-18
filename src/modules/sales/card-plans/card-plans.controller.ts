import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseBoolPipe, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { Request } from 'express';
import { GetTenantId } from '../../../common/decorators/get-tenant.decorator';
import { Roles } from '../../../common/decorators/roles.decorator';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { TenantContextGuard } from '../../../common/guards/tenant-context.guard';
import { buildAuditContext } from '../../../common/http/request-context';
import { UserRoleEnum } from '../../roles/entities/role.entity';
import { CardPlansService } from './card-plans.service';
import { CreateCardPlanDto, UpdateCardPlanDto } from './dto/card-plan.dto';

type ActorRequest = Request & { user: { id: string } };

/** Cargan y modifican las tarjetas: plataforma, titular/administración y encargado. */
const MANAGE = [UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER];
/** Las ven quienes cobran o venden. */
const READ = [...MANAGE, UserRoleEnum.CASHIER, UserRoleEnum.SELLER];

@Controller('card-plans')
@UseGuards(JwtAuthGuard, TenantContextGuard, RolesGuard)
export class CardPlansController {
  constructor(private readonly plans: CardPlansService) {}

  /** Planes activos (con ?includeInactive=true también los desactivados, solo para quienes administran). */
  @Get()
  @Roles(...MANAGE)
  list(@GetTenantId() tenantId: string, @Query('includeInactive', new ParseBoolPipe({ optional: true })) includeInactive?: boolean) {
    return this.plans.list(tenantId, includeInactive === true);
  }

  /** Planes vigentes hoy (fecha y día de la semana de la empresa): los que ofrece el modal de cobro. */
  @Get('available')
  @Roles(...READ)
  available(@GetTenantId() tenantId: string) {
    return this.plans.available(tenantId);
  }

  @Post()
  @Roles(...MANAGE)
  @HttpCode(HttpStatus.CREATED)
  create(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Body() dto: CreateCardPlanDto) {
    return this.plans.create(tenantId, request.user.id, dto, buildAuditContext(request));
  }

  @Patch(':id')
  @Roles(...MANAGE)
  update(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCardPlanDto) {
    return this.plans.update(tenantId, request.user.id, id, dto, buildAuditContext(request));
  }

  @Delete(':id')
  @Roles(...MANAGE)
  remove(@GetTenantId() tenantId: string, @Req() request: ActorRequest, @Param('id', ParseUUIDPipe) id: string) {
    return this.plans.remove(tenantId, request.user.id, id, buildAuditContext(request));
  }
}
