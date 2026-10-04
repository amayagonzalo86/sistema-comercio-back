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
import { PurchasesController } from './purchases.controller';
import { PurchasesService } from './purchases.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BranchEntity,
      PersonEntity,
      ProductBranchEntity,
      InventoryMovementEntity,
      PurchaseReceiptEntity,
      PurchaseReceiptItemEntity,
      TenantEntity,
      AuditEventEntity,
    ]),
  ],
  controllers: [PurchasesController],
  providers: [PurchasesService],
})
export class PurchasesModule {}
