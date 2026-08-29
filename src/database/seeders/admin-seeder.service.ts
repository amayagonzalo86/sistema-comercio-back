import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { UserEntity, UserRole } from '../../modules/users/entities/user.entity';

@Injectable()
export class AdminSeederService implements OnApplicationBootstrap {
    private readonly logger = new Logger(AdminSeederService.name);

    constructor(
        @InjectRepository(UserEntity)
        private readonly userRepository: Repository<UserEntity>,
        private readonly configService: ConfigService,
    ) { }

    /**
     * Se ejecuta automáticamente tras el arranque completo del módulo de NestJS.
     */
    async onApplicationBootstrap(): Promise<void> {
        await this.seed();
    }

    async seed(): Promise<void> {
        const defaultTenantId = this.configService.get<string>(
            'DEFAULT_TENANT_ID',
            'e3b0c442-98fc-42c6-951b-256543b3b5c4',
        );
        const adminEmail = this.configService.get<string>(
            'ADMIN_DEFAULT_EMAIL',
            'admin@empresa.com',
        );
        const rawPassword = this.configService.get<string>(
            'ADMIN_DEFAULT_PASSWORD',
            'AdminPass123!',
        );

        // ✅ Corregido: Objeto FindOptionsSelect<UserEntity> compatible con TypeORM 0.3.x+
        const existingAdmin = await this.userRepository.findOne({
            where: { email: adminEmail, tenantId: defaultTenantId },
            select: {
                id: true,
                email: true,
                tenantId: true,
                passwordHash: true,
                status: true,
                role: true,
            },
        });

        // Hash Argon2id configurado para entornos de alta seguridad
        const securePasswordHash = await argon2.hash(rawPassword, {
            type: argon2.argon2id,
            memoryCost: 2 ** 16, // 64 MB
            timeCost: 3,
            parallelism: 4,
        });

        if (!existingAdmin) {
            const newAdmin = this.userRepository.create({
                tenantId: defaultTenantId,
                email: adminEmail,
                passwordHash: securePasswordHash,
                fullName: 'Gonzalo Amaya',
                role: UserRole.ADMIN,
                status: true,
            });

            await this.userRepository.save(newAdmin);

            this.logger.log('====================================================');
            this.logger.log('  Usuario ADMIN Creado Exitosamente');
            this.logger.log(`  Tenant ID : ${defaultTenantId}`);
            this.logger.log(`  Email     : ${adminEmail}`);
            this.logger.log('====================================================');
            return;
        }

        // Lógica defensiva de autocuración para hashes nulos, vacíos o sin prefijo argon2
        const isHashInvalid =
            !existingAdmin.passwordHash ||
            existingAdmin.passwordHash.trim() === '' ||
            !existingAdmin.passwordHash.startsWith('$argon2');

        if (isHashInvalid) {
            this.logger.warn(
                `Error de integridad detectado en usuario ID [${existingAdmin.id}]. Hash nulo o inválido. Iniciando reparación...`,
            );

            await this.userRepository.update(existingAdmin.id, {
                passwordHash: securePasswordHash,
                status: true,
            });

            this.logger.log('====================================================');
            this.logger.log(`  Hash de contraseña REPARADO para ID: ${existingAdmin.id}`);
            this.logger.log(`  Email     : ${adminEmail}`);
            this.logger.log('====================================================');
        } else {
            this.logger.log(
                `El usuario Administrador (${adminEmail}) ya existe y posee credenciales válidas.`,
            );
        }
    }
}