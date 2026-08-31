import { Body, Controller, Get, HttpCode, HttpStatus, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { CreateProductDto } from './dto/create-product.dto';
import { ProductEntity } from './entities/product.entity';
import { ProductBranchEntity } from './entities/product-branch.entity';
import { ProductsService } from '../../../modules/inventory/product/product.service';
import { UserRoleEnum } from '../../roles/entities/role.entity';

@Controller('products')
@UseGuards(AuthGuard('jwt'), RolesGuard)
export class ProductsController {
  constructor(private readonly productsService: ProductsService) {}

  @Post()
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.STOCK_CLERK )
  @HttpCode(HttpStatus.CREATED)
  async create(@Body() createProductDto: CreateProductDto): Promise<ProductEntity> {
    return await this.productsService.create(createProductDto);
  }

  @Get(':id')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.STOCK_CLERK)
  async findOne( @Param('id', ParseUUIDPipe) id: string ): Promise<ProductEntity> {
    return await this.productsService.findOne(id);
  }

  @Get('branch/:branchId')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.CASHIER, UserRoleEnum.STOCK_CLERK)
  async findByBranch(
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ): Promise<ProductBranchEntity[]> { return await this.productsService.findByBranch( branchId) }
}