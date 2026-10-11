/**
 * Contratos de la API (espejo de los DTO y respuestas del backend NestJS).
 * Importes: los módulos de ventas, compras y caja devuelven decimales como texto ("3267.00");
 * los reportes y el catálogo devuelven números. Fechas de filtros: AAAA-MM-DD en hora de Argentina.
 */

export type Uuid = string;
/** Decimal serializado como texto, p. ej. "1234.50". */
export type DecimalString = string;
/** Fecha/hora ISO 8601 devuelta por la API. */
export type IsoDateTime = string;
/** Fecha local AAAA-MM-DD. */
export type LocalDate = string;

export interface Paginated<T> {
  items: T[];
  total: number;
  page: number;
  limit: number;
  pages: number;
}

export interface PageQuery {
  page?: number;
  limit?: number;
}

export interface ApiErrorBody {
  statusCode: number;
  timestamp?: string;
  path?: string;
  requestId?: string | null;
  message: string | string[];
  details?: unknown;
}

// ── Sesión ─────────────────────────────────────────────────────

export type TenantRole = 'OWNER' | 'ADMIN' | 'MANAGER' | 'ACCOUNTANT' | 'CASHIER' | 'INVENTORY' | 'SELLER' | 'VIEWER';

export interface LoginRequest {
  username: string;
  password: string;
  tenantId?: Uuid;
}

export interface LoginResponse {
  user: {
    id: Uuid;
    username: string;
    isActive?: boolean;
    branchId?: Uuid | null;
    branch?: Branch | null;
    person?: { firstName: string; lastName: string; email?: string | null } | null;
  };
  tokens: { accessToken: string };
}

export interface RefreshResponse {
  accessToken: string;
}

/** Claims del access token (JWT HS256 firmado por el backend). */
export interface AccessTokenClaims {
  sub: Uuid;
  username?: string;
  roles?: string[];
  tenantId?: Uuid;
  tenantRole?: TenantRole;
  exp?: number;
  iat?: number;
}

export interface UserTenant {
  id: Uuid;
  slug: string;
  legalName: string;
  tradeName: string | null;
  role: TenantRole;
}

// ── Organización ───────────────────────────────────────────────

export interface Branch {
  id: Uuid;
  tenantId?: Uuid;
  code: string;
  name: string;
  address?: string | null;
  phone?: string | null;
  status: boolean;
  allowedIpRanges?: string[] | null;
}

export interface CreateBranchRequest {
  code: string;
  name: string;
  address?: string;
  phone?: string;
  allowedIpRanges?: string[];
}

export interface AuditEvent {
  id: string;
  actorUserId?: Uuid | null;
  eventType: string;
  aggregateType: string;
  aggregateId: string;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
  createdAt: IsoDateTime;
}

// ── IVA y fiscal ───────────────────────────────────────────────

export type VatTreatment = 'TAXED' | 'EXEMPT' | 'NOT_TAXED';
export type VatExemptionReason = 'EXPORT' | 'TIERRA_DEL_FUEGO' | 'DIPLOMATIC' | 'OTHER_LEGAL';
export type VoucherClass = 'A' | 'B' | 'C' | 'E';
export type TaxCondition =
  | 'RESPONSABLE_INSCRIPTO'
  | 'MONOTRIBUTO'
  | 'EXENTO'
  | 'CONSUMIDOR_FINAL'
  | 'NO_RESPONSABLE'
  | 'SUJETO_NO_CATEGORIZADO'
  | 'CLIENTE_DEL_EXTERIOR';
export type IssuerVatCondition = 'RESPONSABLE_INSCRIPTO' | 'MONOTRIBUTO' | 'EXENTO';
export type ArcaEnvironment = 'HOMOLOGATION' | 'PRODUCTION';
export const VAT_RATES = [0, 2.5, 5, 10.5, 21, 27] as const;
export type VatRate = (typeof VAT_RATES)[number];

