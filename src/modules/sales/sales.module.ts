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
import { SalesOrderEntity } from './orders/entities/sales-order.entity';
import { SalesOrderItemEntity } from './orders/entities/sales-order-item.entity';
import { SalesOrdersController } from './orders/sales-orders.controller';
import { SalesOrdersService } from './orders/sales-orders.service';
import { SalesQuoteEntity } from './quotes/entities/sales-quote.entity';
import { SalesQuotesController } from './quotes/sales-quotes.controller';
import { SalesQuotesService } from './quotes/sales-quotes.service';

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
      SalesOrderEntity,
      SalesOrderItemEntity,
      SalesQuoteEntity,
    ]),
  ],
  controllers: [SalesController, SalesOrdersController, SalesQuotesController],
  providers: [SalesService, SalesQueryService, SaleReturnsService, SalesOrdersService, SalesQuotesService],
  exports: [SalesService],
})
export class SalesModule {}
