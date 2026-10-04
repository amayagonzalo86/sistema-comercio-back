# Sistema Comercio ERP

Backend REST para un ERP comercial construido con NestJS, TypeScript, TypeORM y MySQL. La dirección del producto es un SaaS multiempresa para comercios argentinos.

## Estado

El repositorio contiene autenticación, usuarios, personas, roles, sucursales, productos, stock por sucursal, listas de precios y entidades de plataforma para empresas, membresías, auditoría y configuración fiscal. La rama de evolución agrega contexto multiempresa a varios de esos módulos y un libro transaccional de movimientos de inventario.

**El aislamiento integral todavía no está terminado y el sistema no está listo para producción:** faltan otros dominios, auditoría en todas las operaciones críticas, pruebas de seguridad y carga, y la integración fiscal no emite comprobantes. Revisá [la arquitectura y hoja de ruta](docs/architecture/erp-argentina.md).

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

La API escucha por defecto en `http://localhost:3000/api/v1`. El login es `POST /auth/login` con JSON `{ "username": "...", "password": "..." }`. Si el usuario pertenece a varias empresas, sin `tenantId` ingresa a la membresía activa más antigua; con el token, `GET /auth/tenants` lista sus empresas activas para elegir una e iniciar sesión nuevamente enviando `tenantId`. El login limita los intentos a 10 por identificador y 60 por IP en ventanas de 15 minutos; el control es compartido entre instancias mediante MySQL y almacena claves HMAC, no los valores originales.

El inventario expone ajustes con saldo firmado, motivo e idempotencia:
`POST /api/v1/products/:productId/branches/:branchId/stock-adjustments` requiere el encabezado `Idempotency-Key` y un cuerpo como `{ "quantityDelta": -2, "reason": "Conteo físico" }`.
El historial se consulta en `GET /api/v1/products/:productId/branches/:branchId/stock-movements`; acepta `limit` (máximo 100) y un `cursor` opaco devuelto por la respuesta.
Los movimientos y sus eventos de auditoría se escriben en la misma transacción. Las consultas de sucursales, existencias, ventas y precios calculados limitan los resultados a la sucursal asignada en la membresía; los perfiles de caja, venta e inventario sin sucursal asignada reciben acceso denegado.

Las recepciones de compra se registran con `POST /api/v1/purchases/receipts`, `Idempotency-Key`, sucursal, proveedor y líneas con cantidad y costo unitario sin impuestos. La operación guarda la recepción, el costo promedio ponderado, el ingreso de inventario y su auditoría en una sola transacción. La tasa impositiva se captura por línea desde el comprobante recibido y el documento queda como registro interno: no valida comprobantes del proveedor ni emite documentación fiscal. La cuenta corriente y los pagos a proveedores son un módulo pendiente.

Las ventas internas se registran con `POST /api/v1/sales`, encabezado `Idempotency-Key`, empresa/sucursal, productos/cantidades y medios de pago. El servidor calcula precio e impuestos del catálogo, comprueba el total cobrado y registra venta, pagos, salida de inventario y auditoría atómicamente. La respuesta queda con `fiscalStatus: NOT_ISSUED`: todavía no es una factura electrónica ni reemplaza la emisión/homologación ARCA. Los cierres de caja, cuentas corrientes y conciliación de pagos siguen pendientes.

Los titulares y administradores de la empresa pueden consultar auditoría en `GET /api/v1/audit-events`. Siempre filtra por la empresa del token y ofrece filtros por tipo de evento, entidad, actor, request y fecha, con cursor descendente y páginas de hasta 100 eventos. Es una consulta de solo lectura; no expone eventos de otras empresas.

El seeder actual crea `admin` con una clave conocida solo si el usuario no existe. Es exclusivamente para desarrollo: cambiá esa contraseña inmediatamente y reemplazá el mecanismo de bootstrap por una invitación segura antes de publicar el servicio.

## Migraciones

En desarrollo, el esquema se sincroniza automáticamente. En otros entornos, usar migraciones versionadas:

```bash
npm run migration:run
```

No habilites `synchronize` en producción. Revisá y respaldá la base antes de aplicar cada migración. Las migraciones `1791000000005-CreateAuthRateLimits`, `1791000000006-AddTenantAuditCursorIndex`, `1791000000007-AddPersonBusinessType` y `1791000000008-CreatePurchaseReceipts` deben aplicarse antes de desplegar esta versión; el login, la paginación de auditoría y la clasificación de clientes/proveedores dependen de sus objetos. Las personas existentes quedan como `BOTH` para conservar su uso actual. La migración de alcance multiempresa asigna registros preexistentes a una empresa heredada y aborta si detecta duplicados incompatibles con restricciones nuevas; inspeccioná el error y depurá los datos antes de reintentar.

## Variables relevantes

Ver [.env.example](.env.example). La aplicación valida variables de base de datos, entorno, JWT y CORS durante el arranque. Configurá `ALLOWED_ORIGINS` con los orígenes exactos que usan los clientes.

## Seguridad y operación

El login incluye límites persistentes por identificador e IP con ventanas de 15 minutos. Para el límite de IP se usa la dirección de la conexión TCP; no se confía en `X-Forwarded-For` mientras no exista una configuración explícita de proxy confiable. Este control complementa, pero no reemplaza, un WAF o protección de borde frente a ataques distribuidos. El objetivo es verificar controles de autenticación y autorización, aislamiento por empresa, límites de consumo, auditoría, secretos, backups y observabilidad antes de comercializar. La guía de arquitectura incluye las fases pendientes, el modelo de concurrencia y referencias de ARCA, protección de datos y OWASP.

No se debe interpretar la existencia de entidades de auditoría o fiscales como cumplimiento normativo completo. La integración fiscal requiere homologación con ARCA y revisión de los flujos impositivos del producto.
