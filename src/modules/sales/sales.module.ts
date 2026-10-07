import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSequenceEntity } from '../../common/sequences/document-sequence.entity';
import { SaleEntity } from './entities/sale.entity';
import { SaleItemEntity } from './entities/sale-item.entity';
import { SalePaymentEntity } from './entities/sale-payment.entity';
import { SaleReturnEntity } from './returns/entities/sale-return.entity';
import { SaleReturnItemEntity } from './returns/entities/sale-return-item.entity';
import { SaleReturnsService } from './returns/sale-returns.service';
import { PromotionEntity } from '../marketing/entities/promotion.entity';
import { SalesController } from './sales.controller';
import { SalesQueryService } from './sales-query.service';
import { SalesService } from './sales.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      SaleEntity,
      SaleItemEntity,
      SalePaymentEntity,
      SaleReturnEntity,
      SaleReturnItemEntity,
      DocumentSequenceEntity,
      PromotionEntity,
    ]),
  ],
  controllers: [SalesController],
  providers: [SalesService, SalesQueryService, SaleReturnsService],
  exports: [SalesService],
})
export class SalesModule {}
