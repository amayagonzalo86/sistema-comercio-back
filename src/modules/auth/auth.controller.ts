import { Body, Controller, Get, HttpCode, HttpStatus, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { CookieOptions, Request, Response } from 'express';
import { AuthService, REFRESH_TOKEN_TTL_MS } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { getClientIp } from '../../common/http/request-context';

const REFRESH_COOKIE = 'refreshToken';
// La cookie se envía solo a /api/v1/auth (refresh y logout), nunca al resto de la API.
const REFRESH_COOKIE_PATH = '/api/v1/auth';

function refreshCookieBase(): CookieOptions {
  return {
    httpOnly: true, // JavaScript del navegador no puede leerla (mitiga robo por XSS).
    secure: process.env.NODE_ENV === 'production', // Solo por HTTPS en producción.
    sameSite: 'strict', // No viaja en peticiones originadas por otros sitios (mitiga CSRF).
    path: REFRESH_COOKIE_PATH,
  };
}

function refreshCookieOptions(): CookieOptions {
  return { ...refreshCookieBase(), maxAge: REFRESH_TOKEN_TTL_MS };
}

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) { }

  /**
   * Inicia sesión. El refresh token viaja SOLO en una cookie HttpOnly; el cuerpo devuelve
   * el access token (vida corta, guardarlo en memoria del frontend, no en localStorage).
   * El frontend debe llamar con `credentials: 'include'` para recibir la cookie.
   */
  @Post('login')
  @HttpCode(HttpStatus.OK)
  async login(@Body() loginDto: LoginDto, @Req() req: Request, @Res({ passthrough: true }) response: Response) {
    const ipAddress = getClientIp(req) ?? 'unknown';
    const userAgent = req.headers['user-agent']?.slice(0, 512);

    const { user, tokens } = await this.authService.login(loginDto, ipAddress, userAgent);
    response.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions());

    return { user, tokens: { accessToken: tokens.accessToken } };
  }

  @Get('tenants')
  @UseGuards(AuthGuard('jwt'))
  async listTenants(@Req() request: Request) {
    const authenticatedUser = request.user as { id: string };
    return this.authService.listUserTenants(authenticatedUser.id);
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  async refresh(@Req() request: Request, @Body() body: RefreshTokenDto, @Res({ passthrough: true }) response: Response ) {
    // Cookie HttpOnly para navegadores; cuerpo como alternativa para clientes nativos (apps móviles).
    const tokenFromCookie = request.cookies?.[REFRESH_COOKIE] as string | undefined;
    const refreshToken: string | undefined = tokenFromCookie ?? body.refreshToken;

    if (!refreshToken) { throw new UnauthorizedException('Token de refresco no proporcionado') }

    try {
      const tokens = await this.authService.refreshTokens(refreshToken);
      response.cookie(REFRESH_COOKIE, tokens.refreshToken, refreshCookieOptions());
      return { accessToken: tokens.accessToken };
    } catch (error) {
      response.clearCookie(REFRESH_COOKIE, refreshCookieBase());
      throw error;
    }
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  async logout(
    @Req() request: Request,
    @Body() body: RefreshTokenDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    const refreshToken = (request.cookies?.[REFRESH_COOKIE] as string | undefined) ?? body.refreshToken;

    try {
      await this.authService.logoutWithRefreshToken(refreshToken);
    } catch {
      // Invalid or expired tokens still result in the cookie being cleared.
    }

    response.clearCookie(REFRESH_COOKIE, refreshCookieBase());
    // Compatibilidad: borra también la cookie emitida por versiones anteriores con otra ruta.
    response.clearCookie(REFRESH_COOKIE, { path: '/api/v1/auth/refresh' });

    return { message: 'Sesión cerrada exitosamente' };
  }
}
