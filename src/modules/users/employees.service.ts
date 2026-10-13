import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import * as argon2 from 'argon2';
import { DataSource, EntityManager, In } from 'typeorm';
import { recordAudit } from '../../common/audit/audit';
import { likePattern, Paginated, paginated } from '../../common/dto/page-query.dto';
import { IdentificationTypeEnum, TaxConditionEnum } from '../../common/enums/afip.enum';
import { RequestAuditContext } from '../../common/http/request-context';
import {
  actorTenantRoles,
  BRANCH_SCOPED_TENANT_ROLES,
  membershipRoles,
  normalizeTenantRoles,
  splitTenantRoles,
  TENANT_ROLE_GUARD_MAP,
} from '../../common/security/tenant-roles';
import { SessionEntity } from '../auth/entities/session.entity';
import { BranchEntity } from '../branches/entities/branch.entity';
import { PersonEntity, PersonType } from '../persons/entities/person.entity';
import { normalizeFiscalIdentity } from '../persons/persons.service';
import { MembershipStatus, TenantMembershipEntity, TenantRole } from '../platform/entities/tenant-membership.entity';
import { RoleEntity } from '../roles/entities/role.entity';
import { CreateEmployeeDto, EmployeeQueryDto, ResetEmployeePasswordDto, UpdateEmployeeDto } from './dto/employee.dto';
import { UserEntity } from './entities/user.entity';

export interface EmployeeActor {
  id: string;
  tenantRole?: string;
  tenantRoles?: string[];
}

export interface EmployeeView {
  /** Id del usuario (es el que usan las rutas /employees/:id). */
  id: string;
  membershipId: string;
  personId: string;
  username: string;
  firstName: string;
  lastName: string;
  fullName: string;
  documentType: number | null;
  nationalId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  roles: TenantRole[];
  primaryRole: TenantRole;
  branchId: string | null;
  branchName: string | null;
  status: MembershipStatus;
  /** El usuario también trabaja en otra empresa: su usuario y contraseña los administra él mismo. */
  sharedAccount: boolean;
  lastLoginAt: string | null;
  createdAt: string;
}

type EmployeeRow = {
  membershipId: string;
  userId: string;
  role: TenantRole;
  additionalRoles: unknown;
  branchId: string | null;
  branchName: string | null;
  status: MembershipStatus;
  createdAt: Date | string;
  username: string;
  personId: string;
  firstName: string;
  lastName: string;
  documentType: number | string | null;
  nationalId: string | null;
  email: string | null;
  phone: string | null;
  address: string | null;
  lastLoginAt: Date | string | null;
  otherTenants: number | string;
};

const ADMIN_ROLES: ReadonlySet<string> = new Set([TenantRole.OWNER, TenantRole.ADMIN]);

/**
 * Administración de empleados de una empresa: alta (persona + usuario + roles), edición, roles múltiples,
 * sucursal, cambio de contraseña y activación. Reglas de seguridad:
 * - El rol titular (OWNER) no se asigna ni se quita desde acá.
 * - Solo el titular puede otorgar o quitar el rol de administración, o tocar la cuenta de un administrador.
 * - Nadie puede cambiar sus propios roles, sucursal o estado (evita bloquearse o autoascenderse).
 * - Si la cuenta también pertenece a otra empresa, su usuario y contraseña no se cambian desde esta.
 * - Cambiar contraseña, roles, sucursal o desactivar cierra las sesiones abiertas del empleado.
 */
@Injectable()
export class EmployeesService {
  private readonly logger = new Logger(EmployeesService.name);

  constructor(private readonly dataSource: DataSource) {}

