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
import { CreatePriceListDto } from './dto/price-list.dto';
import { PriceListService } from './price-list.service';
import { Roles } from '../../../common/decorators/roles.decorator';
import { RolesGuard } from '../../../common/guards/roles.guard';
import { JwtAuthGuard } from '../../../common/guards/jwt-auth.guard';
import { GetTenantId } from '../../../common/decorators/get-tenant.decorator';
import { UserRole } from '../../users/entities/user.entity';

@Controller('price-lists')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductPriceListController {
  constructor(private readonly priceListService: PriceListService) {}

  @Post()
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() createPriceListDto: CreatePriceListDto,
    @GetTenantId() tenantId: string,
  ) {
    return this.priceListService.create(createPriceListDto, tenantId);
  }

  @Get(':priceListId/products/:productId/branches/:branchId/calculated-price')
  @Roles(UserRole.ADMIN, UserRole.SUPER_ADMIN, UserRole.MANAGER, UserRole.SELLER)
  getCalculatedPrice(
    @Param('priceListId', ParseUUIDPipe) priceListId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
    @GetTenantId() tenantId: string,
  ) {
    return this.priceListService.getCalculatedProductPrice(
      productId,
      branchId,
      priceListId,
      tenantId,
    );
  }
}