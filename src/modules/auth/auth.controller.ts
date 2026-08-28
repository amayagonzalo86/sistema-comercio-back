import {
  Controller,
  Post,
  Body,
  HttpCode,
  HttpStatus,
  Res,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { Response, Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(
    @Body() loginDto: LoginDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    // 1. Validar identidad del usuario (Tenant ID, Email, Password Hash Argon2)
    const user = await this.authService.validateUserCredentials(loginDto);

    // 2. Generar Access Token (15 min) y Refresh Token (7 días)
    const tokens = await this.authService.generateTokens(user);

    // 3. Inyectar Refresh Token en Cookie HTTP-Only Segura
    response.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000, // 7 días en milisegundos
      path: '/api/v1/auth/refresh',
    });

    // 4. Retornar Access Token y datos mínimos de usuario para la sesión en React
    return {
      accessToken: tokens.accessToken,
      user: {
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
        tenantId: user.tenantId,
      },
    };
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(
    @Req() request: Request,
    @Body() body: RefreshTokenDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    // Extraer token desde la cookie HTTP-Only o del body como fallback
    const tokenFromCookie = request.cookies?.['refreshToken'];
    const refreshToken = tokenFromCookie || body.refreshToken;

    if (!refreshToken) {
      throw new UnauthorizedException('Token de refresco no proporcionado');
    }

    // El ID del usuario se extrae del payload codificado del token recibido
    const decodedToken = JSON.parse(
      Buffer.from(refreshToken.split('.')[1], 'base64').toString(),
    );

    const tokens = await this.authService.refreshTokens(
      decodedToken.sub,
      refreshToken,
    );

    response.cookie('refreshToken', tokens.refreshToken, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 7 * 24 * 60 * 60 * 1000,
      path: '/api/v1/auth/refresh',
    });

    return {
      accessToken: tokens.accessToken,
    };
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: Request,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = request.cookies?.['refreshToken'];

    if (refreshToken) {
      try {
        const decodedToken = JSON.parse(
          Buffer.from(refreshToken.split('.')[1], 'base64').toString(),
        );
        // Anular el hash guardado en la base de datos
        await this.authService['userRepository'].update(decodedToken.sub, {
          currentHashedRefreshToken: undefined,
        });
      } catch {
        // Ignorar errores de parseo si el token expiró o viene corrupto
      }
    }

    // Destruir cookie de refresco
    response.clearCookie('refreshToken', {
      path: '/api/v1/auth/refresh',
    });

    return { message: 'Sesión cerrada exitosamente' };
  }
}