  async list(tenantId: string, query: EmployeeQueryDto): Promise<Paginated<EmployeeView>> {
    const where: string[] = ['m.tenant_id = ?', 'u.deleted_at IS NULL'];
    const params: unknown[] = [tenantId];
    const status = query.status ?? MembershipStatus.ACTIVE;
    if (status !== 'ALL') {
      where.push('m.status = ?');
      params.push(status);
    }
    if (query.branchId) {
      where.push('m.branch_id = ?');
      params.push(query.branchId);
    }
    if (query.role) {
      where.push('(m.role = ? OR JSON_CONTAINS(m.additional_roles, JSON_QUOTE(?)))');
      params.push(query.role, query.role);
    }
    if (query.search) {
      const pattern = likePattern(query.search);
      where.push(
        "(u.username LIKE ? OR p.first_name LIKE ? OR p.last_name LIKE ? OR CONCAT(p.first_name, ' ', p.last_name) LIKE ? OR p.national_id LIKE ? OR p.email LIKE ?)",
      );
      params.push(pattern, pattern, pattern, pattern, pattern, pattern);
    }
    const whereSql = where.join(' AND ');
    const [rows, countRows] = await Promise.all([
      this.dataSource.query(
        `${this.selectSql()} WHERE ${whereSql} ORDER BY p.last_name ASC, p.first_name ASC, u.username ASC LIMIT ? OFFSET ?`,
        [...params, query.limit, (query.page - 1) * query.limit],
      ) as Promise<EmployeeRow[]>,
      this.dataSource.query(
        `SELECT COUNT(*) AS total FROM tenant_memberships m JOIN users u ON u.id = m.user_id JOIN persons p ON p.id = u.person_id WHERE ${whereSql}`,
        params,
      ) as Promise<Array<{ total: number | string }>>,
    ]);
    return paginated(rows.map((row) => this.toView(row)), Number(countRows[0]?.total ?? 0), query.page, query.limit);
  }

  async findOne(tenantId: string, userId: string): Promise<EmployeeView> {
    const rows = (await this.dataSource.query(`${this.selectSql()} WHERE m.tenant_id = ? AND m.user_id = ? AND u.deleted_at IS NULL LIMIT 1`, [
      tenantId,
      userId,
    ])) as EmployeeRow[];
    if (!rows[0]) throw new NotFoundException('Empleado no encontrado en esta empresa.');
    return this.toView(rows[0]);
  }

  async create(tenantId: string, actor: EmployeeActor, dto: CreateEmployeeDto, context: RequestAuditContext): Promise<EmployeeView> {
    const roles = normalizeTenantRoles(dto.roles);
    this.assertAssignable(actor, roles, []);
    const fiscal = this.normalizeDocument(dto.documentType, dto.nationalId);
    const passwordHash = await argon2.hash(dto.password);

    try {
      const userId = await this.dataSource.transaction(async (manager) => {
        const branchId = await this.resolveBranch(manager, tenantId, dto.branchId ?? null, roles);
        await this.assertUsernameFree(manager, dto.username);

        // Si ya existe una persona con ese documento en la empresa (por ejemplo, un cliente), se reutiliza.
        let person: PersonEntity | null = null;
        if (fiscal.nationalId) {
          person = await manager.findOne(PersonEntity, { where: { tenantId, nationalId: fiscal.nationalId } });
          if (person) {
            const linked = await manager.findOne(UserEntity, { where: { personId: person.id }, withDeleted: true, select: { id: true, username: true } });
            if (linked) throw new ConflictException(`Esa persona ya tiene el usuario "${linked.username}".`);
          }
        }
        const reusedPerson = person !== null;
        person = await manager.save(
          PersonEntity,
          manager.create(PersonEntity, {
            ...(person ?? {}),
            tenantId,
            firstName: dto.firstName,
            lastName: dto.lastName,
            documentType: fiscal.documentType,
            nationalId: fiscal.nationalId,
            vatCondition: person?.vatCondition ?? TaxConditionEnum.CONSUMIDOR_FINAL,
            email: dto.email ?? person?.email ?? null,
            phone: dto.phone ?? person?.phone ?? null,
            address: dto.address ?? person?.address ?? null,
            personType: person?.personType ?? PersonType.CUSTOMER,
            isActive: true,
          }),
        );

        const user = await manager.save(
          UserEntity,
          manager.create(UserEntity, {
            username: dto.username,
            passwordHash,
            person,
            personId: person.id,
            isActive: true,
            branchId: null,
            roles: await this.legacyRoles(manager, roles),
          }),
        );
        const split = splitTenantRoles(roles);
        await manager.save(
          TenantMembershipEntity,
          manager.create(TenantMembershipEntity, {
            tenantId,
            userId: user.id,
            branchId,
            role: split.role,
            additionalRoles: split.additionalRoles,
            status: MembershipStatus.ACTIVE,
            acceptedAt: new Date(),
          }),
        );
        await recordAudit(manager, {
          tenantId,
          actorUserId: actor.id,
          eventType: 'EMPLOYEE_CREATED',
          aggregateType: 'USER',
          aggregateId: user.id,
          metadata: { username: dto.username, roles, branchId, personId: person.id, reusedPerson },
          context,
        });
        return user.id;
      });
      return this.findOne(tenantId, userId);
    } catch (error) {
      throw this.translate(error, 'No se pudo crear el empleado.');
    }
  }

