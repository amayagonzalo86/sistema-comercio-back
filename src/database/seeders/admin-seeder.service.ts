import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { UserEntity, UserRole } from '../../modules/users/entities/user.entity';

@Injectable()
export class AdminSeederService implements OnApplicationBootstrap {
    private readonly logger = new Logger(AdminSeederService.name);

    // Tenant ID maestro por defecto para inicialización del sistema
    private readonly DEFAULT_TENANT_ID = 'e3b0c442-98fc-42c6-951b-256543b3b5c4';
    private readonly ADMIN_EMAIL = 'admin@empresa.com';

    constructor(
        @InjectRepository(UserEntity)
        private readonly userRepository: Repository<UserEntity>,
    ) { }

    async onApplicationBootstrap(): Promise<void> {
        await this.seed();
    }

    async seed(): Promise<void> {
        try {
            const adminCount = await this.userRepository.count({
                where: { tenantId: this.DEFAULT_TENANT_ID },
            });

            if (adminCount > 0) {
                this.logger.log('El usuario Administrador ya existe en la base de datos.');
                return;
            }

            this.logger.log('Tabla de usuarios vacía. Creando usuario Administrador inicial...');

            const passwordHash = await argon2.hash('AdminPass123!', {
                type: argon2.argon2id,
                memoryCost: 2 ** 16,
                timeCost: 3,
                parallelism: 1,
            });

            // Se asignan explícitamente firstName y lastName para evitar la falla por NULL en MySQL
            const adminUser = this.userRepository.create({
                id: '3b33cd9a-55ca-40d8-96ea-4d466f2106ab',
                tenantId: this.DEFAULT_TENANT_ID,
                email: this.ADMIN_EMAIL,
                passwordHash,
                firstName: 'Administrador',
                lastName: 'Sistema',
                role: UserRole.SUPER_ADMIN,
                status: true,
            });

            await this.userRepository.save(adminUser);
            this.logger.log(`Usuario Administrador inicial creado con éxito (${this.ADMIN_EMAIL})`);
        } catch (error) {
            this.logger.error('Error crítico al ejecutar el seeding del usuario Administrador', error);
            throw error;
        }
    }
}