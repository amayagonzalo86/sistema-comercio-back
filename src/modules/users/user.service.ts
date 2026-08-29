import { BadRequestException, ConflictException, Injectable, InternalServerErrorException, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { Repository } from 'typeorm';
import { CreateUserDto } from './dto/create-user.dto';
import { UserEntity, UserRole } from './entities/user.entity';
import { UpdateUserDto } from './dto/update-user.dto';

@Injectable()
export class UsersService {
  private readonly logger = new Logger(UsersService.name);

  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
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
}
