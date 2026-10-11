# Guía de la API para el frontend

Base: `https://api.tuempresa.com.ar/api/v1` · Autenticación: `Authorization: Bearer <accessToken>` · Errores: `{ statusCode, message, requestId }`.

Convenciones:

- **Listados paginados**: `?page=1&limit=25` (máx. 100) → `{ items, total, page, limit, pages }`.
- **Importes**: decimales como texto (`"3267.00"`) en ventas, compras y caja; los reportes devuelven números.
- **Fechas de filtros**: `AAAA-MM-DD`, en hora de Argentina, inclusive.
- **Operaciones que mueven dinero o stock** (`POST /sales`, devoluciones, transferencias, recepciones, caja): enviar
  `Idempotency-Key: <uuid>` generado por el frontend; si la red falla, reintentar con **la misma** clave no duplica la operación.
- **Alcance por sucursal**: cajeros, vendedores y depósito ven solo su sucursal; titular/administrador ven todas.

## Sesión

| Método | Ruta | Uso |
|---|---|---|
| POST | `/auth/login` | `{ username, password }` → `{ user, tokens: { accessToken } }` + cookie HttpOnly de refresco |
| POST | `/auth/refresh` | Renueva el access token (enviar con `credentials: 'include'`) |
| POST | `/auth/logout` | Cierra la sesión |
| GET | `/auth/tenants` | Empresas del usuario |

## Catálogo y precios

| Método | Ruta | Uso |
|---|---|---|
| GET | `/products?search=&category=&brand=&branchId=&status=active&lowStock=true&sort=name` | Grilla del catálogo (con `branchId` trae precio y stock de esa sucursal) |
| GET | `/products/facets` | Categorías y marcas para filtros |
| POST | `/products` | Alta con precios y stock inicial por sucursal |
| GET | `/products/:id` | Ficha con todas las sucursales |
| PATCH | `/products/:id` | Editar nombre, SKU, código de barras, categoría, marca |
| PATCH | `/products/:id/status` | Activar/desactivar `{ status, reason }` |
| PUT | `/products/:id/branches/:branchId` | Precio, costo, margen y mínimo en una sucursal |
| PATCH | `/products/:id/vat` | Asignar/quitar IVA |
| POST | `/products/price-updates` | **Aumento masivo**: `{ percentage, target, rounding, scope, reason, dryRun }`. Llamar primero con `dryRun: true` para mostrar la vista previa |
| GET | `/products/:id/price-history` | Historial de costos y precios |
| POST | `/products/:id/branches/:branchId/stock-adjustments` | Ajuste de stock con motivo |
| GET | `/products/:id/branches/:branchId/stock-movements` | Kardex |

`target`: `SELLING_PRICE` (solo precio), `COST_KEEP_MARGIN` (nueva lista del proveedor: sube costo y precio manteniendo margen), `COST_ONLY`.
`rounding`: `NONE`, `UNIT`, `TEN`, `HUNDRED` (redondeo hacia arriba).

## Stock entre sucursales

| Método | Ruta | Uso |
|---|---|---|
| GET | `/inventory/stock-matrix?search=&category=` | Matriz producto × sucursal (incluye la lista de sucursales) |
| GET | `/inventory/low-stock?branchId=` | Productos bajo el mínimo |
| GET | `/inventory/replenishment?targetPercent=200` | Plan sugerido: qué transferir y qué comprar |
| POST | `/stock-transfers` | Despachar mercadería (sale del origen) |
| POST | `/stock-transfers/:id/receive` | Recibir en destino (sin líneas = todo; con líneas registra faltantes) |
| POST | `/stock-transfers/:id/cancel` | Anular en tránsito (vuelve al origen) |
| GET | `/stock-transfers?status=&branchId=` · `/stock-transfers/:id` | Consultas |

## Compras

| Método | Ruta | Uso |
|---|---|---|
| POST | `/purchase-orders` | Pedido en borrador |
| POST | `/purchase-orders/from-replenishment` | Borrador automático con los faltantes de una sucursal |
| PATCH | `/purchase-orders/:id` | Editar borrador |
| POST | `/purchase-orders/:id/send` · `/cancel` | Enviar / cancelar |
| GET | `/purchase-orders?status=&supplierPersonId=&branchId=` · `/:id` | Consultas |
| POST | `/purchases/receipts` | Recibir mercadería; con `purchaseOrderId` imputa al pedido y con `updateSellingPrices: true` recalcula precios manteniendo el margen |
| GET | `/purchases/receipts?branchId=&supplierPersonId=&from=&to=` · `/:id` | Recepciones |
| GET | `/supplier-payables` · POST `/supplier-payments` | Cuenta corriente y pagos a proveedores |

