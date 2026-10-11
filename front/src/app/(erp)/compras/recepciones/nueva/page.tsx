'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { PersonPicker } from '@/components/forms/PersonPicker';
import { PurchaseLinesEditor, type PurchaseLineDraft } from '@/components/forms/PurchaseLinesEditor';
import { ErrorAlert } from '@/components/ui/Feedback';
import { Field } from '@/components/ui/Field';
import { RequireCapability } from '@/components/ui/Guard';
import { PageHeader } from '@/components/ui/PageHeader';
import { Surface } from '@/components/ui/Surface';
import { useToast } from '@/components/ui/Toast';
import { errorMessage, newIdempotencyKey } from '@/lib/api/client';
import { personsApi, purchaseOrdersApi, receiptsApi } from '@/lib/api/endpoints';
import type { CreatePurchaseReceiptRequest, Person, PurchaseOrder } from '@/lib/api/types';
import { useSession } from '@/lib/auth/session';
import { parseLocaleNumber, qty, toNumber } from '@/lib/format';

const DOCUMENT_TYPES = ['Factura A', 'Factura B', 'Factura C', 'Remito', 'Otro'];

export default function NewReceiptPage() {
  return (
    <RequireCapability capability="purchases.receive">
      <NewReceipt />
    </RequireCapability>
  );
}

function NewReceipt() {
  const router = useRouter();
  const toast = useToast();
  const { branches, activeBranchId, branchLocked } = useSession();
  const [order, setOrder] = useState<PurchaseOrder | null>(null);
  const [supplier, setSupplier] = useState<Person | null>(null);
  const [branchId, setBranchId] = useState('');
  const [lines, setLines] = useState<PurchaseLineDraft[]>([]);
  const [docType, setDocType] = useState('Factura A');
  const [docNumber, setDocNumber] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [updatePrices, setUpdatePrices] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const key = useRef<{ signature: string; key: string } | null>(null);
  const effectiveBranch = order?.branchId ?? (branchId || activeBranchId || branches[0]?.id || '');

  // ?pedido=<id>: precarga lo pendiente de recibir de un pedido enviado.
  useEffect(() => {
    const orderId = new URLSearchParams(window.location.search).get('pedido');
    if (!orderId) return;
    purchaseOrdersApi
      .get(orderId)
      .then(async (loaded) => {
        setOrder(loaded);
        setLines(
          (loaded.items ?? [])
            .map((item) => {
              const pending = Math.max(0, toNumber(item.quantityOrdered) - toNumber(item.quantityReceived));
              return {
                productId: item.productId,
                sku: item.skuSnapshot,
                name: item.nameSnapshot,
                quantity: String(Math.round(pending * 1000) / 1000),
                unitCost: String(toNumber(item.unitCost)),
                taxRate: toNumber(item.taxRate),
                pending: qty(pending),
              };
            })
            .filter((line) => toNumber(line.quantity) > 0),
        );
        setSupplier(await personsApi.get(loaded.supplierPersonId));
      })
      .catch((caught: unknown) => setError(errorMessage(caught)));
  }, []);

  const submit = async () => {
    if (!supplier) return setError('Elegí el proveedor.');
    if (lines.length === 0) return setError('Agregá al menos un producto.');
    const parsed = lines.map((line) => ({ productId: line.productId, quantity: parseLocaleNumber(line.quantity), unitCost: parseLocaleNumber(line.unitCost), taxRate: line.taxRate }));
    if (parsed.some((line) => Number.isNaN(line.quantity) || line.quantity <= 0 || Number.isNaN(line.unitCost) || line.unitCost < 0)) return setError('Revisá cantidades y costos de cada renglón.');
    const body: CreatePurchaseReceiptRequest = {
      branchId: effectiveBranch,
      supplierPersonId: supplier.id,
      purchaseOrderId: order?.id,
      updateSellingPrices: updatePrices,
      dueDate: dueDate || undefined,
      sourceDocumentType: docNumber.trim() ? docType : undefined,
      sourceDocumentNumber: docNumber.trim() || undefined,
      lines: parsed.map((line) => ({ ...line, quantity: Math.round(line.quantity * 1000) / 1000, unitCost: Math.round(line.unitCost * 100) / 100 })),
    };
    const signature = JSON.stringify(body);
    if (!key.current || key.current.signature !== signature) key.current = { signature, key: newIdempotencyKey() };
    setBusy(true);
    setError(null);
    try {
      await receiptsApi.create(body, key.current.key);
      key.current = null;
      toast.success('Mercadería ingresada', updatePrices ? 'Stock, costos y precios actualizados' : 'Stock y costos actualizados');
      router.push(order ? `/compras/pedidos/${order.id}` : '/compras/recepciones');
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        eyebrow="Compras"
        title={order ? `Recibir pedido #${order.number}` : 'Registrar ingreso de mercadería'}
        actions={
          <>
            <Link href={order ? `/compras/pedidos/${order.id}` : '/compras/recepciones'} className="btn btn-sm btn-light">Cancelar</Link>
            <button type="button" className="btn btn-sm btn-success" onClick={() => void submit()} disabled={busy}>
              {busy && <span className="spinner-border spinner-border-sm me-2" aria-hidden="true" />}
              Confirmar ingreso
            </button>
          </>
        }
      />
      {error && <ErrorAlert message={error} />}
      <div className="row g-3">
        <div className="col-xl-4">
          <Surface title="Comprobante del proveedor">
            <div className="d-flex flex-column gap-3">
              <Field label="Proveedor" required>
                <PersonPicker role="suppliers" value={supplier} onChange={setSupplier} allowClear={!order} placeholder="Buscar proveedor…" />
              </Field>
              <Field label="Sucursal que recibe">
                <select className="form-select" value={effectiveBranch} disabled={branchLocked || Boolean(order)} onChange={(event) => setBranchId(event.target.value)}>
                  {branches.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
                </select>
              </Field>
              <div className="row g-2">
                <Field label="Tipo" className="col-5">
                  <select className="form-select" value={docType} onChange={(event) => setDocType(event.target.value)}>
                    {DOCUMENT_TYPES.map((type) => <option key={type}>{type}</option>)}
                  </select>
                </Field>
                <Field label="Número" className="col-7">
                  <input className="form-control mono" value={docNumber} maxLength={40} placeholder="00003-00012345" onChange={(event) => setDocNumber(event.target.value)} />
                </Field>
              </div>
              <Field label="Vencimiento del pago" hint="Para la cuenta corriente con el proveedor.">
                <input type="date" className="form-control" value={dueDate} onChange={(event) => setDueDate(event.target.value)} />
              </Field>
              <div className="form-check form-switch">
                <input id="upd" type="checkbox" className="form-check-input" checked={updatePrices} onChange={(event) => setUpdatePrices(event.target.checked)} />
                <label htmlFor="upd" className="form-check-label small">Si el costo cambió, recalcular el precio de venta manteniendo el margen</label>
              </div>
            </div>
          </Surface>
        </div>
        <div className="col-xl-8">
          <Surface title="Mercadería recibida" subtitle={order ? 'Se precargó lo pendiente del pedido. Ajustá lo que realmente llegó.' : undefined}>
            <PurchaseLinesEditor branchId={effectiveBranch} lines={lines} onChange={setLines} allowAdd={!order} />
          </Surface>
        </div>
      </div>
    </>
  );
}
