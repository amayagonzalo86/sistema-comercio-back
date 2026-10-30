import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DocumentSequenceEntity } from '../../common/sequences/document-sequence.entity';
import { SaleEntity } from './entities/sale.entity';
import { SaleItemEntity } from './entities/sale-item.entity';
import { SalePaymentEntity } from './entities/sale-payment.entity';
import { SaleReturnEntity } from './returns/entities/sale-return.entity';
import { SaleReturnItemEntity } from './returns/entities/sale-return-item.entity';
import { SaleReturnsService } from './returns/sale-returns.service';
import { SaleAdjustmentEntity } from './adjustments/entities/sale-adjustment.entity';
import { SaleAdjustmentsService } from './adjustments/sale-adjustments.service';
import { ReceivedCheckEntity } from './checks/entities/received-check.entity';
import { ChecksController } from './checks/checks.controller';
import { ChecksService } from './checks/checks.service';
import { CustomerAccountsController, CustomerReceiptsController } from './accounts/customer-accounts.controller';
import { CustomerAccountsService } from './accounts/customer-accounts.service';
import {
  CustomerAccountAllocationEntity,
  CustomerAccountEntryEntity,
  CustomerCreditAuthorizationEntity,
} from './accounts/entities/customer-account-entry.entity';
import { CustomerReceiptEntity, CustomerReceiptPaymentEntity } from './accounts/entities/customer-receipt.entity';
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
      SaleAdjustmentEntity,
      ReceivedCheckEntity,
      CustomerAccountEntryEntity,
      CustomerAccountAllocationEntity,
      CustomerCreditAuthorizationEntity,
      CustomerReceiptEntity,
      CustomerReceiptPaymentEntity,
    ]),
  ],
  controllers: [SalesController, SalesOrdersController, SalesQuotesController, ChecksController, CustomerAccountsController, CustomerReceiptsController],
  providers: [SalesService, SalesQueryService, SaleReturnsService, SalesOrdersService, SalesQuotesService, SaleAdjustmentsService, ChecksService, CustomerAccountsService],
  exports: [SalesService],
})
export class SalesModule {}
