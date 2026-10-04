import {
  BadRequestException,
  ConflictException,
  Injectable,
  InternalServerErrorException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { In, Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UpdateUserDto } from './dto/update-user.dto';
import { AssignBranchDto } from './dto/assign-branch.dto';
import { UserEntity } from './entities/user.entity';
import { PersonEntity } from '../persons/entities/person.entity';
import { BranchEntity } from '../branches/entities/branch.entity';
import { RoleEntity, UserRoleEnum } from '../roles/entities/role.entity';
import { MembershipStatus, TenantMembershipEntity, TenantRole } from '../platform/entities/tenant-membership.entity';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);
  constructor(
    @InjectRepository(RoleEntity)
    private readonly roleRepository: Repository<RoleEntity>,
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(PersonEntity)
    private readonly personRepository: Repository<PersonEntity>,
    @InjectRepository(BranchEntity)
    private readonly branchRepository: Repository<BranchEntity>,
    @InjectRepository(TenantMembershipEntity)
    private readonly membershipRepository: Repository<TenantMembershipEntity>,
  ) {}

  async create(tenantId: string, createUserDto: CreateUserDto): Promise<Omit<UserEntity, 'passwordHash' | 'currentHashedRefreshToken'>> {
    try {
      const { username, password, roleIds, personId, branchId } = createUserDto;
      if (roleIds.length !== 1) {
        throw new BadRequestException('Cada usuario debe tener un único rol por empresa.');
      }
        
      // 1. Verificar si el username ya está registrado
      const existingUserByUsername = await this.userRepository.findOne({ where: { username } });
      if (existingUserByUsername) { throw new ConflictException(`El nombre de usuario '${username}' ya está registrado en el sistema`) }
        
      // 2. Validar existencia previa e independiente de la persona
      const person = await this.personRepository.findOne({ where: { id: personId, tenantId } });
      if (!person) { throw new NotFoundException(`No existe una persona registrada con el ID ${personId}. Debe crear la persona previamente.`) }
        
      // 3. Verificar que la persona no posea ya un usuario asociado
      const existingUserByPerson = await this.userRepository.findOne({ where: { person: { id: personId } } });
      if (existingUserByPerson) { throw new ConflictException(`La persona especificada ya tiene un usuario asignado ('${existingUserByPerson.username}')`) }
        

      const roles = await this.roleRepository.findBy({ id: In(roleIds) });
      if (roles.length !== roleIds.length) {
        throw new NotFoundException('Uno o más roles especificados no existen en el sistema');
      }

      // 4. Validar sucursal opcional
      let branch: BranchEntity | null = null;
      if (branchId) {
        branch = await this.branchRepository.findOne({ where: { id: branchId, tenantId } });
        if (!branch) { throw new NotFoundException(`Sucursal con ID ${branchId} no encontrada`) }
      }
        
      // 5. Cifrar la contraseña con Argon2
      const passwordHash = await argon2.hash(password);
      
      // 6. Instanciar y guardar la entidad
      const newUser = this.userRepository.create({
        username,
        passwordHash,
        roles,
        person,
        isActive: true,
      });
        
      const savedUser = await this.userRepository.save(newUser);
      await this.membershipRepository.save({
        tenantId,
        userId: savedUser.id,
        branchId: branch?.id ?? null,
        role: this.toTenantRole(roles[0].name),
        status: MembershipStatus.ACTIVE,
        acceptedAt: new Date(),
      });
        
      // 7. Omitir credenciales en la respuesta
      delete (savedUser as Partial<UserEntity>).passwordHash;
      delete (savedUser as Partial<UserEntity>).currentHashedRefreshToken;
      return savedUser;
    } catch (error) {
      if ( error instanceof NotFoundException || error instanceof ConflictException || error instanceof BadRequestException ) {
        throw error;
      }
      this.logger.error(`Error al crear el usuario: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined );
      throw new InternalServerErrorException('No se pudo crear el usuario');
    }
  }
  
  async findAll(tenantId: string): Promise<UserEntity[]> {
    try{
      const users = await this.userRepository.find({ where: { memberships: { tenantId, status: MembershipStatus.ACTIVE } }, relations: { person: true, branch: true, roles: true },
        select: {
          id: true,
          username: true,
          roles: true,
          isActive: true,
          createdAt: true,
          updatedAt: true,
        },
      });
      return this.attachTenantBranches(users, tenantId);
    } catch (error){
      this.logger.error(`Error al obtener usuarios: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException('No se pudieron obtener los usuarios');
    }
  };

  async findOne(id: string, tenantId: string): Promise<UserEntity> {
    try {
      const user = await this.userRepository.findOne({ where: { id, memberships: { tenantId, status: MembershipStatus.ACTIVE } },  relations: { person: true, branch: true, roles: true } });
      if (!user) { throw new NotFoundException(`Usuario con ID ${id} no encontrado`) }
      await this.attachTenantBranches([user], tenantId);
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) { throw error }
      this.logger.error(`Error al obtener el usuario con ID ${id}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException('No se pudo obtener el usuario');
    }
  };

  async findByUsername(username: string, tenantId: string): Promise<UserEntity> {
    try {
      const user = await this.userRepository.findOne({ where: { username, memberships: { tenantId, status: MembershipStatus.ACTIVE } }, relations: { person: true, branch: true, roles: true } });
      if (!user) { throw new NotFoundException(`Usuario con el nombre '${username}' no encontrado`) }
      await this.attachTenantBranches([user], tenantId);
      return user;
    } catch (error) {
      if (error instanceof NotFoundException) { throw error }
      this.logger.error(`Error al obtener el usuario con nombre '${username}': ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException('No se pudo obtener el usuario');
    }
  }

  async update(id: string, tenantId: string, updateUserDto: UpdateUserDto): Promise<UserEntity> {
    const user = await this.findOne(id, tenantId);

    if (updateUserDto.username && updateUserDto.username !== user.username) {
      const existingUsername = await this.userRepository.findOne({ where: { username: updateUserDto.username } });
      if (existingUsername) { throw new ConflictException(`El nombre de usuario '${updateUserDto.username}' ya está en uso`) }
      user.username = updateUserDto.username;
    }

    if (updateUserDto.password) {
      user.passwordHash = await argon2.hash(updateUserDto.password);
    }

    if (updateUserDto.roleIds) {
      if (updateUserDto.roleIds.length !== 1) {
        throw new BadRequestException('Cada usuario debe tener un único rol por empresa.');
      }
      const roles = await this.roleRepository.findBy({
        id: In(updateUserDto.roleIds),
      });
      if (roles.length !== updateUserDto.roleIds.length) {
        throw new NotFoundException(
          'Uno o más roles especificados no existen en el sistema',
        );
      }
      await this.membershipRepository.update(
        { userId: user.id, tenantId, status: MembershipStatus.ACTIVE },
        { role: this.toTenantRole(roles[0].name) },
      );
    }

    if (updateUserDto.branchId !== undefined) {
      if (updateUserDto.branchId === null) {
        user.branch = null;
        user.branchId = null;
        await this.membershipRepository.update(
          { userId: user.id, tenantId, status: MembershipStatus.ACTIVE },
          { branchId: null },
        );
      } else {
        const branch = await this.branchRepository.findOne({
          where: { id: updateUserDto.branchId, tenantId },
        });
        if (!branch) {
          throw new NotFoundException(
            `Sucursal con ID ${updateUserDto.branchId} no encontrada`,
          );
        }
        user.branch = branch;
        user.branchId = branch.id;
        await this.membershipRepository.update(
          { userId: user.id, tenantId, status: MembershipStatus.ACTIVE },
          { branchId: branch.id },
        );
      }
    }

    if (updateUserDto.isActive !== undefined) {
      await this.membershipRepository.update(
        { userId: user.id, tenantId, status: MembershipStatus.ACTIVE },
        { status: updateUserDto.isActive ? MembershipStatus.ACTIVE : MembershipStatus.SUSPENDED },
      );
    }

    // branch and role are membership-scoped; never write them to global user columns.
    user.branch = null;
    user.branchId = null;
    await this.userRepository.save(user);
    return this.findOne(id, tenantId);
  }

  async assignBranch(tenantId: string, assignBranchDto: AssignBranchDto): Promise<UserEntity> {
    const { branchId , userId } = assignBranchDto;
    const user = await this.findOne(userId, tenantId);
    const branchFind = await this.branchRepository.findOne({ where: { id: branchId, tenantId } });
    if (!branchFind) { throw new NotFoundException(`Sucursal con ID ${assignBranchDto.branchId} no encontrada`) }
    await this.membershipRepository.update(
      { userId: user.id, tenantId, status: MembershipStatus.ACTIVE },
      { branchId: branchFind.id },
    );
    return this.findOne(userId, tenantId);
  };

  async unassignBranch(userId: string, tenantId: string): Promise<{ message: string }> {
    try {
      const user = await this.findOne(userId, tenantId);
      if (!user.branch) { throw new BadRequestException('El usuario no tiene una sucursal asignada') }
      await this.membershipRepository.update(
        { userId: user.id, tenantId, status: MembershipStatus.ACTIVE },
        { branchId: null },
      );

      return { message: 'Sucursal desasignada correctamente del usuario' };
    } catch (error) {
      if (error instanceof NotFoundException || error instanceof BadRequestException) { throw error }
      this.logger.error(`Error al desasignar la sucursal del usuario con ID ${userId}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException('No se pudo desasignar la sucursal del usuario');
    }
  };

  async findUsersByBranch(branchId: string, tenantId: string): Promise<UserEntity[]> {
    try {
      const branch = await this.branchRepository.findOne({ where: { id: branchId, tenantId } });
      if (!branch) { throw new NotFoundException(`Sucursal con ID ${branchId} no encontrada`) }

      return await this.userRepository.find({ where: { memberships: { tenantId, branchId, status: MembershipStatus.ACTIVE } }, relations: { person: true },
        select: {
          id: true,
          username: true,
          roles: true,
          isActive: true,
        },
      });
    } catch (error) {
      if (error instanceof NotFoundException) { throw error; }
      this.logger.error( `Error al obtener usuarios de la sucursal con ID ${branchId}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException('No se pudieron obtener los usuarios de la sucursal');
    }
  };

  async disable(id: string, tenantId: string): Promise<{ message: string }> {
    try {
      const user = await this.findOne(id, tenantId);
      await this.membershipRepository.update(
        { userId: user.id, tenantId, status: MembershipStatus.ACTIVE },
        { status: MembershipStatus.SUSPENDED },
      );
      return { message: `El usuario '${user.username}' ha sido desactivado en esta empresa` };
    } catch (error) {
      if (error instanceof NotFoundException) { throw error }
      this.logger.error( `Error al desactivar el usuario con ID ${id}: ${error instanceof Error ? error.message : String(error)}`, error instanceof Error ? error.stack : undefined);
      throw new InternalServerErrorException('No se pudo desactivar el usuario');
    }
  };

  async enable(id: string, tenantId: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { id, memberships: { tenantId } },
      relations: { person: true, branch: true, roles: true },
    });
    if (!user) throw new NotFoundException(`Usuario con ID ${id} no encontrado`);
    await this.membershipRepository.update(
      { userId: user.id, tenantId, status: MembershipStatus.SUSPENDED },
      { status: MembershipStatus.ACTIVE, acceptedAt: new Date() },
    );
    return { message: `El usuario '${user.username}' ha sido activado en esta empresa` };
  }
  private async attachTenantBranches(users: UserEntity[], tenantId: string): Promise<UserEntity[]> {
    if (users.length === 0) return users;
    const memberships = await this.membershipRepository.find({
      where: {
        tenantId,
        userId: In(users.map((user) => user.id)),
        status: MembershipStatus.ACTIVE,
      },
      relations: { branch: true },
    });
    const branchByUser = new Map(memberships.map((membership) => [
      membership.userId,
      { branch: membership.branch ?? null, branchId: membership.branchId ?? null },
    ]));
    for (const user of users) {
      const assignment = branchByUser.get(user.id);
      user.branch = assignment?.branch ?? null;
      user.branchId = assignment?.branchId ?? null;
    }
    return users;
  }

  private toTenantRole(role: UserRoleEnum): TenantRole {
    const mapping: Record<UserRoleEnum, TenantRole> = {
      [UserRoleEnum.SUPER_ADMIN]: TenantRole.OWNER,
      [UserRoleEnum.ADMIN]: TenantRole.ADMIN,
      [UserRoleEnum.MANAGER]: TenantRole.MANAGER,
      [UserRoleEnum.CASHIER]: TenantRole.CASHIER,
      [UserRoleEnum.WAREHOUSE]: TenantRole.INVENTORY,
      [UserRoleEnum.USER]: TenantRole.VIEWER,
      [UserRoleEnum.SELLER]: TenantRole.SELLER,
      [UserRoleEnum.STOCK_CLERK]: TenantRole.INVENTORY,
    };
    return mapping[role];
  }

}