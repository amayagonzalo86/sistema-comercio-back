import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as argon2 from 'argon2';
import { DataSource } from 'typeorm';
import { UserEntity } from '../../modules/users/entities/user.entity';
import { PersonEntity, PersonType } from '../../modules/persons/entities/person.entity';
import { RoleEntity, UserRoleEnum } from '../../modules/roles/entities/role.entity';
import { TenantEntity, TenantStatus } from '../../modules/platform/entities/tenant.entity';
import {
  MembershipStatus,
  TenantMembershipEntity,
  TenantRole,
} from '../../modules/platform/entities/tenant-membership.entity';
import { AuditEventEntity } from '../../modules/platform/entities/audit-event.entity';

const PLATFORM_TENANT_SLUG = 'plataforma';

/** Contraseña robusta: 14+ caracteres con minúscula, mayúscula, número y símbolo. */
export function isStrongPassword(password: string): boolean {
  return (
    password.length >= 14 &&
    password.length <= 128 &&
    /[a-z]/.test(password) &&
    /[A-Z]/.test(password) &&
    /\d/.test(password) &&
    /[^A-Za-z0-9]/.test(password)
  );
}

/**
 * Alta inicial del operador de plataforma (SUPER_ADMIN).
 *
 * SEGURIDAD: ya NO se ejecuta automáticamente al iniciar la API ni usa una contraseña fija.
 * Se ejecuta una sola vez a mano con `npm run seed`, leyendo la contraseña de
 * ADMIN_BOOTSTRAP_PASSWORD (que debe borrarse del entorno después del primer uso).
 */
@Injectable()
export class AdminSeederService {
  private readonly logger = new Logger(AdminSeederService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly configService: ConfigService,
  ) {}

  async seed(): Promise<void> {
    const username = (this.configService.get<string>('ADMIN_BOOTSTRAP_USERNAME') ?? 'admin').trim().toLowerCase();
    const password = this.configService.get<string>('ADMIN_BOOTSTRAP_PASSWORD') ?? '';
    const email = this.configService.get<string>('ADMIN_BOOTSTRAP_EMAIL')?.trim().toLowerCase() || null;

    if (!/^[a-z0-9._-]{3,50}$/.test(username)) {
      throw new Error('ADMIN_BOOTSTRAP_USERNAME debe tener 3-50 caracteres: letras minúsculas, números, punto, guion.');
    }
    if (!isStrongPassword(password)) {
      throw new Error(
        'Definí ADMIN_BOOTSTRAP_PASSWORD con 14+ caracteres, mayúscula, minúscula, número y símbolo.',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      const existing = await manager.findOne(UserEntity, { where: { username } });
      if (existing) {
        this.logger.log(`El usuario "${username}" ya existe: no se realizaron cambios.`);
        return;
      }

      let role = await manager.findOne(RoleEntity, { where: { name: UserRoleEnum.SUPER_ADMIN } });
      if (!role) {
        role = await manager.save(
          RoleEntity,
          manager.create(RoleEntity, { name: UserRoleEnum.SUPER_ADMIN, description: 'Operador de plataforma' }),
        );
      }

      let tenant = await manager.findOne(TenantEntity, { where: { slug: PLATFORM_TENANT_SLUG } });
      if (!tenant) {
        tenant = await manager.save(
          TenantEntity,
          manager.create(TenantEntity, {
            slug: PLATFORM_TENANT_SLUG,
            legalName: 'Operación de plataforma',
            status: TenantStatus.ACTIVE,
          }),
        );
      }

      const person = await manager.save(
        PersonEntity,
        manager.create(PersonEntity, {
          tenantId: tenant.id,
          firstName: 'Administrador',
          lastName: 'Plataforma',
          email,
          personType: PersonType.BOTH,
          isActive: true,
        }),
      );

      const passwordHash = await argon2.hash(password, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16,
        timeCost: 3,
        parallelism: 1,
      });

      const user = await manager.save(
        UserEntity,
        manager.create(UserEntity, {
          username,
          passwordHash,
          roles: [role],
          isActive: true,
          personId: person.id,
        }),
      );

      await manager.save(
        TenantMembershipEntity,
        manager.create(TenantMembershipEntity, {
          tenantId: tenant.id,
          userId: user.id,
          role: TenantRole.OWNER,
          status: MembershipStatus.ACTIVE,
          acceptedAt: new Date(),
        }),
      );

      await manager.save(
        AuditEventEntity,
        manager.create(AuditEventEntity, {
          tenantId: tenant.id,
          actorUserId: null,
          eventType: 'PLATFORM_ADMIN_BOOTSTRAPPED',
          aggregateType: 'USER',
          aggregateId: user.id,
          metadata: { username },
        }),
      );

      this.logger.log(`Operador de plataforma "${username}" creado. Eliminá ADMIN_BOOTSTRAP_PASSWORD del entorno.`);
    });
  }
}
