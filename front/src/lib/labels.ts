import type { Tone } from '@/components/ui/StatusBadge';
import type {
  FiscalDocumentStatus,
  InventoryMovementType,
  PayableStatus,
  PurchaseOrderStatus,
  RefundMethod,
  SaleFiscalStatus,
  SaleReturnStatus,
  StockTransferStatus,
} from './api/types';

export interface StatusLabel {
  label: string;
  tone: Tone;
}

export const FISCAL_STATUS: Record<SaleFiscalStatus, StatusLabel> = {
  NOT_ISSUED: { label: 'Sin facturar', tone: 'slate' },
  PENDING: { label: 'Pendiente ARCA', tone: 'amber' },
  AUTHORIZED: { label: 'Facturada', tone: 'green' },
  REJECTED: { label: 'Rechazada', tone: 'red' },
  FAILED: { label: 'Error ARCA', tone: 'red' },
};

export const RETURN_STATUS: Record<SaleReturnStatus, StatusLabel | null> = {
  NONE: null,
  PARTIAL: { label: 'Devolución parcial', tone: 'amber' },
  FULL: { label: 'Devuelta', tone: 'red' },
};

export const DOCUMENT_STATUS: Record<FiscalDocumentStatus, StatusLabel> = {
  PENDING: { label: 'Pendiente', tone: 'amber' },
  AUTHORIZED: { label: 'Autorizado', tone: 'green' },
  REJECTED: { label: 'Rechazado', tone: 'red' },
  ERROR: { label: 'Error', tone: 'red' },
};

export const TRANSFER_STATUS: Record<StockTransferStatus, StatusLabel> = {
  SENT: { label: 'En tránsito', tone: 'amber' },
  RECEIVED: { label: 'Recibida', tone: 'green' },
  CANCELLED: { label: 'Anulada', tone: 'slate' },
};

export const ORDER_STATUS: Record<PurchaseOrderStatus, StatusLabel> = {
  DRAFT: { label: 'Borrador', tone: 'slate' },
  SENT: { label: 'Enviado', tone: 'blue' },
  PARTIALLY_RECEIVED: { label: 'Recibido parcial', tone: 'amber' },
  RECEIVED: { label: 'Recibido', tone: 'green' },
  CANCELLED: { label: 'Cancelado', tone: 'red' },
};

export const PAYABLE_STATUS: Record<PayableStatus, StatusLabel> = {
  OPEN: { label: 'Impaga', tone: 'red' },
  PARTIAL: { label: 'Pago parcial', tone: 'amber' },
  PAID: { label: 'Pagada', tone: 'green' },
};

export const REFUND_METHOD_LABEL: Record<RefundMethod, string> = {
  CASH: 'Efectivo de caja',
  ORIGINAL_METHOD: 'Mismo medio de pago',
  STORE_CREDIT: 'Saldo a favor (vale)',
};

export const MOVEMENT_LABEL: Record<InventoryMovementType, string> = {
  OPENING: 'Stock inicial',
  ADJUSTMENT: 'Ajuste',
  PURCHASE: 'Compra',
  SALE: 'Venta',
  RETURN: 'Devolución',
  TRANSFER_IN: 'Transferencia recibida',
  TRANSFER_OUT: 'Transferencia enviada',
};
