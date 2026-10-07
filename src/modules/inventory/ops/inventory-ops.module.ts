import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSequenceEntity } from '../../../common/sequences/document-sequence.entity';
import { BranchEntity } from '../../branches/entities/branch.entity';
import { InventoryMovementEntity } from '../product/entities/inventory-movement.entity';
import { ProductBranchEntity } from '../product/entities/product-branch.entity';
import { ProductEntity } from '../product/entities/product.entity';
import { StockTransferItemEntity } from './entities/stock-transfer-item.entity';
import { StockTransferEntity } from './entities/stock-transfer.entity';
import { InventoryInsightsController, StockTransfersController } from './inventory-ops.controller';
import { StockInsightsService } from './stock-insights.service';
import { StockTransfersService } from './stock-transfers.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      StockTransferEntity,
      StockTransferItemEntity,
      DocumentSequenceEntity,
      ProductEntity,
      ProductBranchEntity,
      InventoryMovementEntity,
      BranchEntity,
    ]),
  ],
  controllers: [StockTransfersController, InventoryInsightsController],
  providers: [StockTransfersService, StockInsightsService],
  exports: [StockInsightsService],
})
export class InventoryOpsModule {}
