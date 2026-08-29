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
import { GetUser } from '../auth/decorators/get-user.decorator';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { UserEntity, UserRole } from './entities/user.entity';
import { UsersService } from './user.service';
import { AssignBranchDto } from './dto/assign-branch.dto';

@Controller('users')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createUserDto: CreateUserDto,
    @GetUser('tenantId') tenantId: string,
  ): Promise<Omit<UserEntity, 'passwordHash'>> {
    return await this.usersService.create(createUserDto, tenantId);
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async findAll(
    @GetUser('tenantId') tenantId: string,
  ): Promise<UserEntity[]> {
    return await this.usersService.findAllByTenant(tenantId);
  }

  @Patch(':id/assign-branch')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async assignBranch(
    @Param('id', ParseUUIDPipe) userId: string,
    @Body() assignBranchDto: AssignBranchDto,
    @GetUser('tenantId') tenantId: string,
    @GetUser('id') adminId: string,
  ): Promise<UserEntity> {
    return await this.usersService.assignBranch(userId, assignBranchDto, tenantId, adminId);
  }

  @Delete(':id/unassign-branch')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.OK)
  async unassignBranch(
    @Param('id', ParseUUIDPipe) userId: string,
    @GetUser('tenantId') tenantId: string,
    @GetUser('id') adminId: string,
  ): Promise<{ message: string }> {
    return await this.usersService.unassignBranch(userId, tenantId, adminId);
  }

  @Get('by-branch/:branchId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  async findUsersByBranch(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @GetUser('tenantId') tenantId: string,
  ): Promise<UserEntity[]> {
    return await this.usersService.findUsersByBranch(branchId, tenantId);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('tenantId') tenantId: string,
    @Body() updateUserDto: UpdateUserDto,
  ): Promise<UserEntity> {
    return await this.usersService.update(id, tenantId, updateUserDto);
  }

  @Delete(':id/disable')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async disable(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('tenantId') tenantId: string,
  ): Promise<{ message: string }> {
    return await this.usersService.disable(id, tenantId);
  }

  @Patch(':id/enable')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async enable(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('tenantId') tenantId: string,
  ): Promise<{ message: string }> {
    return await this.usersService.enable(id, tenantId);
  }
}