export interface FiscalProfile {
  id: Uuid;
  taxId: string;
  legalName: string;
  vatConditionCode: IssuerVatCondition;
  grossIncomeRegistration?: string | null;
  environment: ArcaEnvironment;
  certificateSecretRef?: string | null;
  privateKeySecretRef?: string | null;
  isActive: boolean;
  activityStartDate?: LocalDate | null;
  commercialAddress?: string | null;
  updatedAt: IsoDateTime;
}

export interface UpsertFiscalProfileRequest {
  taxId: string;
  legalName: string;
  vatConditionCode: IssuerVatCondition;
  grossIncomeRegistration?: string;
  environment: ArcaEnvironment;
  certificateSecretRef?: string;
  privateKeySecretRef?: string;
  activityStartDate?: LocalDate;
  commercialAddress?: string;
}

export interface FiscalPointOfSale {
  id: Uuid;
  branchId: Uuid;
  number: number;
  environment: ArcaEnvironment;
  isActive: boolean;
  createdAt: IsoDateTime;
}

export interface FiscalStatus {
  environment: ArcaEnvironment;
  cuit: string;
  servers: { app: string | null; db: string | null; auth: string | null } | null;
  credentials: string;
}

export type FiscalDocumentStatus = 'PENDING' | 'AUTHORIZED' | 'REJECTED' | 'ERROR';
export type FiscalSourceType = 'SALE' | 'SALE_RETURN';

export interface FiscalDocument {
  id: Uuid;
  branchId: Uuid;
  sourceType: FiscalSourceType;
  sourceId: Uuid;
  environment: ArcaEnvironment;
  voucherClass: VoucherClass;
  voucherType: number;
  pointOfSale: number;
  number?: number | null;
  status: FiscalDocumentStatus;
  cae?: string | null;
  caeExpiration?: LocalDate | null;
  issueDate: LocalDate;
  docType: number;
  docNumber: string;
  receiverConditionId: number;
  total: DecimalString;
  netTaxed: DecimalString;
  vatTotal: DecimalString;
  exempt: DecimalString;
  notTaxed: DecimalString;
  vatRates: Array<{ arcaId: number; base: DecimalString; amount: DecimalString }>;
  associatedDocumentId?: Uuid | null;
  observations?: Array<{ code: string; message: string }> | null;
  errorMessage?: string | null;
  attempts: number;
  authorizedAt?: IsoDateTime | null;
  createdAt: IsoDateTime;
}

export interface FiscalDocumentItem {
  id: Uuid;
  productId: Uuid;
  skuSnapshot?: string;
  nameSnapshot?: string;
  quantity: DecimalString;
  unitPrice?: DecimalString;
  taxRate?: DecimalString;
  netAmount: DecimalString;
  taxAmount: DecimalString;
  exemptAmount: DecimalString;
  notTaxedAmount: DecimalString;
  total: DecimalString;
  discountAmount?: DecimalString;
  promotionName?: string | null;
}

export interface PrintableFiscalDocument {
  document: FiscalDocument;
  issuer: {
    legalName: string;
    cuit: string;
    vatCondition: string;
    grossIncomeRegistration: string | null;
    activityStartDate: LocalDate | null;
    commercialAddress: string | null;
  } | null;
  /** Cliente identificado (null = consumidor final sin identificar). */
  receiver?: { name: string; address: string | null } | null;
  associated: { voucherType: number; pointOfSale: number; number: number | null; issueDate: LocalDate } | null;
  items: FiscalDocumentItem[];
  formattedNumber: string | null;
  qrUrl: string | null;
}

export interface ReceiverCondition {
  id: number;
  description: string;
}

// ── Catálogo ───────────────────────────────────────────────────

export type UnitOfMeasure = 'UNIT' | 'KG' | 'LITER' | 'METER' | 'PACK';

export interface BranchPriceView {
  branchId: Uuid;
  stock: number;
  minStock: number;
  costPrice: number;
  sellingPrice: number;
  profitMargin: number;
  isActive: boolean;
  belowMinimum: boolean;
}