## Ventas y caja

| Método | Ruta | Uso |
|---|---|---|
| POST | `/sales/quote` | **Cotizar antes de cobrar**: promociones, IVA, clase de comprobante y total |
| POST | `/sales` | Registrar la venta (los pagos deben sumar exactamente el total cotizado) |
| GET | `/sales?branchId=&from=&to=&customerPersonId=&sellerUserId=&paymentMethod=&voucherClass=` | Listado |
| GET | `/sales/:id` | Detalle con ítems, pagos y notas fiscales |
| POST | `/sales/:id/returns` | Devolución total (sin líneas) o parcial; `refundMethod`: `CASH` (con `cashSessionId`), `ORIGINAL_METHOD`, `STORE_CREDIT` |
| GET | `/sales/:id/returns` | Devoluciones de la venta |
| POST | `/cash/registers` · GET `/cash/registers?branchId=` | Cajas por sucursal; cada caja trae `openSession` (o `null`) para imputar cobros en efectivo |
| POST | `/cash/registers/:id/sessions` | Abrir caja |
| POST | `/cash/sessions/:id/movements` · `/close` | Ingresos/egresos y cierre |

## Factura electrónica (ARCA)

| Método | Ruta | Uso |
|---|---|---|
| PUT/GET | `/fiscal/profile` | CUIT, condición frente al IVA, ambiente y referencias al certificado |
| POST/GET | `/fiscal/points-of-sale` | Punto de venta ARCA de cada sucursal |
| GET | `/fiscal/status` | Prueba de conexión y credenciales |
| POST | `/fiscal/sales/:id/invoice` | Emitir factura (A/B/C según el cliente). Idempotente y reintentable |
| POST | `/fiscal/returns/:id/credit-note` | Nota de crédito de una devolución |
| GET | `/fiscal/documents?status=&from=&to=` | Comprobantes emitidos |
| GET | `/fiscal/documents/:id` | Todo lo necesario para imprimir: emisor, receptor, ítems, CAE, `formattedNumber` y `qrUrl` |

Flujo de caja recomendado: `quote` → `POST /sales` → `POST /fiscal/sales/:id/invoice` → imprimir con `GET /fiscal/documents/:id`.
Si ARCA no responde, la venta queda registrada con `fiscalStatus: FAILED` y se reintenta la emisión más tarde.

## Tablero y reportes (dueño)

Todos aceptan `?from=&to=&branchId=` (por defecto últimos 30 días).

| Ruta | Contenido |
|---|---|
| `/reports/dashboard` | Ventas netas, tickets, ticket promedio, margen bruto y % vs. período anterior; por sucursal; hoy; cajas abiertas, deuda con proveedores (vencida), stock bajo, transferencias en tránsito, pedidos pendientes |
| `/reports/sales-by-day` | Serie diaria para gráfico de líneas |
| `/reports/sales-by-hour` | Mapa de calor día × hora |
| `/reports/top-products?sort=revenue\|quantity\|margin&order=desc&limit=20` | Ranking (con `order=asc`, los que menos se venden) |
| `/reports/sales-by-category` · `/sales-by-payment-method` · `/sales-by-seller` | Desgloses |
| `/reports/stock-valuation` | Inventario valorizado a costo y a precio de venta |
| `/reports/dead-stock?days=60` | Mercadería sin ventas (capital inmovilizado) |

## Marketing y clientes

| Método | Ruta | Uso |
|---|---|---|
| POST/GET/PATCH | `/marketing/promotions` | Promociones `PERCENTAGE` o `BUY_X_PAY_Y` (3x2) por producto, categoría, marca, sucursal, vigencia y días de la semana. `?current=true` = vigentes |
| GET | `/marketing/customers/top` | Mejores clientes del período |
| GET | `/marketing/customers/inactive?days=60&onlyWithConsent=true` | Clientes a recuperar |
| GET | `/marketing/customers/summary` | Nuevos vs. recurrentes, % de ventas identificadas |
| GET | `/marketing/customers/contacts.csv` | Contactos con consentimiento (Ley 25.326) |
| GET/POST/PATCH | `/persons` · `/persons/:id` · `/persons/:id/activate` · `/deactivate` | Clientes y proveedores (`?role=customers\|suppliers&search=`) |

## Administración

`/branches` (sucursales, con `allowedIpRanges` opcional), `/users`, `/audit-events` (auditoría), `/health` (monitoreo).
