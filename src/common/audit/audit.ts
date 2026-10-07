import { EntityManager } from 'typeorm';
import { AuditEventEntity } from '../../modules/platform/entities/audit-event.entity';
import { RequestAuditContext } from '../http/request-context';

export interface AuditInput {
  tenantId: string;
  actorUserId: string | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  metadata?: Record<string, unknown> | null;
  context?: RequestAuditContext;
}

/** Registra un evento de auditoría dentro de la transacción recibida (se confirma o revierte junto a la operación). */
export async function recordAudit(manager: EntityManager, input: AuditInput): Promise<void> {
  await manager.save(
    AuditEventEntity,
    manager.create(AuditEventEntity, {
      tenantId: input.tenantId,
      actorUserId: input.actorUserId,
      requestId: input.context?.requestId ?? null,
      ipAddress: input.context?.ipAddress ?? null,
      userAgent: input.context?.userAgent ?? null,
      eventType: input.eventType,
      aggregateType: input.aggregateType,
      aggregateId: input.aggregateId,
      metadata: input.metadata ?? null,
    }),
  );
}
