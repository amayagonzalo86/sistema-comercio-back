import { api, apiRequest, type QueryValue } from './client';
import type {
  AuditEvent,
  Branch,
  BranchPriceView,
  BulkPriceResult,
  BulkPriceUpdateRequest,
  CashMovement,
  CashRegister,
  CashSession,
  CreateBranchRequest,
  CreateEmployeeRequest,
  CreateProductRequest,
  CreatePromotionRequest,
  CreatePurchaseOrderRequest,
  CreatePurchaseReceiptRequest,
  CreateSaleRequest,
  CreateSalesOrderRequest,
  CreateSalesQuoteRequest,
  CreateSaleReturnRequest,
  CreateStockTransferRequest,
  CreateSupplierPaymentRequest,
  CursorPage,
  CustomerSummaryReport,
  DashboardReport,
  DeadStockReport,
  EditProductRequest,
  Employee,
  EmployeeListQuery,
  FiscalDocument,
  FiscalDocumentStatus,
  FiscalPointOfSale,
  FiscalProfile,
  FiscalStatus,
  InactiveCustomersReport,
  InventoryMovement,
  LocalDate,
  LoginRequest,
  LoginResponse,
  LowStockRow,
  PageQuery,
  Paginated,
  Person,
  PersonListQuery,
  PersonRequest,
  PlatformTenantVat,
  PriceHistoryEntry,
  Letterhead,
  PrintableFiscalDocument,
  Product,
  ProductFacets,
  ProductListItem,
  ProductListQuery,
  Promotion,
  PurchaseOrder,
  PurchaseOrderFromReplenishmentRequest,
  PurchaseOrderStatus,
  PurchaseReceipt,
  QuoteSaleRequest,
  ReceiveStockTransferRequest,
  ReceiverCondition,
  ReplenishmentPlan,
  ReportQuery,
  Sale,
  SaleDetail,
  SaleListQuery,
  SalesOrder,
  SalesOrderDetail,
  SalesOrderListQuery,
  SalesQuote,
  SaleQuote,
  SaleReturn,
  SalesByCategoryReport,
  SalesByDayReport,
  SalesByHourReport,
  SalesByPaymentMethodReport,
  SalesBySellerReport,
  StockMatrix,
  StockTransfer,
  StockTransferStatus,
  StockValuationReport,
  SupplierPayable,
  TopCustomersReport,
  TopProductsReport,
  UpdateProductVatRequest,
  UpdatePromotionRequest,
  UpsertBranchPriceRequest,
  UpsertFiscalProfileRequest,
  UpdateEmployeeRequest,
  UserTenant,
  VatRegime,
  VatRegimeInfo,
  Uuid,
} from './types';

type Query = Record<string, QueryValue>;
const q = <T extends object>(value: T | undefined): Query | undefined => value as Query | undefined;
const id = (value: string) => encodeURIComponent(value);

export const authApi = {
  login: (body: LoginRequest) => api.post<LoginResponse>('/auth/login', body),
  logout: () => api.post<{ message: string }>('/auth/logout'),
  tenants: () => api.get<UserTenant[]>('/auth/tenants'),
  changePassword: (currentPassword: string, newPassword: string) =>
    api.post<{ message: string }>('/auth/change-password', { currentPassword, newPassword }),
};

export const employeesApi = {
  list: (query: EmployeeListQuery) => api.get<Paginated<Employee>>('/employees', q(query)),
  get: (userId: Uuid) => api.get<Employee>(`/employees/${id(userId)}`),
  create: (body: CreateEmployeeRequest) => api.post<Employee>('/employees', body),
  update: (userId: Uuid, body: UpdateEmployeeRequest) => api.patch<Employee>(`/employees/${id(userId)}`, body),
  resetPassword: (userId: Uuid, newPassword: string) => api.post<{ message: string }>(`/employees/${id(userId)}/password`, { newPassword }),
  deactivate: (userId: Uuid) => api.post<Employee>(`/employees/${id(userId)}/deactivate`),
  activate: (userId: Uuid) => api.post<Employee>(`/employees/${id(userId)}/activate`),
};

