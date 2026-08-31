import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserEntity } from '../../modules/users/entities/user.entity';
import { AdminSeederService } from './admin-seeder.service';
import { PersonEntity } from '../../modules/persons/entities/person.entity';

@Module({
    imports: [TypeOrmModule.forFeature([UserEntity, PersonEntity]),
        ConfigModule
    ],
    providers: [AdminSeederService],
    exports: [AdminSeederService],
})
export class SeederModule { }