export interface ProductListItem {
  id: Uuid;
  sku: string;
  barcode: string | null;
  name: string;
  category: string | null;
  brand: string | null;
  unitOfMeasure: UnitOfMeasure;
  taxRate: number;
  vatTreatment: VatTreatment;
  priceIncludesVat: boolean;
  status: boolean;
  branch?: BranchPriceView;
  totalStock?: number;
}

export type ProductSort = 'name' | 'sku' | 'updated' | 'stock';

export interface ProductListQuery extends PageQuery {
  search?: string;
  category?: string;
  brand?: string;
  branchId?: Uuid;
  status?: 'active' | 'inactive' | 'all';
  lowStock?: boolean;
  sort?: ProductSort;
}

export interface ProductFacets {
  categories: Array<{ name: string; count: number }>;
  brands: Array<{ name: string; count: number }>;
}

export interface ProductBranchSetting {
  id: Uuid;
  branchId: Uuid;
  branch?: Branch;
  costPrice: number;
  profitMargin: number;
  sellingPrice: number;
  stock: number;
  minStock: number;
  isActive: boolean;
}

export interface Product {
  id: Uuid;
  sku: string;
  barcode?: string | null;
  name: string;
  description?: string | null;
  category?: string | null;
  brand?: string | null;
  unitOfMeasure: UnitOfMeasure;
  taxRate: number;
  vatTreatment: VatTreatment;
  priceIncludesVat: boolean;
  status: boolean;
  branchSettings?: ProductBranchSetting[];
  createdAt: IsoDateTime;
  updatedAt: IsoDateTime;
}

export interface CreateProductRequest {
  sku: string;
  barcode?: string;
  name: string;
  description?: string;
  category?: string;
  brand?: string;
  unitOfMeasure?: UnitOfMeasure;
  taxRate?: number;
  vatTreatment?: VatTreatment;
  priceIncludesVat?: boolean;
  branchSettings: Array<{
    branchId: Uuid;
    costPrice: number;
    profitMargin: number;
    sellingPrice: number;
    stock: number;
    minStock: number;
    isActive?: boolean;
  }>;
}

export interface EditProductRequest {
  sku?: string;
  barcode?: string | null;
  name?: string;
  description?: string | null;
  category?: string | null;
  brand?: string | null;
  unitOfMeasure?: UnitOfMeasure;
}

export interface UpsertBranchPriceRequest {
  costPrice?: number;
  sellingPrice?: number;
  profitMargin?: number;
  minStock?: number;
  isActive?: boolean;
  reason?: string;
}

export interface UpdateProductVatRequest {
  vatTreatment: VatTreatment;
  taxRate?: number;
  priceIncludesVat?: boolean;
  reason: string;
}

export type PriceTarget = 'SELLING_PRICE' | 'COST_KEEP_MARGIN' | 'COST_ONLY';
export type PriceRounding = 'NONE' | 'UNIT' | 'TEN' | 'HUNDRED';

export interface BulkPriceUpdateRequest {
  percentage: number;
  target: PriceTarget;
  rounding: PriceRounding;
  scope: { categories?: string[]; brands?: string[]; productIds?: Uuid[]; branchIds?: Uuid[] };
  reason: string;
  dryRun: boolean;
}

export interface BulkPriceResult {
  dryRun: boolean;
  batchId: string | null;
  affectedRows: number;
  unchangedRows: number;
  preview: Array<{
    productId: Uuid;
    sku: string;
    name: string;
    branchId: Uuid;
    oldCostPrice: DecimalString;
    newCostPrice: DecimalString;
    oldSellingPrice: DecimalString;
    newSellingPrice: DecimalString;
    newProfitMargin: DecimalString;
  }>;
}