export const branchesApi = {
  list: () => api.get<Branch[]>('/branches'),
  create: (body: CreateBranchRequest) => api.post<Branch>('/branches', body),
  update: (branchId: Uuid, body: Partial<CreateBranchRequest> & { status?: boolean }) => api.patch<Branch>(`/branches/${id(branchId)}`, body),
};

export const auditApi = {
  list: (query: { limit?: number; cursor?: string; eventType?: string; aggregateType?: string; from?: string; to?: string }) =>
    api.get<CursorPage<AuditEvent>>('/audit-events', q(query)),
};

export const productsApi = {
  list: (query: ProductListQuery, signal?: AbortSignal) => api.get<Paginated<ProductListItem>>('/products', q(query), signal),
  facets: () => api.get<ProductFacets>('/products/facets'),
  get: (productId: Uuid) => api.get<Product>(`/products/${id(productId)}`),
  create: (body: CreateProductRequest) => api.post<Product>('/products', body),
  edit: (productId: Uuid, body: EditProductRequest) => api.patch<Product>(`/products/${id(productId)}`, body),
  setStatus: (productId: Uuid, status: boolean, reason: string) => api.patch<Product>(`/products/${id(productId)}/status`, { status, reason }),
  upsertBranch: (productId: Uuid, branchId: Uuid, body: UpsertBranchPriceRequest) =>
    api.put<BranchPriceView>(`/products/${id(productId)}/branches/${id(branchId)}`, body),
  updateVat: (productId: Uuid, body: UpdateProductVatRequest) => api.patch<Product>(`/products/${id(productId)}/vat`, body),
  bulkPrices: (body: BulkPriceUpdateRequest) => api.post<BulkPriceResult>('/products/price-updates', body),
  priceHistory: (productId: Uuid, query: PageQuery & { branchId?: Uuid }) =>
    api.get<Paginated<PriceHistoryEntry>>(`/products/${id(productId)}/price-history`, q(query)),
  adjustStock: (productId: Uuid, branchId: Uuid, quantityDelta: number, reason: string, idempotencyKey: string) =>
    api.post<InventoryMovement>(`/products/${id(productId)}/branches/${id(branchId)}/stock-adjustments`, { quantityDelta, reason }, idempotencyKey),
  movements: (productId: Uuid, branchId: Uuid, query: { limit?: number; cursor?: string }) =>
    api.get<CursorPage<InventoryMovement>>(`/products/${id(productId)}/branches/${id(branchId)}/stock-movements`, q(query)),
};

export const inventoryApi = {
  matrix: (query: PageQuery & { search?: string; category?: string }, signal?: AbortSignal) =>
    api.get<StockMatrix>('/inventory/stock-matrix', q(query), signal),
  lowStock: (query: PageQuery & { branchId?: Uuid }) => api.get<Paginated<LowStockRow>>('/inventory/low-stock', q(query)),
  replenishment: (query: { targetPercent?: number; category?: string }) => api.get<ReplenishmentPlan>('/inventory/replenishment', q(query)),
};

export const transfersApi = {
  list: (query: PageQuery & { status?: StockTransferStatus; branchId?: Uuid }) => api.get<Paginated<StockTransfer>>('/stock-transfers', q(query)),
  get: (transferId: Uuid) => api.get<StockTransfer>(`/stock-transfers/${id(transferId)}`),
  create: (body: CreateStockTransferRequest, idempotencyKey: string) => api.post<StockTransfer>('/stock-transfers', body, idempotencyKey),
  receive: (transferId: Uuid, body: ReceiveStockTransferRequest) => api.post<StockTransfer>(`/stock-transfers/${id(transferId)}/receive`, body),
  cancel: (transferId: Uuid, reason: string) => api.post<StockTransfer>(`/stock-transfers/${id(transferId)}/cancel`, { reason }),
};

