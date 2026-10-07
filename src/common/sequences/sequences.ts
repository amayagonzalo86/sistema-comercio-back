import { EntityManager } from 'typeorm';

/**
 * Devuelve el siguiente número correlativo para (empresa, nombre).
 * Debe llamarse dentro de una transacción: el UPSERT bloquea la fila hasta el commit,
 * así dos operaciones concurrentes nunca obtienen el mismo número y un rollback no deja huecos.
 */
export async function nextSequence(manager: EntityManager, tenantId: string, name: string): Promise<number> {
  await manager.query(
    `INSERT INTO document_sequences (tenant_id, name, value) VALUES (?, ?, 1)
     ON DUPLICATE KEY UPDATE value = value + 1`,
    [tenantId, name],
  );
  const rows = (await manager.query(
    'SELECT value FROM document_sequences WHERE tenant_id = ? AND name = ? FOR UPDATE',
    [tenantId, name],
  )) as Array<{ value: number | string }>;
  return Number(rows[0]?.value ?? 1);
}
