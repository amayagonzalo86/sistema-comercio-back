import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './user.controller';
import { EmployeesController } from './employees.controller';
import { EmployeesService } from './employees.service';
import { UsersService } from '../users/user.service';
import { UserEntity } from './entities/user.entity';
import { BranchEntity } from '../branches/entities/branch.entity';
import { PersonEntity } from '../persons/entities/person.entity';
import { RoleEntity } from '../roles/entities/role.entity';
import { TenantMembershipEntity } from '../platform/entities/tenant-membership.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, BranchEntity, PersonEntity, RoleEntity, TenantMembershipEntity])],
  controllers: [UsersController, EmployeesController],
  providers: [UsersService, EmployeesService],
  exports: [UsersService, TypeOrmModule],
})
export class UserModule { }