export const personsApi = {
  list: (query: PersonListQuery, signal?: AbortSignal) => api.get<Paginated<Person>>('/persons', q(query), signal),
  get: (personId: Uuid) => api.get<Person>(`/persons/${id(personId)}`),
  create: (body: PersonRequest) => api.post<Person>('/persons', body),
  update: (personId: Uuid, body: Partial<PersonRequest>) => api.patch<Person>(`/persons/${id(personId)}`, body),
  activate: (personId: Uuid) => api.patch<Person>(`/persons/${id(personId)}/activate`),
  deactivate: (personId: Uuid) => api.patch<Person>(`/persons/${id(personId)}/deactivate`),
};

export const purchaseOrdersApi = {
  list: (query: PageQuery & { status?: PurchaseOrderStatus; supplierPersonId?: Uuid; branchId?: Uuid }) =>
    api.get<Paginated<PurchaseOrder>>('/purchase-orders', q(query)),
  get: (orderId: Uuid) => api.get<PurchaseOrder>(`/purchase-orders/${id(orderId)}`),
  create: (body: CreatePurchaseOrderRequest) => api.post<PurchaseOrder>('/purchase-orders', body),
  fromReplenishment: (body: PurchaseOrderFromReplenishmentRequest) => api.post<PurchaseOrder>('/purchase-orders/from-replenishment', body),
  update: (orderId: Uuid, body: Partial<Pick<CreatePurchaseOrderRequest, 'notes' | 'lines'>> & { expectedDate?: LocalDate | null }) =>
    api.patch<PurchaseOrder>(`/purchase-orders/${id(orderId)}`, body),
  send: (orderId: Uuid) => api.post<PurchaseOrder>(`/purchase-orders/${id(orderId)}/send`),
  cancel: (orderId: Uuid, reason: string) => api.post<PurchaseOrder>(`/purchase-orders/${id(orderId)}/cancel`, { reason }),
};

export const receiptsApi = {
  list: (query: PageQuery & { branchId?: Uuid; supplierPersonId?: Uuid; purchaseOrderId?: Uuid; from?: LocalDate; to?: LocalDate }) =>
    api.get<Paginated<PurchaseReceipt>>('/purchases/receipts', q(query)),
  get: (receiptId: Uuid) => api.get<PurchaseReceipt>(`/purchases/receipts/${id(receiptId)}`),
  create: (body: CreatePurchaseReceiptRequest, idempotencyKey: string) => api.post<PurchaseReceipt>('/purchases/receipts', body, idempotencyKey),
};

export const payablesApi = {
  list: (query: { supplierPersonId?: Uuid; branchId?: Uuid; dueBefore?: LocalDate; limit?: number; cursor?: string }) =>
    api.get<CursorPage<SupplierPayable>>('/supplier-payables', q(query)),
  pay: (body: CreateSupplierPaymentRequest, idempotencyKey: string) => api.post<Record<string, unknown>>('/supplier-payments', body, idempotencyKey),
};

export const platformApi = {
  tenants: () => api.get<PlatformTenantVat[]>('/platform/tenants'),
  setTenantVatRegime: (tenantId: Uuid, defaultVatRegime: VatRegime) =>
    api.patch<PlatformTenantVat>(`/platform/tenants/${id(tenantId)}/vat-regime`, { defaultVatRegime }),
  setBranchVatRegime: (tenantId: Uuid, branchId: Uuid, vatRegime: VatRegime | null) =>
    api.patch<PlatformTenantVat>(`/platform/tenants/${id(tenantId)}/branches/${id(branchId)}/vat-regime`, { vatRegime }),
};

