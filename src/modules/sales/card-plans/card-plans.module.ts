import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CardPlansController } from './card-plans.controller';
import { CardPlansService } from './card-plans.service';
import { CardPlanEntity } from './entities/card-plan.entity';

@Module({
  imports: [TypeOrmModule.forFeature([CardPlanEntity])],
  controllers: [CardPlansController],
  providers: [CardPlansService],
  exports: [CardPlansService],
})
export class CardPlansModule {}