  async update(tenantId: string, actor: EmployeeActor, userId: string, dto: UpdateEmployeeDto, context: RequestAuditContext): Promise<EmployeeView> {
    const self = actor.id === userId;
    try {
      await this.dataSource.transaction(async (manager) => {
        const { membership, user, person } = await this.lockEmployee(manager, tenantId, userId);
        const currentRoles = membershipRoles(membership);
        if (!self) this.assertCanManage(actor, currentRoles);
        const changed: string[] = [];
        let revokeSessions = false;

        // Roles y sucursal
        const touchesAccess = dto.roles !== undefined || dto.branchId !== undefined;
        if (touchesAccess && self) {
          throw new ForbiddenException('No podés cambiar tus propios roles ni tu sucursal. Pedíselo a otro administrador o al titular.');
        }
        let nextRoles = currentRoles;
        if (dto.roles !== undefined) {
          const requested = normalizeTenantRoles(dto.roles);
          // El titular conserva siempre su rol: no se quita ni se otorga desde esta pantalla.
          if (currentRoles.includes(TenantRole.OWNER) && !requested.includes(TenantRole.OWNER)) requested.unshift(TenantRole.OWNER);
          this.assertAssignable(actor, requested, currentRoles);
          nextRoles = normalizeTenantRoles(requested);
          if (nextRoles.join() !== currentRoles.join()) {
            const split = splitTenantRoles(nextRoles);
            membership.role = split.role;
            membership.additionalRoles = split.additionalRoles;
            changed.push('roles');
            revokeSessions = true;
          }
        }
        const requestedBranch = dto.branchId !== undefined ? dto.branchId : membership.branchId ?? null;
        const nextBranch = await this.resolveBranch(manager, tenantId, requestedBranch, nextRoles);
        if ((membership.branchId ?? null) !== nextBranch) {
          membership.branchId = nextBranch;
          changed.push('branch');
          revokeSessions = true;
        }
        if (changed.length) await manager.save(TenantMembershipEntity, membership);

        // Usuario (es global: si la cuenta se comparte con otra empresa, no se toca desde acá)
        if (dto.username !== undefined && dto.username !== user.username) {
          await this.assertNotShared(manager, tenantId, userId, 'el nombre de usuario');
          await this.assertUsernameFree(manager, dto.username);
          await manager.update(UserEntity, { id: userId }, { username: dto.username });
          changed.push('username');
        }

        // Datos personales
        const personPatch: Partial<PersonEntity> = {};
        if (dto.firstName !== undefined && dto.firstName !== person.firstName) personPatch.firstName = dto.firstName;
        if (dto.lastName !== undefined && dto.lastName !== person.lastName) personPatch.lastName = dto.lastName;
        if (dto.email !== undefined && dto.email !== (person.email ?? null)) personPatch.email = dto.email;
        if (dto.phone !== undefined && dto.phone !== (person.phone ?? null)) personPatch.phone = dto.phone;
        if (dto.address !== undefined && dto.address !== (person.address ?? null)) personPatch.address = dto.address;
        if (dto.documentType !== undefined || dto.nationalId !== undefined) {
          const fiscal = this.normalizeDocument(
            dto.documentType !== undefined ? dto.documentType : (person.documentType ?? null),
            dto.nationalId !== undefined ? dto.nationalId : (person.nationalId ?? null),
            person.vatCondition,
          );
          if (fiscal.documentType !== (person.documentType ?? null)) personPatch.documentType = fiscal.documentType;
          if (fiscal.nationalId !== (person.nationalId ?? null)) personPatch.nationalId = fiscal.nationalId;
        }
        if (Object.keys(personPatch).length) {
          await manager.update(PersonEntity, { id: person.id }, personPatch);
          changed.push(...Object.keys(personPatch));
        }

        if (revokeSessions) await this.revokeSessions(manager, userId);
        if (changed.length) {
          await recordAudit(manager, {
            tenantId,
            actorUserId: actor.id,
            eventType: 'EMPLOYEE_UPDATED',
            aggregateType: 'USER',
            aggregateId: userId,
            metadata: {
              changed,
              ...(changed.includes('roles') ? { rolesBefore: currentRoles, rolesAfter: nextRoles } : {}),
              ...(changed.includes('branch') ? { branchId: nextBranch } : {}),
              sessionsClosed: revokeSessions,
            },
            context,
          });
        }
      });
      return this.findOne(tenantId, userId);
    } catch (error) {
      throw this.translate(error, 'No se pudo actualizar el empleado.');
    }
  }

