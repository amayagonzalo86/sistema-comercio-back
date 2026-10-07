# Sistema Comercio ERP

Backend REST para un ERP comercial construido con NestJS, TypeScript, TypeORM y MySQL. La dirección del producto es un SaaS multiempresa para comercios argentinos.

## Estado

Backend comercial multiempresa y multisucursal listo para operar una cadena de comercios en Argentina:

- **Catálogo y precios**: búsqueda, precios por sucursal, aumentos masivos por porcentaje con vista previa e historial.
- **Inventario**: libro de movimientos, ajustes, transferencias entre sucursales, matriz de stock, alertas y plan de reposición.
- **Compras**: pedidos a proveedores (también generados desde faltantes), recepciones, costo promedio, cuenta corriente y pagos.
- **Ventas y caja**: cotizador, ventas con IVA y promociones, cobro atómico en caja, devoluciones con reintegro y reingreso de stock.
- **Factura electrónica ARCA**: facturas y notas de crédito A/B/C con CAE y QR.
- **Tablero del dueño**: KPIs con comparación de períodos, márgenes reales, rankings, valorización y stock inmovilizado.
- **Marketing**: promociones automáticas, clientes top e inactivos, exportación de contactos con consentimiento.
- **Seguridad y auditoría** en todas las operaciones críticas.

Cada cambio se verifica en CI con tipos, pruebas unitarias, una prueba de integración de punta a punta contra MySQL
real y la aplicación de migraciones sobre el esquema anterior. Mapa de endpoints: [guía de la API](docs/api/guia-api.md).
Revisá también [la arquitectura y hoja de ruta](docs/architecture/erp-argentina.md).

## Requisitos locales

- Node.js compatible con las dependencias del proyecto.
- MySQL.
- Variables locales en `.env`.

En PowerShell:

```powershell
Copy-Item .env.example .env
```

Editá `.env` con los datos de tu MySQL y secretos propios. No subas `.env` a GitHub ni uses secretos de ejemplo en producción.

## Instalar y ejecutar

```bash
npm ci
npm run start:dev
```

La API escucha por defecto en `http://localhost:3000/api/v1` y expone `GET /api/v1/health` para monitoreo. El login es `POST /auth/login` con JSON `{ "username": "...", "password": "..." }`: devuelve el access token (15 minutos) en el cuerpo y el refresh token **solo** en una cookie HttpOnly, por lo que el frontend debe usar `credentials: 'include'` (fetch) o `withCredentials: true` (axios) en login, `/auth/refresh` y `/auth/logout`, y guardar el access token en memoria (no en `localStorage`). Si el usuario pertenece a varias empresas, sin `tenantId` ingresa a la membresía activa más antigua; con el token, `GET /auth/tenants` lista sus empresas activas para elegir una e iniciar sesión nuevamente enviando `tenantId`. El login limita los intentos a 10 por identificador y 60 por IP en ventanas de 15 minutos; el control es compartido entre instancias mediante MySQL y almacena claves HMAC, no los valores originales.

El inventario expone ajustes con saldo firmado, motivo e idempotencia:
`POST /api/v1/products/:productId/branches/:branchId/stock-adjustments` requiere el encabezado `Idempotency-Key` y un cuerpo como `{ "quantityDelta": -2, "reason": "Conteo físico" }`.
El historial se consulta en `GET /api/v1/products/:productId/branches/:branchId/stock-movements`; acepta `limit` (máximo 100) y un `cursor` opaco devuelto por la respuesta.
Los movimientos y sus eventos de auditoría se escriben en la misma transacción. Las consultas de sucursales, existencias, ventas y precios calculados limitan los resultados a la sucursal asignada en la membresía; los perfiles de caja, venta e inventario sin sucursal asignada reciben acceso denegado.

Las recepciones de compra se registran con `POST /api/v1/purchases/receipts`, `Idempotency-Key`, sucursal, proveedor y líneas con cantidad y costo unitario sin impuestos. La operación guarda la recepción, el costo promedio ponderado, el ingreso de inventario y su auditoría en una sola transacción. La tasa impositiva se captura por línea desde el comprobante recibido y el documento queda como registro interno: no valida comprobantes del proveedor ni emite documentación fiscal. La cuenta corriente y los pagos a proveedores se registran en `GET /api/v1/supplier-payables` y `POST /api/v1/supplier-payments`. Los pagos parciales se asignan a una o varias cuentas, no superan el saldo abierto y quedan auditados; si el método es `CASH`, agregá `cashSessionId` para reflejar el egreso en la misma transacción. la integración con caja/bancos y conciliación de extractos sigue pendiente.

