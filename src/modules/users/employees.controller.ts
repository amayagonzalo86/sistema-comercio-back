import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { Paginated } from '../../common/dto/page-query.dto';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { buildAuditContext } from '../../common/http/request-context';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { CreateEmployeeDto, EmployeeQueryDto, ResetEmployeePasswordDto, UpdateEmployeeDto } from './dto/employee.dto';
import { EmployeeActor, EmployeesService, EmployeeView } from './employees.service';

/**
 * Empleados de la empresa activa. Solo titular y administración (ambos mapean a ADMIN).
 * Las reglas finas (quién puede tocar administradores, cuentas compartidas, autogestión) están en EmployeesService.
 */
@Controller('employees')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
@Roles(UserRoleEnum.ADMIN)
export class EmployeesController {
  constructor(private readonly employees: EmployeesService) {}

  @Get()
  list(@GetTenantId() tenantId: string, @Query() query: EmployeeQueryDto): Promise<Paginated<EmployeeView>> {
    return this.employees.list(tenantId, query);
  }

  @Get(':id')
  findOne(@GetTenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<EmployeeView> {
    return this.employees.findOne(tenantId, id);
  }

  @Post()
  @HttpCode(HttpStatus.CREATED)
  create(@GetTenantId() tenantId: string, @Req() request: Request, @Body() dto: CreateEmployeeDto): Promise<EmployeeView> {
    return this.employees.create(tenantId, actorOf(request), dto, buildAuditContext(request));
  }

  @Patch(':id')
  update(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateEmployeeDto,
  ): Promise<EmployeeView> {
    return this.employees.update(tenantId, actorOf(request), id, dto, buildAuditContext(request));
  }

  @Post(':id/password')
  @HttpCode(HttpStatus.OK)
  resetPassword(
    @GetTenantId() tenantId: string,
    @Req() request: Request,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResetEmployeePasswordDto,
  ): Promise<{ message: string }> {
    return this.employees.resetPassword(tenantId, actorOf(request), id, dto, buildAuditContext(request));
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  deactivate(@GetTenantId() tenantId: string, @Req() request: Request, @Param('id', ParseUUIDPipe) id: string): Promise<EmployeeView> {
    return this.employees.setActive(tenantId, actorOf(request), id, false, buildAuditContext(request));
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  activate(@GetTenantId() tenantId: string, @Req() request: Request, @Param('id', ParseUUIDPipe) id: string): Promise<EmployeeView> {
    return this.employees.setActive(tenantId, actorOf(request), id, true, buildAuditContext(request));
  }
}

function actorOf(request: Request): EmployeeActor {
  const user = request.user as { id: string; tenantRole?: string; tenantRoles?: string[] };
  return { id: user.id, tenantRole: user.tenantRole, tenantRoles: user.tenantRoles };
}
