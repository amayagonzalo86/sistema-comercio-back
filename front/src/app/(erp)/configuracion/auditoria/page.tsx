'use client';

import { Fragment, useEffect, useState } from 'react';
import { EmptyState, ErrorAlert, SkeletonRows, TableMessage } from '@/components/ui/Feedback';
import { RequireCapability } from '@/components/ui/Guard';
import { PageHeader } from '@/components/ui/PageHeader';
import { auditApi } from '@/lib/api/endpoints';
import type { AuditEvent } from '@/lib/api/types';
import { dateTime } from '@/lib/format';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { useDebounce } from '@/lib/hooks/useDebounce';

export default function AuditPage() {
  return (
    <RequireCapability capability="admin.audit">
      <Audit />
    </RequireCapability>
  );
}

function Audit() {
  const [eventType, setEventType] = useState('');
  const [aggregateType, setAggregateType] = useState('');
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const type = useDebounce(eventType.trim(), 400);
  const aggregate = useDebounce(aggregateType.trim(), 400);
  const page = useApiQuery(() => auditApi.list({ limit: 50, cursor, eventType: type || undefined, aggregateType: aggregate || undefined }), [cursor, type, aggregate]);

  useEffect(() => {
    setCursor(undefined);
  }, [type, aggregate]);

  useEffect(() => {
    const data = page.data;
    if (!data) return;
    setEvents((current) => (cursor ? [...current, ...data.items] : data.items));
  }, [page.data, cursor]);

  return (
    <>
      <PageHeader eyebrow="Empresa" title="Auditoría" subtitle="Quién hizo qué, cuándo y desde dónde: ventas, cambios de precios, IVA, caja, stock y configuración fiscal." />
      <section className="surface">
        <div className="toolbar">
          <input className="form-control form-control-sm w-auto" placeholder="Evento (ej.: SALE_CREATED)" value={eventType} onChange={(event) => setEventType(event.target.value.toUpperCase())} />
          <input className="form-control form-control-sm w-auto" placeholder="Entidad (ej.: SALE, PRODUCT)" value={aggregateType} onChange={(event) => setAggregateType(event.target.value.toUpperCase())} />
        </div>
        {page.error && <div className="p-3 pb-0"><ErrorAlert message={page.error} onRetry={page.reload} /></div>}
        <div className="table-responsive">
          <table className="table table-erp">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Evento</th>
                <th>Entidad</th>
                <th>Usuario</th>
                <th>IP</th>
                <th />
              </tr>
            </thead>
            {page.loading && events.length === 0 ? (
              <SkeletonRows columns={6} />
            ) : events.length === 0 ? (
              <TableMessage colSpan={6}><EmptyState icon="bi-shield-check" title="Sin eventos para esos filtros" /></TableMessage>
            ) : (
              <tbody>
                {events.map((event) => (
                  <Fragment key={event.id}>
                    <tr>
                      <td className="text-nowrap">{dateTime(event.createdAt)}</td>
                      <td><span className="mono small fw-semibold">{event.eventType}</span></td>
                      <td><span className="small">{event.aggregateType}</span><div className="cell-sub mono">{event.aggregateId.slice(0, 13)}</div></td>
                      <td className="mono small">{event.actorUserId ? event.actorUserId.slice(0, 8) : 'Sistema'}</td>
                      <td className="mono small">{event.ipAddress ?? '—'}</td>
                      <td className="text-end">
                        {event.metadata && (
                          <button type="button" className="btn btn-sm btn-link" onClick={() => setExpanded(expanded === event.id ? null : event.id)}>
                            {expanded === event.id ? 'Ocultar' : 'Detalle'}
                          </button>
                        )}
                      </td>
                    </tr>
                    {expanded === event.id && (
                      <tr>
                        <td colSpan={6} className="bg-light">
                          <pre className="small mb-0 mono" style={{ whiteSpace: 'pre-wrap' }}>{JSON.stringify(event.metadata, null, 2)}</pre>
                          {event.requestId && <div className="small text-muted-2 mt-1">Request ID: <span className="mono">{event.requestId}</span></div>}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                ))}
              </tbody>
            )}
          </table>
        </div>
        {page.data?.nextCursor && (
          <div className="p-2 text-center border-top">
            <button type="button" className="btn btn-sm btn-light" onClick={() => setCursor(page.data?.nextCursor ?? undefined)} disabled={page.loading}>Cargar más</button>
          </div>
        )}
      </section>
    </>
  );
}
