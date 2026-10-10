import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BranchEntity } from '../branches/entities/branch.entity';
import { PersonEntity } from '../persons/entities/person.entity';
import { FiscalProfileEntity } from '../platform/entities/fiscal-profile.entity';
import { TenantEntity } from '../platform/entities/tenant.entity';
import { SaleItemEntity } from '../sales/entities/sale-item.entity';
import { SaleEntity } from '../sales/entities/sale.entity';
import { SaleReturnItemEntity } from '../sales/returns/entities/sale-return-item.entity';
import { SaleReturnEntity } from '../sales/returns/entities/sale-return.entity';
import { ARCA_CLIENT, HttpArcaClient } from './arca/arca-client';
import { ArcaTicketEntity } from './entities/arca-ticket.entity';
import { FiscalDocumentEntity } from './entities/fiscal-document.entity';
import { FiscalPointOfSaleEntity } from './entities/fiscal-point-of-sale.entity';
import { FiscalController } from './fiscal.controller';
import { FiscalService } from './fiscal.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      FiscalProfileEntity,
      FiscalPointOfSaleEntity,
      FiscalDocumentEntity,
      ArcaTicketEntity,
      TenantEntity,
      BranchEntity,
      PersonEntity,
      SaleEntity,
      SaleItemEntity,
      SaleReturnEntity,
      SaleReturnItemEntity,
    ]),
  ],
  controllers: [FiscalController],
  providers: [FiscalService, { provide: ARCA_CLIENT, useClass: HttpArcaClient }],
  exports: [FiscalService],
})
export class FiscalModule {}
