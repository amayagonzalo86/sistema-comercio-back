import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity } from './entities/user.entity';
import { UsersService } from './user.service';
import { AssignBranchDto } from './dto/assign-branch.dto';
import { UserRoleEnum } from '../roles/entities/role.entity';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createUserDto: CreateUserDto,
  ): Promise<Omit<UserEntity, 'passwordHash' | 'currentHashedRefreshToken'>> {
    return await this.usersService.create(createUserDto);
  }

  @Get()
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  async findAll(): Promise<UserEntity[]> {
    return await this.usersService.findAll();
  }

  @Get(':id')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
  ): Promise<UserEntity> {
    return await this.usersService.findOne(id);
  }

  @Patch('assign-branch')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  @HttpCode(HttpStatus.OK)
  async assignBranch(@Body() assignBranchDto: AssignBranchDto): Promise<UserEntity> {
    return await this.usersService.assignBranch( assignBranchDto );
  };

  @Delete('unassign-branch')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  @HttpCode(HttpStatus.OK)
  async unassignBranch(@Param('id', ParseUUIDPipe) userId: string): Promise<{ message: string }> {
    return await this.usersService.unassignBranch(userId);
  }

  @Get('by-branch/:branchId')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER)
  async findUsersByBranch(
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ): Promise<UserEntity[]> {
    return await this.usersService.findUsersByBranch(branchId);
  }

  @Patch(':id')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  async update(@Param('id', ParseUUIDPipe) id: string, @Body() updateUserDto: UpdateUserDto): Promise<UserEntity> {
    return await this.usersService.update(id, updateUserDto);
  };

  @Delete(':id/disable')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  async disable(@Param('id', ParseUUIDPipe) id: string): Promise<{ message: string }> {
    return await this.usersService.disable(id);
  };

  @Patch(':id/enable')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  async enable(@Param('id', ParseUUIDPipe) id: string): Promise<{ message: string }> {
    return await this.usersService.enable(id);
  };
}