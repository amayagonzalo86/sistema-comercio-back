# Modelo de seguridad

Resumen de cómo se protege el sistema, capa por capa. Sirve para auditorías de clientes, para la
documentación del registro de bases de datos (medidas de seguridad, Ley 25.326 art. 9) y para revisar
cambios: un PR que toque una de estas capas debe mantener lo que dice este documento.

## Capas

| Capa | Control | Dónde está |
| --- | --- | --- |
| Red | Cloudflare (WAF administrado, Bot Fight Mode, límite en `/auth/login`), TLS Full (strict), firewall con solo 22/80/443 | [despliegue-seguro.md](../operations/despliegue-seguro.md) |
| HTTP | Helmet (CSP `default-src 'none'`, HSTS en producción, `no-referrer`), `Cache-Control: no-store`, sin `x-powered-by`, límite de cuerpo `BODY_LIMIT` | `src/main.ts` |
| CORS | Solo los orígenes exactos de `ALLOWED_ORIGINS`; la app no arranca con `*` o HTTP en producción | `src/main.ts`, validación de entorno |
| Entrada | `ValidationPipe` global con `whitelist` + `forbidNonWhitelisted` (bloquea asignación masiva); DTOs tipados | `src/main.ts`, `dto/` de cada módulo |
| SQL | TypeORM con parámetros; las consultas crudas usan `?` y nunca concatenan entrada del usuario | servicios |
| Contraseñas | Argon2; 10+ caracteres con mayúsculas, minúsculas y números; límite de intentos por usuario (10) y por IP (60) cada 15 min, con claves HMAC (no se guarda la IP en claro) | `auth.service.ts` |
| Sesión | Token de acceso JWT de 15 min en memoria del navegador; token de renovación de 7 días en cookie `HttpOnly`, rotativo, con detección de reutilización (revoca la familia) | `auth.service.ts`, `auth.module.ts` |
| Equipos | Aprobación de equipos por empresa: llave ECDSA P-256 no exportable (WebCrypto) o token de equipo sobre HTTP; `PENDING` y `REVOKED` no ingresan | `device-proof.ts`, `tenant-context.guard.ts` |
| IP | Lista blanca IP opcional por sucursal | `common/security/ip-allowlist.ts` |
| Autorización | Roles por empresa (Dueño, Administrador, Encargado, Contador, Cajero, Vendedor, Depósito, Consulta) con permisos sumados; roles de sucursal limitados a sus sucursales | `common/security/tenant-roles.ts`, `roles.guard.ts` |
| Multiempresa | Cada petición resuelve la empresa desde el token y la membresía; todas las consultas filtran por `tenant_id` | `tenant-context.guard.ts` |
| Módulos | Los módulos premium (Marketing, WhatsApp IA) se verifican en el servidor, no solo en el menú | `common/modules/tenant-modules.ts` |
| Auditoría | Eventos con usuario, IP, navegador, id de petición y datos del cambio, guardados en la misma transacción que la operación | `common/audit/audit.ts` |
| Secretos | Entorno validado al arrancar (secretos de 32+ caracteres, distintos; base sin `root`); certificados de ARCA fuera de la base; token de WhatsApp y ticket de ARCA cifrados | `config/`, `fiscal/` |
| Webhooks | WhatsApp valida la firma `X-Hub-Signature-256` con `WHATSAPP_APP_SECRET` | `ai-sales/whatsapp` |
| Archivos | Logo: solo PNG/JPG/WebP (sin SVG), hasta 1 MB, verificado por contenido | `platform/tenant-logo.ts` |

## Flujo de ingreso

1. El navegador pide un desafío de equipo y lo firma con su llave (o envía su token de equipo).
2. `POST /auth/login` valida usuario, contraseña, límites de intentos y el equipo.
3. Si la empresa exige equipos autorizados y el equipo no está aprobado, responde `DEVICE_PENDING:<código>`
   o `DEVICE_REVOKED`, y no entrega tokens. Los operadores de la plataforma están exentos para no quedar
   bloqueados fuera.
4. Cada petición posterior vuelve a comprobar que el equipo de la sesión siga aprobado: revocar corta el
   acceso en la siguiente petición.

## Qué revisar en cada PR

- ¿Un endpoint nuevo tiene `@Roles(...)` y, si es premium, su módulo?
- ¿Toda consulta nueva filtra por `tenant_id`?
- ¿Las operaciones críticas (precios, caja, stock, fiscal, usuarios, equipos) llaman a `recordAudit` dentro
  de la transacción?
- ¿Se agregó un secreto? Va a `.env.example` comentado y a [variables-de-entorno.md](../reference/variables-de-entorno.md), nunca al código.
- ¿Hay un e2e que pruebe el caso prohibido (otro tenant, otro rol, equipo pendiente)?
