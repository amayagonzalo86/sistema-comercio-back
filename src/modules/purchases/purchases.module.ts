import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BranchEntity } from '../branches/entities/branch.entity';
import { AuditEventEntity } from '../platform/entities/audit-event.entity';
import { TenantEntity } from '../platform/entities/tenant.entity';
import { PersonEntity } from '../persons/entities/person.entity';
import { ProductBranchEntity } from '../inventory/product/entities/product-branch.entity';
import { InventoryMovementEntity } from '../inventory/product/entities/inventory-movement.entity';
import { PurchaseReceiptEntity } from './entities/purchase-receipt.entity';
import { PurchaseReceiptItemEntity } from './entities/purchase-receipt-item.entity';
import { SupplierPayableEntity } from './entities/supplier-payable.entity';
import { SupplierPaymentEntity } from './entities/supplier-payment.entity';
import { SupplierPaymentAllocationEntity } from './entities/supplier-payment-allocation.entity';
import { SupplierAccountsController } from './supplier-accounts.controller';
import { SupplierAccountsService } from './supplier-accounts.service';
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';
import { PurchaseOrderEntity } from './entities/purchase-order.entity';
import { PurchaseOrderItemEntity } from './entities/purchase-order-item.entity';
import { PurchaseOrdersService } from './purchase-orders.service';
import { PurchaseOrdersController } from './purchase-orders.controller';
import { DocumentSequenceEntity } from '../../common/sequences/document-sequence.entity';
import { ProductPriceHistoryEntity } from '../inventory/product/entities/product-price-history.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BranchEntity,
      PersonEntity,
      ProductBranchEntity,
      InventoryMovementEntity,
      PurchaseReceiptEntity,
      PurchaseReceiptItemEntity,
      SupplierPayableEntity,
      SupplierPaymentEntity,
      SupplierPaymentAllocationEntity,
      TenantEntity,
      AuditEventEntity,
      PurchaseOrderEntity,
      PurchaseOrderItemEntity,
      DocumentSequenceEntity,
      ProductPriceHistoryEntity,
    ]),
  ],
  controllers: [PurchasesController, SupplierAccountsController, PurchaseOrdersController],
  providers: [PurchasesService, SupplierAccountsService, PurchaseOrdersService],
})
export class PurchasesModule {}
