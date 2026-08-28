import { Body, Controller, Delete, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../common/decorators/roles.decorator';
import { RolesGuard } from '../../common/guards/roles.guard';
import { UserRole } from '../users/entities/user.entity';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';

@Controller('branches')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) { }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(@Body() createBranchDto: CreateBranchDto, @Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.branchesService.create(createBranchDto, tenantId);
  }

  @Get()
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.CASHIER,
    UserRole.STOCK_CLERK,
  )
  findAll(@Req() req: any) {
    const { tenantId, role } = req.user;
    return this.branchesService.findAllByTenant(tenantId, role);
  }

  @Get(':id')
  @Roles(
    UserRole.SUPER_ADMIN,
    UserRole.ADMIN,
    UserRole.MANAGER,
    UserRole.CASHIER,
    UserRole.STOCK_CLERK,
  )
  findOne(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const { tenantId, role } = req.user;
    return this.branchesService.findOneByTenant(id, tenantId, role);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() updateBranchDto: UpdateBranchDto,
    @Req() req: any,
  ) {
    const tenantId = req.user.tenantId;
    return this.branchesService.update(id, updateBranchDto, tenantId);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  remove(@Param('id', ParseUUIDPipe) id: string, @Req() req: any) {
    const tenantId = req.user.tenantId;
    return this.branchesService.remove(id, tenantId);
  }
}