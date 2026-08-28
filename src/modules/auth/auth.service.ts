import { Injectable, UnauthorizedException, ForbiddenException } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as argon2 from 'argon2';
import { UserEntity } from '../users/entities/user.entity';
import { LoginDto } from './dto/login.dto';

export interface JwtPayload {
  sub: string;
  email: string;
  tenantId: string;
  role: string;
}

@Injectable()
export class AuthService {
  constructor(
    @InjectRepository(UserEntity)
    private readonly userRepository: Repository<UserEntity>,
    private readonly jwtService: JwtService,
  ) {}

  async validateUserCredentials(loginDto: LoginDto): Promise<UserEntity> {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: loginDto.email })
      .andWhere('user.tenantId = :tenantId', { tenantId: loginDto.tenantId })
      .andWhere('user.status = :status', { status: true })
      .getOne();

    if (!user) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    const isPasswordValid = await argon2.verify(user.passwordHash, loginDto.password);
    if (!isPasswordValid) {
      throw new UnauthorizedException('Credenciales inválidas');
    }

    return user;
  }

  async generateTokens(user: UserEntity) {
    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      tenantId: user.tenantId,
      role: user.role,
    };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_ACCESS_SECRET,
        expiresIn: '15m',
      }),
      this.jwtService.signAsync(payload, {
        secret: process.env.JWT_REFRESH_SECRET,
        expiresIn: '7d',
      }),
    ]);

    await this.updateRefreshToken(user.id, refreshToken);

    return { accessToken, refreshToken };
  }

  private async updateRefreshToken(userId: string, refreshToken: string): Promise<void> {
    const hashedToken = await argon2.hash(refreshToken);
    await this.userRepository.update(userId, {
      currentHashedRefreshToken: hashedToken,
    });
  }

  async refreshTokens(userId: string, refreshToken: string) {
    const user = await this.userRepository
      .createQueryBuilder('user')
      .addSelect('user.currentHashedRefreshToken')
      .where('user.id = :id', { id: userId })
      .getOne();

    if (!user || !user.currentHashedRefreshToken) {
      throw new ForbiddenException('Acceso Denegado');
    }

    const refreshTokenMatches = await argon2.verify(
      user.currentHashedRefreshToken,
      refreshToken,
    );

    if (!refreshTokenMatches) {
      throw new ForbiddenException('Acceso Denegado');
    }

    return this.generateTokens(user);
  }
}