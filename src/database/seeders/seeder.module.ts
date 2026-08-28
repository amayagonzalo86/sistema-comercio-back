import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../../modules/users/entities/user.entity';
import { AdminSeederService } from './admin-seeder.service';

@Module({
    imports: [TypeOrmModule.forFeature([UserEntity])],
    providers: [AdminSeederService],
    exports: [AdminSeederService],
})
export class SeederModule { }