import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductBranchEntity } from '../../inventory/product/entities/product-branch.entity';
import { ProductEntity } from '../../inventory/product/entities/product.entity';
import { PriceListEntity } from './entities/price-list.entity';
import { ProductPriceListEntity } from './entities/product-price-list.entity';
import { PriceListService } from './price-list.service';
import { ProductPriceListController } from './product-price-list.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      PriceListEntity,
      ProductPriceListEntity,
      ProductEntity,
      ProductBranchEntity,
    ]),
  ],
  controllers: [ProductPriceListController],
  providers: [PriceListService],
  exports: [PriceListService],
})
export class ProductPriceListModule { }
