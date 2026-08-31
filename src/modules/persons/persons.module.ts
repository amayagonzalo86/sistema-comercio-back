import { Module } from '@nestjs/common';
import { PersonsService } from './persons.service';
import { PersonsController } from './persons.controller';
import { TypeOrmModule } from '@nestjs/typeorm';
import { PersonEntity } from './entities/person.entity';

@Module({
  imports: [TypeOrmModule.forFeature([PersonEntity])],
  controllers: [PersonsController],
  providers: [PersonsService],
})
export class PersonsModule {}
