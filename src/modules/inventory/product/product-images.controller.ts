import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Response } from 'express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { IMAGE_CONTENT_TYPE, isProductImageName, productImagesDir } from './product-images';

/**
 * Fotos de productos. Son públicas como las de un catálogo (las etiquetas <img> no envían el token),
 * pero el nombre es un UUID aleatorio imposible de adivinar y solo se sirven archivos generados por el sistema.
 */
@Controller('product-images')
@SkipThrottle()
export class ProductImagesController {
  @Get(':file')
  serve(@Param('file') file: string, @Res() response: Response): void {
    if (!isProductImageName(file)) throw new NotFoundException('Imagen no encontrada.');
    const path = join(productImagesDir(), file);
    if (!existsSync(path)) throw new NotFoundException('Imagen no encontrada.');
    const extension = file.slice(file.lastIndexOf('.') + 1);
    response.setHeader('Content-Type', IMAGE_CONTENT_TYPE[extension]);
    response.setHeader('Content-Disposition', 'inline');
    response.setHeader('X-Content-Type-Options', 'nosniff');
    // Cada foto nueva tiene otro nombre: se puede guardar en caché indefinidamente.
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    response.sendFile(path, { dotfiles: 'deny' });
  }
}
