import { Controller, Get, Post, Body, Patch, Param, Delete, HttpStatus, HttpCode, UseGuards } from '@nestjs/common';
import { PersonsService } from './persons.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { Roles } from '../../common/decorators/roles.decorator';
import { PersonEntity } from './entities/person.entity';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';

@Controller('persons')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class PersonsController {
  constructor(private readonly personsService: PersonsService) {}

  @Post()
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.CASHIER, UserRoleEnum.SELLER)
  @HttpCode(HttpStatus.CREATED)
  async create(@GetTenantId() tenantId: string, @Body() createPersonDto: CreatePersonDto): Promise<PersonEntity> {
    return await this.personsService.create(tenantId, createPersonDto);
  };

  // @Get()
  // findAll() {
  //   return this.personsService.findAll();
  // }

  // @Get(':id')
  // findOne(@Param('id') id: string) {
  //   return this.personsService.findOne(+id);
  // }

  // @Patch(':id')
  // update(@Param('id') id: string, @Body() updatePersonDto: UpdatePersonDto) {
  //   return this.personsService.update(+id, updatePersonDto);
  // }

  // @Delete(':id')
  // remove(@Param('id') id: string) {
  //   return this.personsService.remove(+id);
  // }
}