  /** La administración define una contraseña nueva. Cierra todas las sesiones abiertas del empleado. */
  async resetPassword(tenantId: string, actor: EmployeeActor, userId: string, dto: ResetEmployeePasswordDto, context: RequestAuditContext): Promise<{ message: string }> {
    if (actor.id === userId) {
      throw new BadRequestException('Para cambiar tu propia contraseña usá "Cambiar mi contraseña" (te pide la actual).');
    }
    const passwordHash = await argon2.hash(dto.newPassword);
    try {
      await this.dataSource.transaction(async (manager) => {
        const { membership, user } = await this.lockEmployee(manager, tenantId, userId);
        this.assertCanManage(actor, membershipRoles(membership));
        await this.assertNotShared(manager, tenantId, userId, 'la contraseña');
        await manager.update(UserEntity, { id: userId }, { passwordHash, currentHashedRefreshToken: null });
        await this.revokeSessions(manager, userId);
        await recordAudit(manager, {
          tenantId,
          actorUserId: actor.id,
          eventType: 'EMPLOYEE_PASSWORD_RESET',
          aggregateType: 'USER',
          aggregateId: userId,
          metadata: { username: user.username, sessionsClosed: true },
          context,
        });
      });
      return { message: 'Contraseña actualizada. El empleado debe ingresar de nuevo con la contraseña nueva.' };
    } catch (error) {
      throw this.translate(error, 'No se pudo cambiar la contraseña.');
    }
  }

  async setActive(tenantId: string, actor: EmployeeActor, userId: string, active: boolean, context: RequestAuditContext): Promise<EmployeeView> {
    if (actor.id === userId) throw new BadRequestException('No podés desactivar ni reactivar tu propio usuario.');
    try {
      await this.dataSource.transaction(async (manager) => {
        const { membership, user } = await this.lockEmployee(manager, tenantId, userId);
        const roles = membershipRoles(membership);
        this.assertCanManage(actor, roles);
        if (!active && roles.includes(TenantRole.OWNER)) throw new ForbiddenException('El titular de la empresa no se puede desactivar.');
        const next = active ? MembershipStatus.ACTIVE : MembershipStatus.SUSPENDED;
        if (membership.status === next) return;
        membership.status = next;
        if (active) membership.acceptedAt = new Date();
        await manager.save(TenantMembershipEntity, membership);
        if (!active) await this.revokeSessions(manager, userId);
        await recordAudit(manager, {
          tenantId,
          actorUserId: actor.id,
          eventType: active ? 'EMPLOYEE_ACTIVATED' : 'EMPLOYEE_DEACTIVATED',
          aggregateType: 'USER',
          aggregateId: userId,
          metadata: { username: user.username },
          context,
        });
      });
      return this.findOne(tenantId, userId);
    } catch (error) {
      throw this.translate(error, 'No se pudo cambiar el estado del empleado.');
    }
  }