export interface PriceHistoryEntry {
  id: Uuid;
  productId: Uuid;
  branchId: Uuid;
  oldCostPrice: DecimalString;
  newCostPrice: DecimalString;
  oldSellingPrice: DecimalString;
  newSellingPrice: DecimalString;
  reason: string;
  batchId?: string | null;
  actorUserId: Uuid;
  createdAt: IsoDateTime;
}

export type InventoryMovementType = 'OPENING' | 'ADJUSTMENT' | 'PURCHASE' | 'SALE' | 'RETURN' | 'TRANSFER_IN' | 'TRANSFER_OUT';

export interface InventoryMovement {
  id: Uuid;
  productId: Uuid;
  branchId: Uuid;
  movementType: InventoryMovementType;
  quantityDelta: DecimalString;
  quantityBefore: DecimalString;
  quantityAfter: DecimalString;
  reason: string;
  referenceType?: string | null;
  referenceId?: string | null;
  actorUserId?: Uuid | null;
  createdAt: IsoDateTime;
}

// ── Stock entre sucursales ─────────────────────────────────────

export interface StockMatrixRow {
  productId: Uuid;
  sku: string;
  name: string;
  category: string | null;
  totalStock: DecimalString;
  branches: Record<Uuid, { stock: DecimalString; minStock: DecimalString; belowMinimum: boolean }>;
}

export type StockMatrix = Paginated<StockMatrixRow> & { branches: Array<{ id: Uuid; code: string; name: string }> };

export interface LowStockRow {
  productId: Uuid;
  sku: string;
  name: string;
  branchId: Uuid;
  stock: DecimalString;
  minStock: DecimalString;
  missing: DecimalString;
}

export interface ReplenishmentPlan {
  targetPercent: number;
  transfers: Array<{ productId: Uuid; sku: string; name: string; fromBranchId: Uuid; toBranchId: Uuid; quantity: DecimalString }>;
  purchases: Array<{ productId: Uuid; sku: string; name: string; branchId: Uuid; quantity: DecimalString }>;
}

export type StockTransferStatus = 'SENT' | 'RECEIVED' | 'CANCELLED';

export interface StockTransferItem {
  id: Uuid;
  productId: Uuid;
  skuSnapshot: string;
  nameSnapshot: string;
  quantitySent: DecimalString;
  quantityReceived?: DecimalString | null;
  unitCost: DecimalString;
}

export interface StockTransfer {
  id: Uuid;
  number: number;
  originBranchId: Uuid;
  destinationBranchId: Uuid;
  status: StockTransferStatus;
  notes?: string | null;
  sentByUserId: Uuid;
  receivedByUserId?: Uuid | null;
  receivedAt?: IsoDateTime | null;
  receiptNotes?: string | null;
  cancelledAt?: IsoDateTime | null;
  cancelReason?: string | null;
  items?: StockTransferItem[];
  createdAt: IsoDateTime;
}

export interface CreateStockTransferRequest {
  originBranchId: Uuid;
  destinationBranchId: Uuid;
  lines: Array<{ productId: Uuid; quantity: number }>;
  notes?: string;
}

export interface ReceiveStockTransferRequest {
  lines?: Array<{ productId: Uuid; quantityReceived: number }>;
  notes?: string;
}

// ── Personas (clientes y proveedores) ──────────────────────────

export type PersonType = 'CUSTOMER' | 'SUPPLIER' | 'BOTH';
/** Códigos de documento de ARCA: 80 CUIT, 86 CUIL, 96 DNI, 94 Pasaporte, 99 Consumidor final. */
export type DocumentType = 80 | 86 | 96 | 94 | 99;

export interface Person {
  id: Uuid;
  firstName: string;
  lastName: string;
  nationalId?: string | null;
  documentType?: DocumentType | null;
  vatCondition: TaxCondition;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  personType: PersonType;
  isActive: boolean;
  marketingConsent: boolean;
  marketingConsentAt?: IsoDateTime | null;
  createdAt?: IsoDateTime;
}

