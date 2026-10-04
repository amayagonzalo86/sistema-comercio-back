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
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.STOCK_CLERK )
  async findAll(@GetTenantId() tenantId: string): Promise<BranchEntity[]> {
    return await this.branchesService.findAll(tenantId);
  }

  @Get(':id')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.STOCK_CLERK )
  async findOne(
    @Param('id', ParseUUIDPipe) id: string, @GetTenantId() tenantId: string ): Promise<BranchEntity> {
    return await this.branchesService.findOne(id, tenantId);
  }

  @Patch(':id')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  async update( @Param('id', ParseUUIDPipe) id: string, @GetTenantId() tenantId: string, @Body() updateBranchDto: UpdateBranchDto,
  ): Promise<BranchEntity> {
    return await this.branchesService.update(id, tenantId, updateBranchDto);
  }

  @Delete(':id')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  async remove( @Param('id', ParseUUIDPipe) id: string, @GetTenantId() tenantId: string ): Promise<{ message: string }> {
    return await this.branchesService.remove(id, tenantId);
  }
}