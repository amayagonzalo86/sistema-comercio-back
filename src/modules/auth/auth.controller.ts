import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  Res,
  UnauthorizedException
} from '@nestjs/common';
import { Request, Response } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() req: Request) {
    const ipAddress =
      (req.headers['x-forwarded-for'] as string) || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'];

    return await this.authService.login(loginDto, ipAddress, userAgent);
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