export interface PersonRequest {
  personType?: PersonType;
  firstName: string;
  lastName: string;
  documentType?: DocumentType | null;
  nationalId?: string | null;
  vatCondition?: TaxCondition;
  email?: string | null;
  phone?: string | null;
  address?: string | null;
  marketingConsent?: boolean;
}

export interface PersonListQuery extends PageQuery {
  search?: string;
  role?: 'customers' | 'suppliers' | 'all';
  status?: 'active' | 'inactive' | 'all';
}

// ── Compras ────────────────────────────────────────────────────

export type PurchaseOrderStatus = 'DRAFT' | 'SENT' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED';

export interface PurchaseOrderItem {
  id: Uuid;
  productId: Uuid;
  skuSnapshot: string;
  nameSnapshot: string;
  quantityOrdered: DecimalString;
  quantityReceived: DecimalString;
  unitCost: DecimalString;
  taxRate: DecimalString;
}

export interface PurchaseOrder {
  id: Uuid;
  number: number;
  supplierPersonId: Uuid;
  branchId: Uuid;
  status: PurchaseOrderStatus;
  expectedDate?: LocalDate | null;
  notes?: string | null;
  currency: string;
  estimatedTotal: DecimalString;
  createdByUserId: Uuid;
  sentAt?: IsoDateTime | null;
  closedAt?: IsoDateTime | null;
  cancelReason?: string | null;
  items?: PurchaseOrderItem[];
  createdAt: IsoDateTime;
}

export interface PurchaseOrderLine {
  productId: Uuid;
  quantity: number;
  unitCost?: number;
  taxRate?: number;
}

export interface CreatePurchaseOrderRequest {
  supplierPersonId: Uuid;
  branchId: Uuid;
  expectedDate?: LocalDate;
  notes?: string;
  lines: PurchaseOrderLine[];
}

export interface PurchaseOrderFromReplenishmentRequest {
  supplierPersonId: Uuid;
  branchId: Uuid;
  productIds?: Uuid[];
  category?: string;
  brand?: string;
  targetPercent?: number;
}

export interface PurchaseReceiptItem {
  id: Uuid;
  productId: Uuid;
  skuSnapshot: string;
  nameSnapshot: string;
  quantity: DecimalString;
  unitCost: DecimalString;
  taxRate: DecimalString;
  netAmount: DecimalString;
  taxAmount: DecimalString;
  total: DecimalString;
}

export interface PurchaseReceipt {
  id: Uuid;
  branchId: Uuid;
  supplierPersonId: Uuid;
  purchaseOrderId?: Uuid | null;
  currency: string;
  sourceDocumentType?: string | null;
  sourceDocumentNumber?: string | null;
  subtotal: DecimalString;
  taxTotal: DecimalString;
  total: DecimalString;
  actorUserId: Uuid;
  items?: PurchaseReceiptItem[];
  createdAt: IsoDateTime;
}

export interface CreatePurchaseReceiptRequest {
  branchId: Uuid;
  purchaseOrderId?: Uuid;
  updateSellingPrices?: boolean;
  supplierPersonId: Uuid;
  dueDate?: LocalDate;
  sourceDocumentType?: string;
  sourceDocumentNumber?: string;
  lines: Array<{ productId: Uuid; quantity: number; unitCost: number; taxRate: number }>;
}

export type PayableStatus = 'OPEN' | 'PARTIAL' | 'PAID';

export interface SupplierPayable {
  id: Uuid;
  branchId: Uuid;
  supplierPersonId: Uuid;
  purchaseReceiptId: Uuid;
  currency: string;
  originalAmount: DecimalString;
  amountPaid: DecimalString;
  outstanding: DecimalString;
  status: PayableStatus;
  dueDate?: LocalDate | null;
  createdAt: IsoDateTime;
}

export type SupplierPaymentMethod = 'CASH' | 'BANK_TRANSFER' | 'CHECK' | 'CARD' | 'OTHER';

