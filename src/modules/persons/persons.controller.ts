import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { PersonsService } from './persons.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { PersonListQueryDto } from './dto/person-query.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { PersonEntity } from './entities/person.entity';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { Paginated } from '../../common/dto/page-query.dto';

const READ_ROLES = [
  UserRoleEnum.SUPER_ADMIN,
  UserRoleEnum.ADMIN,
  UserRoleEnum.MANAGER,
  UserRoleEnum.CASHIER,
  UserRoleEnum.SELLER,
  UserRoleEnum.STOCK_CLERK,
  UserRoleEnum.WAREHOUSE,
  UserRoleEnum.USER,
];

/** Clientes y proveedores. */
@Controller('persons')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class PersonsController {
  constructor(private readonly personsService: PersonsService) {}

  @Post()
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.SELLER)
  @HttpCode(HttpStatus.CREATED)
  async create(@GetTenantId() tenantId: string, @Body() createPersonDto: CreatePersonDto): Promise<PersonEntity> {
    return await this.personsService.create(tenantId, createPersonDto);
  }

  /** Listado paginado. ?role=customers|suppliers|all&status=active|inactive|all&search=... */
  @Get()
  @Roles(...READ_ROLES)
  findAll(@GetTenantId() tenantId: string, @Query() query: PersonListQueryDto): Promise<Paginated<PersonEntity>> {
    return this.personsService.findAll(tenantId, query);
  }

  @Get(':id')
  @Roles(...READ_ROLES)
  findOne(@GetTenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<PersonEntity> {
    return this.personsService.findOne(tenantId, id);
  }

  @Patch(':id')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  update(
    @GetTenantId() tenantId: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdatePersonDto,
  ): Promise<PersonEntity> {
    return this.personsService.update(tenantId, id, dto);
  }

  @Patch(':id/deactivate')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  deactivate(@GetTenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<PersonEntity> {
    return this.personsService.setActive(tenantId, id, false);
  }

  @Patch(':id/activate')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  activate(@GetTenantId() tenantId: string, @Param('id', ParseUUIDPipe) id: string): Promise<PersonEntity> {
    return this.personsService.setActive(tenantId, id, true);
  }
}
