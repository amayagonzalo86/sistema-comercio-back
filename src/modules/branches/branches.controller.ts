import {
  Body,
  Controller,
  Delete,
  ForbiddenException,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Request } from 'express';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { BranchEntity } from './entities/branch.entity';
import { UserRoleEnum } from '../roles/entities/role.entity';

@Controller('branches')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) { }

  @Post()
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(@GetTenantId() tenantId: string, @Body() createBranchDto: CreateBranchDto): Promise<BranchEntity> {
    return await this.branchesService.create(tenantId, createBranchDto);
  }

  @Get()
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.STOCK_CLERK, UserRoleEnum.SELLER )
  async findAll(@GetTenantId() tenantId: string, @Req() request: Request): Promise<BranchEntity[]> {
    const actor = request.user as { branchId?: string | null; tenantRole?: string };
    this.requireScopedMembership(actor);
    return await this.branchesService.findAll(tenantId, actor.branchId ?? null);
  }

  @Get(':id')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.STOCK_CLERK )
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenantId() tenantId: string,
    @Req() request: Request,
  ): Promise<BranchEntity> {
    const actor = request.user as { branchId?: string | null; tenantRole?: string };
    this.requireBranch(actor, id);
    return await this.branchesService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  async update(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenantId() tenantId: string,
    @Body() updateBranchDto: UpdateBranchDto,
    @Req() request: Request,
  ): Promise<BranchEntity> {
    this.requireBranch(request.user as { branchId?: string | null; tenantRole?: string }, id);
    return await this.branchesService.update(id, tenantId, updateBranchDto);
  }

  @Delete(':id')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  async remove(
    @Param('id', ParseUUIDPipe) id: string,
    @GetTenantId() tenantId: string,
    @Req() request: Request,
  ): Promise<{ message: string }> {
    this.requireBranch(request.user as { branchId?: string | null; tenantRole?: string }, id);
    return await this.branchesService.remove(id, tenantId);
  }

  private requireScopedMembership(user: { branchId?: string | null; tenantRole?: string }): void {
    if (['CASHIER', 'SELLER', 'INVENTORY'].includes(user.tenantRole ?? '') && !user.branchId) {
      throw new ForbiddenException('El usuario debe tener una sucursal asignada en esta empresa.');
    }
  }

  private requireBranch(user: { branchId?: string | null; tenantRole?: string }, branchId: string): void {
    this.requireScopedMembership(user);
    if (user.branchId && user.branchId !== branchId) {
      throw new ForbiddenException('No tiene acceso a la sucursal solicitada.');
    }
  }
}