export interface CreateSupplierPaymentRequest {
  branchId: Uuid;
  supplierPersonId: Uuid;
  method: SupplierPaymentMethod;
  cashSessionId?: Uuid;
  externalReference?: string;
  allocations: Array<{ payableId: Uuid; amount: number }>;
}

// ── Ventas ─────────────────────────────────────────────────────

export type SalePaymentMethod = 'CASH' | 'DEBIT_CARD' | 'CREDIT_CARD' | 'BANK_TRANSFER' | 'QR' | 'OTHER';
export type SaleFiscalStatus = 'NOT_ISSUED' | 'PENDING' | 'AUTHORIZED' | 'REJECTED' | 'FAILED';
export type SaleReturnStatus = 'NONE' | 'PARTIAL' | 'FULL';

export interface SaleLineRequest {
  productId: Uuid;
  quantity: number;
}

export interface SaleVatExemption {
  reason: VatExemptionReason;
  note: string;
}

export interface QuoteSaleRequest {
  branchId: Uuid;
  customerPersonId?: Uuid;
  lines: SaleLineRequest[];
  vatExemption?: SaleVatExemption;
}

export interface CreateSaleRequest extends QuoteSaleRequest {
  payments: Array<{ method: SalePaymentMethod; amount: number; cashSessionId?: Uuid }>;
}

export interface FiscalNotes {
  fiscalTransparency?: { title: string; vatContained: DecimalString; otherNationalIndirectTaxes: DecimalString };
  legend?: string;
  vatExemption?: { reason: VatExemptionReason; note: string | null };
}

export interface QuoteLine {
  productId: Uuid;
  sku: string;
  name: string;
  quantity: DecimalString;
  unitPrice: DecimalString;
  discount: DecimalString;
  promotion: { id: Uuid; name: string } | null;
  netAmount: DecimalString;
  taxAmount: DecimalString;
  exemptAmount: DecimalString;
  notTaxedAmount: DecimalString;
  total: DecimalString;
  availableStock: DecimalString;
  stockSufficient: boolean;
}

export interface SaleQuote {
  voucherClass: VoucherClass;
  vatChargeMode: string;
  requiresCustomerCuit: boolean;
  customerCuitValid: boolean;
  lines: QuoteLine[];
  subtotal: DecimalString;
  taxTotal: DecimalString;
  discountTotal: DecimalString;
  total: DecimalString;
  vatBreakdown: Array<{ arcaVatRateId: number; rate: DecimalString; base: DecimalString; vat: DecimalString }>;
  fiscalNotes: FiscalNotes;
}

export interface SaleItem {
  id: Uuid;
  productId: Uuid;
  skuSnapshot: string;
  nameSnapshot: string;
  quantity: DecimalString;
  unitPrice: DecimalString;
  taxRate: DecimalString;
  netAmount: DecimalString;
  taxAmount: DecimalString;
  exemptAmount: DecimalString;
  notTaxedAmount: DecimalString;
  total: DecimalString;
  discountAmount: DecimalString;
  promotionName?: string | null;
}

export interface SalePayment {
  id: Uuid;
  method: SalePaymentMethod;
  amount: DecimalString;
  currency: string;
  externalReference?: string | null;
  createdAt: IsoDateTime;
}

export interface Sale {
  id: Uuid;
  branchId: Uuid;
  customerPersonId?: Uuid | null;
  currency: string;
  subtotal: DecimalString;
  taxTotal: DecimalString;
  discountTotal: DecimalString;
  exemptTotal: DecimalString;
  notTaxedTotal: DecimalString;
  voucherClass?: VoucherClass | null;
  customerVatCondition?: string | null;
  vatExemptionReason?: VatExemptionReason | null;
  total: DecimalString;
  fiscalStatus: SaleFiscalStatus;
  returnStatus: SaleReturnStatus;
  refundedTotal: DecimalString;
  actorUserId: Uuid;
  createdAt: IsoDateTime;
}

export interface SaleDetail extends Sale {
  items: SaleItem[];
  payments: SalePayment[];
  fiscalNotes: FiscalNotes;
}

