import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { ProductEntity } from './entities/product.entity';
import { ProductBranchEntity } from './entities/product-branch.entity';
import { BranchEntity } from '../../branches/entities/branch.entity';
import { InventoryMovementEntity } from './entities/inventory-movement.entity';
import { ProductsService } from '../product/product.service';
import { ProductsController } from '../product/product.controller';

@Module({
  imports: [
    TypeOrmModule.forFeature([ProductEntity, ProductBranchEntity, BranchEntity, InventoryMovementEntity]),
  ],
  controllers: [ProductsController],
  providers: [ProductsService],
  exports: [ProductsService],
})
export class ProductModule {}