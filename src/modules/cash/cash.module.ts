import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { CashMovementEntity } from './entities/cash-movement.entity';
import { CashRegisterEntity } from './entities/cash-register.entity';
import { CashSessionEntity } from './entities/cash-session.entity';
import { CashController } from './cash.controller';
import { CashService } from './cash.service';

@Module({
  imports: [TypeOrmModule.forFeature([CashRegisterEntity, CashSessionEntity, CashMovementEntity])],
  controllers: [CashController],
  providers: [CashService],
  exports: [TypeOrmModule],
})
export class CashModule {}
