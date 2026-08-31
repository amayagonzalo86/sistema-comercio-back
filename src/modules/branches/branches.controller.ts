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
import { UserRole } from '../users/entities/user.entity';
import { BranchesService } from './branches.service';
import { CreateBranchDto } from './dto/create-branch.dto';
import { UpdateBranchDto } from './dto/update-branch.dto';
import { BranchEntity } from './entities/branch.entity';

@Controller('branches')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class BranchesController {
  constructor(private readonly branchesService: BranchesService) { }

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createBranchDto: CreateBranchDto): Promise<BranchEntity> {
    return await this.branchesService.create(createBranchDto);
  }

  @Get()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER, UserRole.STOCK_CLERK )
  async findAll(): Promise<BranchEntity[]> {
    return await this.branchesService.findAll();
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER, UserRole.STOCK_CLERK )
  async findOne(
    @Param('id', ParseUUIDPipe) id: string ): Promise<BranchEntity> {
    return await this.branchesService.findOne(id);
  }

  @Patch(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async update( @Param('id', ParseUUIDPipe) id: string, @Body() updateBranchDto: UpdateBranchDto,
  ): Promise<BranchEntity> {
    return await this.branchesService.update(id, updateBranchDto);
  }

  @Delete(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN)
  async remove( @Param('id', ParseUUIDPipe) id: string ): Promise<{ message: string }> {
    return await this.branchesService.remove(id);
  }
}