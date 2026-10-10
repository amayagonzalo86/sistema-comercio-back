import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from './entities/product.entity';
import { ProductBranchEntity } from './entities/product-branch.entity';
import { BranchEntity } from '../../branches/entities/branch.entity';
import { InventoryMovementEntity } from './entities/inventory-movement.entity';
import { ProductPriceHistoryEntity } from './entities/product-price-history.entity';
import { CatalogService } from './catalog.service';
import { ProductsService } from '../product/product.service';
import { ProductsController } from '../product/product.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductEntity, ProductBranchEntity, BranchEntity, InventoryMovementEntity, ProductPriceHistoryEntity]),
  ],
  controllers: [ProductsController],
  providers: [ProductsService, CatalogService],
  exports: [ProductsService, CatalogService],
})
export class ProductModule {}