export const salesApi = {
  vatRegime: (branchId: Uuid) => api.get<VatRegimeInfo>('/sales/vat-regime', { branchId }),
  quote: (body: QuoteSaleRequest, signal?: AbortSignal) => apiRequest<SaleQuote>('/sales/quote', { method: 'POST', body, signal }),
  create: (body: CreateSaleRequest, idempotencyKey: string) => api.post<SaleDetail>('/sales', body, idempotencyKey),
  list: (query: SaleListQuery) => api.get<Paginated<Sale>>('/sales', q(query)),
  get: (saleId: Uuid) => api.get<SaleDetail>(`/sales/${id(saleId)}`),
  returns: (saleId: Uuid) => api.get<SaleReturn[]>(`/sales/${id(saleId)}/returns`),
  createReturn: (saleId: Uuid, body: CreateSaleReturnRequest, idempotencyKey: string) =>
    api.post<SaleReturn>(`/sales/${id(saleId)}/returns`, body, idempotencyKey),
};

export const salesQuotesApi = {
  create: (body: CreateSalesQuoteRequest, idempotencyKey: string) => api.post<SalesQuote>('/sales-quotes', body, idempotencyKey),
  list: (query: PageQuery & { branchId?: Uuid }) => api.get<Paginated<SalesQuote>>('/sales-quotes', q(query)),
  get: (quoteId: Uuid) => api.get<SalesQuote>(`/sales-quotes/${id(quoteId)}`),
  byNumber: (number: number) => {
    if (!Number.isInteger(number) || number < 1) throw new Error('Número de presupuesto inválido.');
    return api.get<SalesQuote>(`/sales-quotes/by-number/${number}`);
  },
  convert: (quoteId: Uuid) => api.post<SalesOrderDetail>(`/sales-quotes/${id(quoteId)}/convert`),
  remove: (quoteId: Uuid) => api.delete<{ message: string }>(`/sales-quotes/${id(quoteId)}`),
};

export const salesOrdersApi = {
  create: (body: CreateSalesOrderRequest, idempotencyKey: string) =>
    api.post<SalesOrderDetail>('/sales-orders', body, idempotencyKey),
  list: (query: SalesOrderListQuery) => api.get<Paginated<SalesOrder>>('/sales-orders', q(query)),
  get: (orderId: Uuid) => api.get<SalesOrderDetail>(`/sales-orders/${id(orderId)}`),
  byNumber: (number: number) => {
    if (!Number.isInteger(number) || number < 1) throw new Error('Número de pedido inválido.');
    return api.get<SalesOrderDetail>(`/sales-orders/by-number/${number}`);
  },
  cancel: (orderId: Uuid, reason: string) => api.post<SalesOrderDetail>(`/sales-orders/${id(orderId)}/cancel`, { reason }),
};

export const cashApi = {
  registers: (branchId?: Uuid) => api.get<CashRegister[]>('/cash/registers', { branchId }),
  createRegister: (body: { branchId: Uuid; code: string; name: string }) => api.post<CashRegister>('/cash/registers', body),
  openSession: (registerId: Uuid, openingAmount: string, idempotencyKey: string) =>
    api.post<CashSession>(`/cash/registers/${id(registerId)}/sessions`, { currency: 'ARS', openingAmount }, idempotencyKey),
  session: (sessionId: Uuid) => api.get<CashSession>(`/cash/sessions/${id(sessionId)}`),
  movements: (sessionId: Uuid, query: { limit?: number; cursor?: string }) =>
    api.get<CursorPage<CashMovement>>(`/cash/sessions/${id(sessionId)}/movements`, q(query)),
  addMovement: (
    sessionId: Uuid,
    body: { type: 'INCOME' | 'EXPENSE' | 'ADJUSTMENT'; direction: 'IN' | 'OUT'; amount: string; reason: string; externalReference?: string },
    idempotencyKey: string,
  ) => api.post<{ movement: CashMovement; expectedAmount: string }>(`/cash/sessions/${id(sessionId)}/movements`, body, idempotencyKey),
  close: (sessionId: Uuid, countedAmount: string, idempotencyKey: string) =>
    api.post<CashSession>(`/cash/sessions/${id(sessionId)}/close`, { countedAmount }, idempotencyKey),
};

