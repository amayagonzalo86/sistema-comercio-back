import { EntityManager } from 'typeorm';

/**
 * Operadores de la plataforma (rol global SUPER_ADMIN): el dueño del sistema y su equipo de soporte.
 *
 * Pueden tener membresía en las empresas para dar soporte, pero NO son empleados de la empresa:
 * no aparecen en listados de usuarios ni empleados, nadie de la empresa puede editarlos y, donde
 * corresponde mostrar quién hizo algo (auditoría, reportes), figuran como "Soporte de la plataforma".
 * Sus acciones se siguen registrando: la trazabilidad no se pierde, solo se oculta la identidad.
 */
export const PLATFORM_SUPPORT_LABEL = 'Soporte de la plataforma';

/** Subconsulta SQL con los ids de los operadores de plataforma (para NOT IN / IN). */
export const PLATFORM_OPERATOR_IDS_SQL =
  "SELECT ur.user_id FROM users_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name = 'SUPER_ADMIN'";

export async function platformOperatorIds(manager: EntityManager): Promise<Set<string>> {
  const rows = (await manager.query(PLATFORM_OPERATOR_IDS_SQL)) as Array<{ user_id: string }>;
  return new Set(rows.map((row) => String(row.user_id)));
}

export async function isPlatformOperator(manager: EntityManager, userId: string): Promise<boolean> {
  const rows = (await manager.query(`${PLATFORM_OPERATOR_IDS_SQL} AND ur.user_id = ? LIMIT 1`, [userId])) as unknown[];
  return rows.length > 0;
}
