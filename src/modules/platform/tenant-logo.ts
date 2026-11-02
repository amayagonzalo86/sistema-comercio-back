import { BadRequestException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { mkdir, unlink, writeFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { detectImageType } from '../inventory/product/product-images';

/** Tamaño máximo del logo de la empresa (se muestra chico: menú, pestaña del navegador y tickets). */
export const MAX_TENANT_LOGO_BYTES = 1024 * 1024;

/** Nombre generado por el sistema (UUID + extensión); nunca se usa el nombre del archivo subido. */
const LOGO_NAME = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\.(png|jpg|webp)$/;

/** Carpeta de logos: UPLOADS_DIR/logos (por defecto ./uploads/logos, fuera del código). */
export function tenantLogosDir(): string {
  const base = process.env.UPLOADS_DIR?.trim() || 'uploads';
  return join(isAbsolute(base) ? base : resolve(process.cwd(), base), 'logos');
}

export function isTenantLogoName(name: string): boolean {
  return LOGO_NAME.test(name);
}

export function tenantLogoUrl(name: string | null | undefined): string | null {
  return name && isTenantLogoName(name) ? `/api/v1/tenant-logos/${name}` : null;
}

/** Guarda el logo (solo PNG, JPG o WebP según su contenido real; SVG no, porque puede contener scripts). */
export async function saveTenantLogo(buffer: Buffer): Promise<string> {
  if (buffer.length === 0) throw new BadRequestException('El archivo está vacío.');
  if (buffer.length > MAX_TENANT_LOGO_BYTES) throw new BadRequestException('El logo supera 1 MB.');
  const type = detectImageType(buffer);
  if (!type) throw new BadRequestException('Formato no admitido: subí el logo en PNG, JPG o WebP.');
  const dir = tenantLogosDir();
  await mkdir(dir, { recursive: true, mode: 0o750 });
  const name = `${randomUUID()}.${type}`;
  await writeFile(join(dir, name), buffer, { flag: 'wx', mode: 0o640 });
  return name;
}

export async function deleteTenantLogo(name: string | null | undefined): Promise<void> {
  if (!name || !isTenantLogoName(name)) return;
  await unlink(join(tenantLogosDir(), name)).catch(() => undefined);
}