  // ── Reglas ────────────────────────────────────────────────────

  /** Qué roles puede otorgar o quitar quien opera. `current` son los roles actuales del empleado. */
  private assertAssignable(actor: EmployeeActor, requested: TenantRole[], current: TenantRole[]): void {
    if (requested.length === 0) throw new BadRequestException('Asigná al menos un rol.');
    if (requested.includes(TenantRole.OWNER) && !current.includes(TenantRole.OWNER)) {
      throw new ForbiddenException('El rol de titular no se asigna desde la administración de empleados.');
    }
    const actorIsOwner = actorTenantRoles(actor).includes(TenantRole.OWNER);
    const adminChanges = requested.includes(TenantRole.ADMIN) !== current.includes(TenantRole.ADMIN);
    if (adminChanges && !actorIsOwner) {
      throw new ForbiddenException('Solo el titular de la empresa puede otorgar o quitar el rol de administración.');
    }
  }

  /** Un administrador gestiona empleados; las cuentas de administradores y del titular solo las toca el titular. */
  private assertCanManage(actor: EmployeeActor, targetRoles: TenantRole[]): void {
    const actorRoles = actorTenantRoles(actor);
    if (!actorRoles.some((role) => ADMIN_ROLES.has(role))) {
      throw new ForbiddenException('Solo la administración puede gestionar empleados.');
    }
    const actorIsOwner = actorRoles.includes(TenantRole.OWNER);
    if (!actorIsOwner && targetRoles.some((role) => ADMIN_ROLES.has(role))) {
      throw new ForbiddenException('Solo el titular puede modificar la cuenta de un administrador o del titular.');
    }
  }

  private async resolveBranch(manager: EntityManager, tenantId: string, branchId: string | null, roles: TenantRole[]): Promise<string | null> {
    if (branchId) {
      const branch = await manager.findOne(BranchEntity, { where: { id: branchId, tenantId, status: true }, select: { id: true } });
      if (!branch) throw new NotFoundException('La sucursal no existe o no está activa.');
      return branch.id;
    }
    if (roles.length > 0 && roles.every((role) => BRANCH_SCOPED_TENANT_ROLES.has(role))) {
      throw new BadRequestException('Cajeros, vendedores y depósito trabajan en una sucursal: asigná una.');
    }
    return null;
  }

  private async assertUsernameFree(manager: EntityManager, username: string): Promise<void> {
    const existing = await manager.findOne(UserEntity, { where: { username }, withDeleted: true, select: { id: true } });
    if (existing) throw new ConflictException(`El usuario "${username}" ya existe. Elegí otro.`);
  }

  private async assertNotShared(manager: EntityManager, tenantId: string, userId: string, what: string): Promise<void> {
    const rows = (await manager.query(
      "SELECT COUNT(*) AS total FROM tenant_memberships WHERE user_id = ? AND tenant_id <> ? AND status <> 'SUSPENDED'",
      [userId, tenantId],
    )) as Array<{ total: number | string }>;
    if (Number(rows[0]?.total ?? 0) > 0) {
      throw new ForbiddenException(`Esta cuenta también se usa en otra empresa: ${what} solo lo puede cambiar el propio usuario.`);
    }
  }

  private normalizeDocument(documentType: IdentificationTypeEnum | null | undefined, nationalId: string | null | undefined, vatCondition = TaxConditionEnum.CONSUMIDOR_FINAL) {
    if (!nationalId) return { documentType: null, nationalId: null };
    const fiscal = normalizeFiscalIdentity(documentType ?? null, nationalId, vatCondition);
    return { documentType: fiscal.documentType, nationalId: fiscal.nationalId };
  }

  private async lockEmployee(manager: EntityManager, tenantId: string, userId: string) {
    const membership = await manager
      .createQueryBuilder(TenantMembershipEntity, 'm')
      .setLock('pessimistic_write')
      .where('m.tenantId = :tenantId', { tenantId })
      .andWhere('m.userId = :userId', { userId })
      .getOne();
    if (!membership) throw new NotFoundException('Empleado no encontrado en esta empresa.');
    const user = await manager.findOne(UserEntity, { where: { id: userId }, select: { id: true, username: true, personId: true } });
    if (!user) throw new NotFoundException('Empleado no encontrado en esta empresa.');
    const person = await manager.findOne(PersonEntity, { where: { id: user.personId } });
    if (!person) throw new NotFoundException('Los datos personales del empleado no existen.');
    return { membership, user, person };
  }

