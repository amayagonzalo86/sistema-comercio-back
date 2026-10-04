import { Body, Controller, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
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
  async refresh(@Req() request: Request, @Body() body: RefreshTokenDto, @Res({ passthrough: true }) response: Response ) {
    // Extraer token desde la cookie HTTP-Only o del body como fallback
    const tokenFromCookie = request.cookies?.['refreshToken'] as string | undefined;
    const refreshToken: string | undefined = tokenFromCookie ?? (typeof body.refreshToken === 'string' ? body.refreshToken : undefined);

    if (!refreshToken) { throw new UnauthorizedException('Token de refresco no proporcionado') }

    const tokens = await this.authService.refreshTokens(refreshToken);

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
    const refreshToken = request.cookies?.['refreshToken'] as string | undefined;

    try {
      await this.authService.logoutWithRefreshToken(refreshToken);
    } catch {
      // Invalid or expired tokens still result in the cookie being cleared.
    }

    // Destruir cookie de refresco
    response.clearCookie('refreshToken', {
      path: '/api/v1/auth/refresh',
    });

    return { message: 'Sesión cerrada exitosamente' };
  }
}