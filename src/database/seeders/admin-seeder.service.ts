import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { UserEntity, UserRole } from '../../modules/users/entities/user.entity';

@Injectable()
export class AdminSeederService {
    private readonly logger = new Logger(AdminSeederService.name);

    constructor(
        @InjectRepository(UserEntity)
        private readonly userRepository: Repository<UserEntity>,
    ) { }

    async seed(): Promise<void> {
        const defaultTenantId = 'e3b0c442-98fc-42c6-951b-256543b3b5c4';
        const adminEmail = 'admin@empresa.com';

        const existingAdmin = await this.userRepository.findOne({
            where: { email: adminEmail, tenantId: defaultTenantId },
        });

        if (existingAdmin) {
            this.logger.log(`El usuario Administrador (${adminEmail}) ya existe.`);
            return;
        }

        const passwordHash = await argon2.hash('AdminPass123!');

        const adminUser = this.userRepository.create({
            tenantId: defaultTenantId,
            email: adminEmail,
            passwordHash,
            fullName: 'Gonzalo Amaya',
            role: UserRole.ADMIN,
            status: true,
        });

        await this.userRepository.save(adminUser);

        this.logger.log('====================================================');
        this.logger.log(' Usuario ADMIN Creado Exitosamente para Pruebas');
        this.logger.log(` Tenant ID: ${defaultTenantId}`);
        this.logger.log(` Email    : ${adminEmail}`);
        this.logger.log(` Password : AdminPass123!`);
        this.logger.log('====================================================');
    }
}