  /** Invalida las sesiones (refresh tokens): el empleado vuelve a ingresar cuando vence su acceso actual. */
  private async revokeSessions(manager: EntityManager, userId: string): Promise<void> {
    await manager.update(SessionEntity, { userId, isValid: true }, { isValid: false });
  }

  /** Roles globales heredados (users_roles): se mantienen coherentes con los roles de la empresa. */
  private async legacyRoles(manager: EntityManager, roles: TenantRole[]): Promise<RoleEntity[]> {
    const names = [...new Set(roles.map((role) => TENANT_ROLE_GUARD_MAP[role][0]))];
    return names.length ? manager.find(RoleEntity, { where: { name: In(names) } }) : [];
  }

  private selectSql(): string {
    return `SELECT m.id AS membershipId, m.user_id AS userId, m.role AS role, m.additional_roles AS additionalRoles,
                   m.branch_id AS branchId, b.name AS branchName, m.status AS status, m.created_at AS createdAt,
                   u.username AS username, p.id AS personId, p.first_name AS firstName, p.last_name AS lastName,
                   p.document_type AS documentType, p.national_id AS nationalId, p.email AS email, p.phone AS phone, p.address AS address,
                   (SELECT MAX(s.created_at) FROM user_sessions s WHERE s.user_id = u.id) AS lastLoginAt,
                   (SELECT COUNT(*) FROM tenant_memberships o WHERE o.user_id = u.id AND o.tenant_id <> m.tenant_id AND o.status <> 'SUSPENDED') AS otherTenants
              FROM tenant_memberships m
              JOIN users u ON u.id = m.user_id
              JOIN persons p ON p.id = u.person_id
              LEFT JOIN branches b ON b.id = m.branch_id`;
  }

  private toView(row: EmployeeRow): EmployeeView {
    let additional: unknown = row.additionalRoles;
    if (typeof additional === 'string') {
      try {
        additional = JSON.parse(additional);
      } catch {
        additional = null;
      }
    }
    const roles = membershipRoles({ role: row.role, additionalRoles: Array.isArray(additional) ? additional : null });
    const iso = (value: Date | string | null): string | null => (value ? new Date(value).toISOString() : null);
    return {
      id: row.userId,
      membershipId: row.membershipId,
      personId: row.personId,
      username: row.username,
      firstName: row.firstName,
      lastName: row.lastName,
      fullName: `${row.firstName} ${row.lastName}`.trim(),
      documentType: row.documentType === null ? null : Number(row.documentType),
      nationalId: row.nationalId,
      email: row.email,
      phone: row.phone,
      address: row.address,
      roles,
      primaryRole: roles[0] ?? row.role,
      branchId: row.branchId,
      branchName: row.branchName,
      status: row.status,
      sharedAccount: Number(row.otherTenants) > 0,
      lastLoginAt: iso(row.lastLoginAt),
      createdAt: iso(row.createdAt) ?? new Date(0).toISOString(),
    };
  }

  private translate(error: unknown, fallback: string): Error {
    if (
      error instanceof BadRequestException ||
      error instanceof ConflictException ||
      error instanceof ForbiddenException ||
      error instanceof NotFoundException
    ) {
      return error;
    }
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'ER_DUP_ENTRY') {
      const message = String((error as { sqlMessage?: string }).sqlMessage ?? '');
      if (message.includes('national_id')) return new ConflictException('Ya existe otra persona con ese documento en la empresa.');
      return new ConflictException('El usuario o el documento ya están registrados.');
    }
    if (error instanceof RangeError) return new BadRequestException(error.message);
    this.logger.error(fallback, error instanceof Error ? error.stack : String(error));
    return new InternalServerErrorException(fallback);
  }
}