export const fiscalApi = {
  profile: () => api.get<FiscalProfile | null>('/fiscal/profile'),
  saveProfile: (body: UpsertFiscalProfileRequest) => api.put<FiscalProfile>('/fiscal/profile', body),
  pointsOfSale: () => api.get<FiscalPointOfSale[]>('/fiscal/points-of-sale'),
  createPointOfSale: (branchId: Uuid, number: number) => api.post<FiscalPointOfSale>('/fiscal/points-of-sale', { branchId, number }),
  status: () => api.get<FiscalStatus>('/fiscal/status'),
  receiverConditions: () => api.get<ReceiverCondition[]>('/fiscal/receiver-conditions'),
  invoiceSale: (saleId: Uuid) => api.post<FiscalDocument>(`/fiscal/sales/${id(saleId)}/invoice`),
  creditNote: (returnId: Uuid) => api.post<FiscalDocument>(`/fiscal/returns/${id(returnId)}/credit-note`),
  documents: (query: PageQuery & { status?: FiscalDocumentStatus; from?: LocalDate; to?: LocalDate; branchId?: Uuid }) =>
    api.get<Paginated<FiscalDocument>>('/fiscal/documents', q(query)),
  document: (documentId: Uuid) => api.get<PrintableFiscalDocument>(`/fiscal/documents/${id(documentId)}`),
  /** Encabezado de la empresa para presupuestos y remitos X (el de la sucursal indicada). */
  letterhead: (branchId?: Uuid | null) => api.get<Letterhead>('/fiscal/letterhead', branchId ? { branchId } : undefined),
};

export const reportsApi = {
  dashboard: (query: ReportQuery) => api.get<DashboardReport>('/reports/dashboard', q(query)),
  salesByDay: (query: ReportQuery) => api.get<SalesByDayReport>('/reports/sales-by-day', q(query)),
  salesByHour: (query: ReportQuery) => api.get<SalesByHourReport>('/reports/sales-by-hour', q(query)),
  topProducts: (query: ReportQuery & { sort?: 'revenue' | 'quantity' | 'margin'; order?: 'asc' | 'desc'; limit?: number }) =>
    api.get<TopProductsReport>('/reports/top-products', q(query)),
  salesByCategory: (query: ReportQuery) => api.get<SalesByCategoryReport>('/reports/sales-by-category', q(query)),
  salesByPaymentMethod: (query: ReportQuery) => api.get<SalesByPaymentMethodReport>('/reports/sales-by-payment-method', q(query)),
  salesBySeller: (query: ReportQuery) => api.get<SalesBySellerReport>('/reports/sales-by-seller', q(query)),
  stockValuation: (query: ReportQuery) => api.get<StockValuationReport>('/reports/stock-valuation', q(query)),
  deadStock: (query: PageQuery & { branchId?: Uuid; days?: number }) => api.get<DeadStockReport>('/reports/dead-stock', q(query)),
};

export const marketingApi = {
  promotions: (query: PageQuery & { current?: boolean }) => api.get<Paginated<Promotion>>('/marketing/promotions', q(query)),
  createPromotion: (body: CreatePromotionRequest) => api.post<Promotion>('/marketing/promotions', body),
  updatePromotion: (promotionId: Uuid, body: UpdatePromotionRequest) => api.patch<Promotion>(`/marketing/promotions/${id(promotionId)}`, body),
  topCustomers: (query: ReportQuery & { limit?: number }) => api.get<TopCustomersReport>('/marketing/customers/top', q(query)),
  inactiveCustomers: (query: PageQuery & { days?: number; onlyWithConsent?: boolean }) =>
    api.get<InactiveCustomersReport>('/marketing/customers/inactive', q(query)),
  summary: (query: ReportQuery) => api.get<CustomerSummaryReport>('/marketing/customers/summary', q(query)),
  contactsCsv: () => apiRequest<string>('/marketing/customers/contacts.csv', { responseType: 'text' }),
};
