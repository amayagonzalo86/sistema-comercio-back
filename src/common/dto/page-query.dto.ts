import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/** Paginación por página para tablas del frontend. Máximo 100 filas por pedido. */
export class PageQueryDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100000)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 25;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export function paginated<T>(items: T[], total: number, page: number, limit: number): Paginated<T> {
  return { items, total, page, limit, pages: Math.max(1, Math.ceil(total / limit)) };
}

/** Escapa comodines de LIKE para que una búsqueda con % o _ no recorra toda la tabla. */
export function likePattern(term: string): string {
  return `%${term.trim().replace(/[\\%_]/g, (char) => `\\${char}`)}%`;
}
