import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';

/** Tamaño máximo de una foto de producto. */
export const MAX_PRODUCT_IMAGE_BYTES = 3 * 1024 * 1024;

/** Nombre que genera el sistema: UUID aleatorio + extensión. Nunca se usa el nombre que manda el usuario. */
const FILE_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

export const IMAGE_CONTENT_TYPE: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', webp: 'image/webp' };

/** Carpeta de fotos: UPLOADS_DIR/products (por defecto ./uploads/products, fuera del código). */
export function productImagesDir(): string {
  const base = process.env.UPLOADS_DIR?.trim() || 'uploads';
  return join(isAbsolute(base) ? base : resolve(process.cwd(), base), 'products');
}

export function isProductImageName(name: string): boolean {
  return FILE_NAME.test(name);
}

export function productImageUrl(fileName: string | null | undefined): string | null {
  return fileName && isProductImageName(fileName) ? `/api/v1/product-images/${fileName}` : null;
}

/**
 * Tipo real del archivo según su contenido (no según la extensión ni el Content-Type que envía el navegador).
 * Solo se aceptan PNG, JPEG y WebP: un archivo disfrazado de imagen se rechaza.
 */
export function detectImageType(buffer: Buffer): 'png' | 'jpg' | 'webp' | null {
  if (buffer.length >= 8 && buffer.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buffer.length >= 3 && buffer[0] === 0xff && buffer[1] === 0xd8 && buffer[2] === 0xff) return 'jpg';
  if (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  return null;
}

/** Guarda la foto con un nombre aleatorio y devuelve ese nombre. */
export async function saveProductImage(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) throw new BadRequestException('El archivo está vacío.');
  if (buffer.length > MAX_PRODUCT_IMAGE_BYTES) throw new BadRequestException('La imagen supera los 3 MB.');
  const type = detectImageType(buffer);
  if (!type) throw new BadRequestException('Formato no admitido: subí una imagen PNG, JPG o WebP.');
  const dir = productImagesDir();
  await mkdir(dir, { recursive: true, mode: 0o750 });
  const name = `${randomUUID()}.${type}`;
  await writeFile(join(dir, name), buffer, { flag: 'wx', mode: 0o640 });
  return name;
}

/** Borra una foto anterior (si no existe, no es un error). */
export async function deleteProductImage(name: string | null | undefined): Promise<void> {
  if (!name || !isProductImageName(name)) return;
  await unlink(join(productImagesDir(), name)).catch(() => undefined);
}