export interface SaleListQuery extends PageQuery {
  branchId?: Uuid;
  from?: LocalDate;
  to?: LocalDate;
  customerPersonId?: Uuid;
  sellerUserId?: Uuid;
  paymentMethod?: SalePaymentMethod;
  voucherClass?: VoucherClass;
  returnStatus?: SaleReturnStatus;
}

export type RefundMethod = 'CASH' | 'ORIGINAL_METHOD' | 'STORE_CREDIT';

export interface CreateSaleReturnRequest {
  lines?: Array<{ saleItemId: Uuid; quantity: number }>;
  reason: string;
  restock: boolean;
  refundMethod: RefundMethod;
  cashSessionId?: Uuid;
  externalReference?: string;
}

export interface SaleReturn {
  id: Uuid;
  number: number;
  saleId: Uuid;
  branchId: Uuid;
  reason: string;
  restock: boolean;
  refundMethod: RefundMethod;
  subtotal: DecimalString;
  taxTotal: DecimalString;
  total: DecimalString;
  fiscalStatus: string;
  createdAt: IsoDateTime;
}

// ── Caja ───────────────────────────────────────────────────────

export interface CashSessionSummary {
  id: Uuid;
  currency: string;
  openingAmount: DecimalString;
  expectedAmount: DecimalString;
  openedByUserId: Uuid;
  openedAt: IsoDateTime;
}

export interface CashRegister {
  id: Uuid;
  branchId: Uuid;
  code: string;
  name: string;
  isActive: boolean;
  openSession: CashSessionSummary | null;
}

export type CashSessionStatus = 'OPEN' | 'CLOSED';

export interface CashSession {
  id: Uuid;
  branchId: Uuid;
  cashRegisterId: Uuid;
  status: CashSessionStatus;
  currency: string;
  openingAmount: DecimalString;
  expectedAmount: DecimalString;
  countedAmount?: DecimalString | null;
  differenceAmount?: DecimalString | null;
  openedByUserId: Uuid;
  closedByUserId?: Uuid | null;
  openedAt: IsoDateTime;
  closedAt?: IsoDateTime | null;
}

export type CashMovementType = 'OPENING' | 'SALE' | 'REFUND' | 'INCOME' | 'EXPENSE' | 'ADJUSTMENT';

export interface CashMovement {
  id: Uuid;
  cashSessionId: Uuid;
  type: CashMovementType;
  direction: 'IN' | 'OUT';
  amount: DecimalString;
  currency: string;
  reason: string;
  sourceType?: string | null;
  sourceId?: string | null;
  externalReference?: string | null;
  actorUserId: Uuid;
  createdAt: IsoDateTime;
}

export interface CursorPage<T> {
  items: T[];
  nextCursor: string | null;
}

// ── Reportes ───────────────────────────────────────────────────

export interface ReportQuery {
  from?: LocalDate;
  to?: LocalDate;
  branchId?: Uuid;
}

export interface PeriodTotals {
  tickets: number;
  grossSales: number;
  refunds: number;
  netSales: number;
  vat: number;
  averageTicket: number;
  revenueWithoutVat: number;
  cost: number;
  grossMargin: number;
  marginPercent: number | null;
}

export interface DashboardReport {
  period: { from: LocalDate; to: LocalDate; days: number };
  previousPeriod: { from: LocalDate; to: LocalDate };
  totals: PeriodTotals;
  previous: PeriodTotals;
  growth: { netSales: number | null; tickets: number | null; grossMargin: number | null };
  byBranch: Array<{ branchId: Uuid; code: string; name: string; tickets: number; netSales: number; grossMargin: number; marginPercent: number | null }>;
  today: { tickets: number; netSales: number };
  operations: {
    openCashSessions: number;
    cashInRegisters: number;
    payablesOutstanding: number;
    payablesOverdue: number;
    lowStockItems: number;
    transfersInTransit: number;
    purchaseOrdersPending: number;
  };
}

