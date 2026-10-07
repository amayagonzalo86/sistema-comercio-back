import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from '../platform/entities/tenant.entity';
import { PromotionEntity } from './entities/promotion.entity';
import { MarketingController } from './marketing.controller';
import { MarketingService } from './marketing.service';

@Module({
  imports: [TypeOrmModule.forFeature([PromotionEntity, TenantEntity])],
  controllers: [MarketingController],
  providers: [MarketingService],
})
export class MarketingModule {}
