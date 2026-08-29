import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UserEntity, UserRole } from './entities/user.entity';
import { UpdateUserDto } from './dto/update-user.dto';
import { BranchEntity } from '../branches/entities/branch.entity';
import { AssignBranchDto } from './dto/assign-branch.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    @InjectRepository(BranchEntity)
    private readonly branchRepository: Repository<BranchEntity>,
  ) { }

  async create(createUserDto: CreateUserDto, tenantId: string): Promise<Omit<UserEntity, 'passwordHash'>> {
    const normalizedEmail = createUserDto.email.toLowerCase().trim();

    // 1. Verificar existencia del usuario dentro del Tenant
    const existingUser = await this.userRepository.findOne({
      where: {
        tenantId,
        email: normalizedEmail,
      },
    });

    if (existingUser) {
      throw new ConflictException(`El correo '${createUserDto.email}' ya está registrado en su organización`);
    }

    try {
      // 2. Hashear la contraseña con Argon2
      const passwordHash = await argon2.hash(createUserDto.password);

      // 3. Crear e instanciar entidad de manera atómica
      const newUser = this.userRepository.create({
        tenantId,
        email: normalizedEmail,
        passwordHash,
        firstName: createUserDto.firstName,
        lastName: createUserDto.lastName,
        role: createUserDto.role ?? UserRole.CASHIER,
        status: true,
      });

      const savedUser = await this.userRepository.save(newUser);
      this.logger.log(`Usuario creado exitosamente con ID: ${savedUser.id} en Tenant: ${tenantId}`);

      // 4. Limpieza de campos sensibles en la respuesta
      const { passwordHash: _, currentHashedRefreshToken: __, ...userResult } = savedUser;
      return userResult as Omit<UserEntity, 'passwordHash'>;
    } catch (error) {
      this.logger.error(
        'Error al insertar el usuario en la base de datos MySQL',
        error
      );
      throw new InternalServerErrorException(
        'Error al registrar el nuevo usuario'
      );
    }
  }

  async findAllByTenant(tenantId: string): Promise<UserEntity[]> {
    return await this.userRepository.find({
      where: { tenantId },
      select: {
        id: true,
        tenantId: true,
        email: true,
        firstName: true,
        lastName: true,
        role: true,
        status: true,
        createdAt: true,
      },
      order: { createdAt: 'DESC' },
    });
  }

  async findOne(id: string, tenantId: string): Promise<UserEntity> {
    const user = await this.userRepository.findOne({
      where: { id, tenantId },
      relations: { branch: true },
    });

    if (!user) {
      throw new NotFoundException(`El usuario con ID ${id} no fue encontrado`);
    }

    return user;
  }

  async update(
    id: string,
    tenantId: string,
    updateUserDto: UpdateUserDto,
  ): Promise<UserEntity> {
    const user = await this.findOne(id, tenantId);

    if (updateUserDto.email && updateUserDto.email !== user.email) {
      const emailExists = await this.userRepository.findOne({
        where: { email: updateUserDto.email, tenantId },
        withDeleted: true,
      });

      if (emailExists) {
        throw new ConflictException(
          'El correo electrónico ya está registrado en este tenant',
        );
      }
    }

    if (updateUserDto.password) {
      user.passwordHash = await argon2.hash(updateUserDto.password, {
        type: argon2.argon2id,
        memoryCost: 2 ** 16,
        timeCost: 3,
        parallelism: 1,
      });
      delete updateUserDto.password;
    }

    Object.assign(user, updateUserDto);
    return await this.userRepository.save(user);
  }

  async disable(id: string, tenantId: string): Promise<{ message: string }> {
    const user = await this.findOne(id, tenantId);

    user.status = false;
    await this.userRepository.save(user);
    await this.userRepository.softDelete({ id: user.id, tenantId });

    return {
      message: `Usuario ${user.email} deshabilitado con éxito`,
    };
  }

  async enable(id: string, tenantId: string): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { id, tenantId },
      withDeleted: true,
    });

    if (!user) {
      throw new NotFoundException(`Usuario con ID ${id} no existe`);
    }

    if (!user.deletedAt && user.status) {
      throw new BadRequestException('El usuario ya está activo');
    }

    await this.userRepository.restore({ id, tenantId });
    user.status = true;
    await this.userRepository.save(user);

    return {
      message: `Usuario ${user.email} habilitado con éxito`,
    };
  }

  /**
   * Asigna o actualiza la sucursal activa de un usuario dentro del mismo tenant.
   */
  async assignBranch(
    userId: string,
    assignBranchDto: AssignBranchDto,
    tenantId: string,
    adminId: string,
  ): Promise<UserEntity> {
    const { branchId } = assignBranchDto;

    // 1. Validar que el usuario exista en el mismo tenant
    const user = await this.userRepository.findOne({
      where: { id: userId, tenantId },
    });

    if (!user) {
      throw new NotFoundException(`El usuario con ID '${userId}' no existe en su organización`);
    }

    // 2. Validar que la sucursal exista, pertenezca al tenant y esté activa
    const branch = await this.branchRepository.findOne({
      where: { id: branchId, tenantId },
    });

    if (!branch) {
      throw new NotFoundException(
        `La sucursal con ID '${branchId}' no fue encontrada en su organización`,
      );
    }

    if (!branch.status) {
      throw new BadRequestException(
        `No se puede asignar la sucursal '${branch.name}' porque se encuentra deshabilitada`,
      );
    }

    // 3. Verificar si ya está asignado a esa misma sucursal
    if (user.branchId === branchId) {
      throw new ConflictException(
        `El usuario '${user.email}' ya se encuentra asignado a la sucursal '${branch.name}'`,
      );
    }

    const previousBranchId = user.branchId;
    user.branchId = branchId;
    user.branch = branch;

    const updatedUser = await this.userRepository.save(user);

    this.logger.log(
      `[AUDITORÍA] Admin ID '${adminId}' reasignó al Usuario ID '${userId}' de Sucursal '${previousBranchId || 'NINGUNA'}' a Sucursal '${branch.id}' (${branch.name})`,
    );

    return updatedUser;
  }

  /**
   * Remueve la asignación de sucursal de un usuario (deja el campo branchId en null).
   */
  async unassignBranch(
    userId: string,
    tenantId: string,
    adminId: string,
  ): Promise<{ message: string }> {
    const user = await this.userRepository.findOne({
      where: { id: userId, tenantId },
      relations: { branch: true },
    });

    if (!user) {
      throw new NotFoundException(`El usuario con ID '${userId}' no existe en su organización`);
    }

    if (!user.branchId) {
      throw new BadRequestException(`El usuario '${user.email}' no tiene ninguna sucursal asignada`);
    }

    const previousBranchName = user.branch?.name || user.branchId;

    user.branchId = null;
    user.branch = null;

    await this.userRepository.save(user);

    this.logger.log(
      `[AUDITORÍA] Admin ID '${adminId}' desvinculó al Usuario ID '${userId}' de la Sucursal '${previousBranchName}'`,
    );

    return {
      message: `El usuario '${user.email}' fue desvinculado de la sucursal '${previousBranchName}' correctamente`,
    };
  }

  /**
   * Obtiene todos los usuarios asignados a una sucursal específica.
   */
  async findUsersByBranch(
    branchId: string,
    tenantId: string,
  ): Promise<UserEntity[]> {
    const branch = await this.branchRepository.findOne({
      where: { id: branchId, tenantId },
    });

    if (!branch) {
      throw new NotFoundException(`La sucursal especificada no existe en su organización`);
    }

    return await this.userRepository.find({
      where: { branchId, tenantId },
      order: { email: 'ASC' },
    });
  }
}
