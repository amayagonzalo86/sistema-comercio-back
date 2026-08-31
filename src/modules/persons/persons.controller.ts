import { Controller, Get, Post, Body, Patch, Param, Delete, HttpStatus, HttpCode, UseGuards } from '@nestjs/common';
import { PersonsService } from './persons.service';
import { CreatePersonDto } from './dto/create-person.dto';
import { UpdatePersonDto } from './dto/update-person.dto';
import { UserRole } from '../users/entities/user.entity';
import { Roles } from '../../common/decorators/roles.decorator';
import { PersonEntity } from './entities/person.entity';
import { AuthGuard } from '@nestjs/passport';
import { RolesGuard } from '../../common/guards/roles.guard';

@Controller('persons')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class PersonsController {
  constructor(private readonly personsService: PersonsService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.CASHIER, UserRole.SELLER)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createPersonDto: CreatePersonDto): Promise<PersonEntity> {
    return await this.personsService.create(createPersonDto);
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
