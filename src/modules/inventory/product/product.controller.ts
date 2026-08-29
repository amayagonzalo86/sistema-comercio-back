import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { GetUser } from '../../auth/decorators/get-user.decorator';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductEntity } from './entities/product.entity';
import { ProductBranchEntity } from './entities/product-branch.entity';
import { ProductsService } from '../../../modules/inventory/product/product.service';
import { UserRole } from '../../users/entities/user.entity';

@Controller('products')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER)
  @HttpCode(HttpStatus.CREATED)
  async create(
    @Body() createProductDto: CreateProductDto,
    @GetUser('tenantId') tenantId: string,
  ): Promise<ProductEntity> {
    return await this.productsService.create(createProductDto, tenantId);
  }

  @Get(':id')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  async findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @GetUser('tenantId') tenantId: string,
  ): Promise<ProductEntity> {
    return await this.productsService.findOne(id, tenantId);
  }

  @Get('branch/:branchId')
  @Roles(UserRole.SUPER_ADMIN, UserRole.ADMIN, UserRole.MANAGER, UserRole.CASHIER)
  async findByBranch(
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @GetUser('tenantId') tenantId: string,
  ): Promise<ProductBranchEntity[]> {
    return await this.productsService.findByBranch(tenantId, branchId);
  }
}