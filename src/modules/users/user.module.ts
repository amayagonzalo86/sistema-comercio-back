import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UsersController } from './user.controller';
import { UsersService } from '../users/user.service';
import { UserEntity } from './entities/user.entity';
import { BranchEntity } from '../branches/entities/branch.entity';

@Module({
  imports: [TypeOrmModule.forFeature([UserEntity, BranchEntity])],
  controllers: [UsersController],
  providers: [UsersService],
  exports: [UsersService, TypeOrmModule],
})
export class UserModule { }