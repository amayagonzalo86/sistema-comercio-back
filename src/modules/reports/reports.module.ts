import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TenantEntity } from '../platform/entities/tenant.entity';
import { ReportsController } from './reports.controller';
import { ReportsService } from './reports.service';

@Module({
  imports: [TypeOrmModule.forFeature([TenantEntity])],
  controllers: [ReportsController],
  providers: [ReportsService],
})
export class ReportsModule {}