export interface SalesByDayReport {
  period: { from: LocalDate; to: LocalDate };
  series: Array<{ day: LocalDate; tickets: number; grossSales: number; refunds: number; netSales: number }>;
}

export interface SalesByHourReport {
  period: { from: LocalDate; to: LocalDate };
  /** weekday: 1 = domingo … 7 = sábado (DAYOFWEEK de MySQL). */
  cells: Array<{ weekday: number; hour: number; tickets: number; grossSales: number }>;
}

export interface TopProductsReport {
  period: { from: LocalDate; to: LocalDate };
  items: Array<{ productId: Uuid; sku: string; name: string; quantity: number; revenue: number; grossMargin: number; marginPercent: number | null }>;
}

export interface SalesByCategoryReport {
  period: { from: LocalDate; to: LocalDate };
  items: Array<{ category: string; quantity: number; revenue: number; grossMargin: number; marginPercent: number | null }>;
}

export interface SalesByPaymentMethodReport {
  period: { from: LocalDate; to: LocalDate };
  items: Array<{ method: SalePaymentMethod; tickets: number; amount: number; share: number }>;
}

export interface SalesBySellerReport {
  period: { from: LocalDate; to: LocalDate };
  items: Array<{ userId: Uuid; username: string | null; fullName: string | null; tickets: number; grossSales: number; refunds: number; averageTicket: number }>;
}

export interface StockValuationReport {
  items: Array<{ branchId: Uuid; code: string; name: string; products: number; units: number; costValue: number; retailValue: number }>;
  totals: { units: number; costValue: number; retailValue: number };
}

export type DeadStockReport = Paginated<{ productId: Uuid; sku: string; name: string; branchId: Uuid; stock: number; costValue: number }> & {
  days: number;
};

// ── Marketing ──────────────────────────────────────────────────

export type PromotionType = 'PERCENTAGE' | 'BUY_X_PAY_Y';

export interface Promotion {
  id: Uuid;
  name: string;
  description?: string | null;
  type: PromotionType;
  percentBasisPoints?: number | null;
  buyQuantity?: number | null;
  payQuantity?: number | null;
  productIds?: Uuid[] | null;
  categories?: string[] | null;
  brands?: string[] | null;
  branchIds?: Uuid[] | null;
  weekdays?: number[] | null;
  minQuantity?: DecimalString | null;
  startsAt?: LocalDate | null;
  endsAt?: LocalDate | null;
  isActive: boolean;
  createdAt: IsoDateTime;
}

export interface CreatePromotionRequest {
  name: string;
  description?: string;
  type: PromotionType;
  percentage?: number;
  buyQuantity?: number;
  payQuantity?: number;
  productIds?: Uuid[];
  categories?: string[];
  brands?: string[];
  branchIds?: Uuid[];
  weekdays?: number[];
  minQuantity?: number;
  startsAt?: LocalDate;
  endsAt?: LocalDate;
  isActive?: boolean;
}

export interface UpdatePromotionRequest {
  name?: string;
  description?: string | null;
  isActive?: boolean;
  startsAt?: LocalDate | null;
  endsAt?: LocalDate | null;
}

export interface CustomerInsight {
  personId: Uuid;
  name: string;
  email: string | null;
  phone: string | null;
  marketingConsent: boolean;
  purchases: number;
  spent: number;
  averageTicket?: number;
  lastPurchase: IsoDateTime | string | null;
}

export interface TopCustomersReport {
  period: { from: LocalDate; to: LocalDate };
  items: CustomerInsight[];
}

export type InactiveCustomersReport = Paginated<CustomerInsight> & { days: number };

export interface CustomerSummaryReport {
  period: { from: LocalDate; to: LocalDate };
  tickets: number;
  identifiedTickets: number;
  identifiedShare: number;
  customers: number;
  newCustomers: number;
  returningCustomers: number;
  grossSales: number;
  identifiedGrossSales: number;
}
