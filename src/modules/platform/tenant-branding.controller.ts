import {
  BadRequestException,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { FileInterceptor } from '@nestjs/platform-express';
import { SkipThrottle } from '@nestjs/throttler';
import { Request, Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { GetTenantId } from '../../common/decorators/get-tenant.decorator';
import { Roles } from '../../common/decorators/roles.decorator';
import { PlatformSuperAdminGuard } from '../../common/guards/platform-super-admin.guard';
import { RolesGuard } from '../../common/guards/roles.guard';
import { TenantContextGuard } from '../../common/guards/tenant-context.guard';
import { buildAuditContext } from '../../common/http/request-context';
import { IMAGE_CONTENT_TYPE } from '../inventory/product/product-images';
import { UserRoleEnum } from '../roles/entities/role.entity';
import { TenantBrandingService, TenantBrandingView } from './tenant-branding.service';
import { isTenantLogoName, MAX_TENANT_LOGO_BYTES, tenantLogosDir } from './tenant-logo';

type UploadedImage = { buffer: Buffer; size: number } | undefined;
const logoUpload = FileInterceptor('logo', { limits: { fileSize: MAX_TENANT_LOGO_BYTES, files: 1, fields: 0 } });
const actorId = (request: Request): string => (request.user as { id: string }).id;

/**
 * Logos de empresas. Se sirven públicos (las etiquetas <img> y el ícono de la pestaña no envían el token),
 * con un nombre aleatorio imposible de adivinar y solo archivos generados por el sistema.
 */
@Controller('tenant-logos')
@SkipThrottle()
export class TenantLogosController {
  @Get(':file')
  serve(@Param('file') file: string, @Res() response: Response): void {
    if (!isTenantLogoName(file)) throw new NotFoundException('Logo no encontrado.');
    const path = join(tenantLogosDir(), file);
    if (!existsSync(path)) throw new NotFoundException('Logo no encontrado.');
    response.setHeader('Content-Type', IMAGE_CONTENT_TYPE[file.slice(file.lastIndexOf('.') + 1)]);
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.sendFile(path, { dotfiles: 'deny' });
  }
}

/** Identidad de la propia empresa: la administración (titular o admin) sube o quita el logo. */
@Controller('company')
@UseGuards(AuthGuard('jwt'), TenantContextGuard, RolesGuard)
export class CompanyBrandingController {
  constructor(private readonly branding: TenantBrandingService) {}

  @Get('branding')
  view(@GetTenantId() tenantId: string): Promise<TenantBrandingView> {
    return this.branding.view(tenantId);
  }

  @Post('logo')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(logoUpload)
  upload(@GetTenantId() tenantId: string, @Req() request: Request, @UploadedFile() file: UploadedImage): Promise<TenantBrandingView> {
    if (!file?.buffer) throw new BadRequestException('Adjuntá el logo en el campo "logo".');
    return this.branding.setLogo(tenantId, file.buffer, actorId(request), buildAuditContext(request));
  }

  @Delete('logo')
  @Roles(UserRoleEnum.SUPER_ADMIN, UserRoleEnum.ADMIN)
  remove(@GetTenantId() tenantId: string, @Req() request: Request): Promise<TenantBrandingView> {
    return this.branding.removeLogo(tenantId, actorId(request), buildAuditContext(request));
  }
}

/** El operador de la plataforma cambia el logo de cualquier empresa. */
@Controller('platform/tenants')
@UseGuards(AuthGuard('jwt'), PlatformSuperAdminGuard)
export class PlatformBrandingController {
  constructor(private readonly branding: TenantBrandingService) {}

  @Post(':tenantId/logo')
  @HttpCode(HttpStatus.OK)
  @UseInterceptors(logoUpload)
  upload(
    @Param('tenantId', ParseUUIDPipe) tenantId: string,
    @Req() request: Request,
    @UploadedFile() file: UploadedImage,
  ): Promise<TenantBrandingView> {
    if (!file?.buffer) throw new BadRequestException('Adjuntá el logo en el campo "logo".');
    return this.branding.setLogo(tenantId, file.buffer, actorId(request), buildAuditContext(request));
  }

  @Delete(':tenantId/logo')
  remove(@Param('tenantId', ParseUUIDPipe) tenantId: string, @Req() request: Request): Promise<TenantBrandingView> {
    return this.branding.removeLogo(tenantId, actorId(request), buildAuditContext(request));
  }
}
