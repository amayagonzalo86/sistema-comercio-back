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
import { UserRoleEnum } from '../../roles/entities/role.entity';

@Controller('price-lists')
@UseGuards(JwtAuthGuard, RolesGuard)
export class ProductPriceListController {
  constructor(private readonly priceListService: PriceListService) {}

  @Post()
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.SUPER_ADMIN)
  @HttpCode(HttpStatus.CREATED)
  create(
    @Body() createPriceListDto: CreatePriceListDto
  ) {
    return this.priceListService.create(createPriceListDto);
  }

  @Get(':priceListId/products/:productId/branches/:branchId/calculated-price')
  @Roles(UserRoleEnum.ADMIN, UserRoleEnum.SUPER_ADMIN, UserRoleEnum.MANAGER, UserRoleEnum.SELLER)
  getCalculatedPrice(
    @Param('priceListId', ParseUUIDPipe) priceListId: string,
    @Param('productId', ParseUUIDPipe) productId: string,
    @Param('branchId', ParseUUIDPipe) branchId: string,
  ) {
    return this.priceListService.getCalculatedProductPrice(
      productId,
      branchId,
      priceListId
    );
  }
}