Las ventas internas se registran con `POST /api/v1/sales`, encabezado `Idempotency-Key`, empresa/sucursal, productos/cantidades y medios de pago. El servidor calcula precio e impuestos del catálogo, comprueba el total cobrado y registra venta, pagos, salida de inventario y auditoría atómicamente. La respuesta queda con `fiscalStatus: NOT_ISSUED` hasta emitir la factura con `POST /api/v1/fiscal/sales/:id/invoice`. La caja expone `GET/POST /api/v1/cash/registers`, apertura con `POST /api/v1/cash/registers/:registerId/sessions`, consulta de sesión y movimientos, registro idempotente de ingresos/egresos/ajustes y cierre con arqueo. El saldo se actualiza con bloqueo de fila por sesión; las aperturas concurrentes se serializan por caja, y saldos, movimientos y auditoría se guardan en la misma transacción. Todas las consultas quedan limitadas por tenant y sucursal autorizada. Los cobros `CASH` de ventas requieren `cashSessionId` y generan el ingreso en la sesión, y los pagos `CASH` a proveedores requieren la misma referencia y descuentan el saldo, dentro de la transacción comercial correspondiente. Las ventas con otros medios no modifican caja. Aún faltan conciliación bancaria, integración con los procesadores de pago y cuenta corriente de clientes.

Los titulares y administradores de la empresa pueden consultar auditoría en `GET /api/v1/audit-events`. Siempre filtra por la empresa del token y ofrece filtros por tipo de evento, entidad, actor, request y fecha, con cursor descendente y páginas de hasta 100 eventos. Es una consulta de solo lectura; no expone eventos de otras empresas.

El operador de plataforma (SUPER_ADMIN) ya no se crea automáticamente ni con una clave fija. Se crea una sola vez con:

```bash
ADMIN_BOOTSTRAP_PASSWORD='Una-Clave-Larga-1!' npm run seed
```

La clave debe tener 14+ caracteres con mayúscula, minúscula, número y símbolo. Si una base existente todavía tiene el usuario `admin` con la clave antigua `AdminPass123!`, cambiala de inmediato.

## IVA

Cada producto define su tratamiento (`TAXED`, `EXEMPT`, `NOT_TAXED`), alícuota (0, 2,5, 5, 10,5, 21 o 27 %) y si su precio incluye IVA. `PATCH /api/v1/products/:id/vat` asigna o quita el IVA con motivo auditado. Cada venta calcula la clase de comprobante (A, B, C o E) según la condición frente al IVA de la empresa (perfil fiscal activo) y del cliente, y un OWNER/ADMIN puede registrar ventas exentas (`vatExemption`) con motivo legal. Detalle en [cumplimiento normativo](docs/legal/cumplimiento-argentina.md).

## Migraciones

En desarrollo, el esquema se sincroniza automáticamente. En otros entornos, usar migraciones versionadas:

```bash
npm run migration:run
```

No habilites `synchronize` en producción. Revisá y respaldá la base antes de aplicar cada migración. Las migraciones `1791000000005-CreateAuthRateLimits`, `1791000000006-AddTenantAuditCursorIndex`, `1791000000007-AddPersonBusinessType`, `1791000000008-CreatePurchaseReceipts`, `1791000000009-CreateSupplierPayablesAndPayments`, `1791000000010-MaterializeSupplierPayableBalance` y `1791000000011-CreateTenantCashManagement`, `1791000000012-EnforceCashTenantMembership`, `1791000000013-EnableCashSessionOperations` y `1791000000014-AddVatComplianceAndBranchIpAllowlist` a `1791000000020-CreateElectronicInvoicing` deben aplicarse antes de desplegar esta versión; el login, la paginación de auditoría y la clasificación de clientes/proveedores dependen de sus objetos. Las personas existentes quedan como `BOTH` para conservar su uso actual. La migración de alcance multiempresa asigna registros preexistentes a una empresa heredada y aborta si detecta duplicados incompatibles con restricciones nuevas; inspeccioná el error y depurá los datos antes de reintentar.

## Variables relevantes

Ver [.env.example](.env.example). La aplicación valida variables de base de datos, entorno, JWT y CORS durante el arranque. Configurá `ALLOWED_ORIGINS` con los orígenes exactos que usan los clientes.

## Seguridad y operación

Controles activos: validación estricta de variables al arrancar (secretos de 32+ caracteres, CORS sin comodines, HTTPS y claves robustas en producción), rate limit global por IP, Helmet con CSP restrictiva para API, límite de tamaño de cuerpo, JWT con algoritmo fijo y rotación de refresh token con detección de reutilización, mensajes de login que no revelan si el usuario existe, bloqueo de asignación de SUPER_ADMIN desde empresas, lista blanca de IP opcional por sucursal (`allowedIpRanges` en la sucursal) y errores 5xx sin detalles internos. Detrás de Cloudflare o Nginx configurá `TRUST_PROXY_HOPS`. Guía completa en [despliegue seguro](docs/operations/despliegue-seguro.md).

El login incluye límites persistentes por identificador e IP con ventanas de 15 minutos. Para el límite de IP se usa la dirección de la conexión TCP; no se confía en `X-Forwarded-For` mientras no exista una configuración explícita de proxy confiable. Este control complementa, pero no reemplaza, un WAF o protección de borde frente a ataques distribuidos. El objetivo es verificar controles de autenticación y autorización, aislamiento por empresa, límites de consumo, auditoría, secretos, backups y observabilidad antes de comercializar. La guía de arquitectura incluye las fases pendientes, el modelo de concurrencia y referencias de ARCA, protección de datos y OWASP.

No se debe interpretar la existencia de entidades de auditoría o fiscales como cumplimiento normativo completo. La integración fiscal requiere homologación con ARCA y revisión de los flujos impositivos del producto.
