# Variables de entorno

Todas las variables que lee la API. El modelo comentado está en `.env.example`. En producción se cargan
desde el panel del proveedor o un archivo `.env` con permisos `600`, nunca desde Git.

**Obligatoria** = la API no arranca sin ella (o con un valor débil) en producción.

## Servidor y red

| Variable | Obligatoria | Por defecto | Uso |
| --- | --- | --- | --- |
| `NODE_ENV` | Sí | `development` | `production` activa HSTS y la validación estricta |
| `PORT` | No | `3000` | Puerto local de la API (detrás de Nginx) |
| `ALLOWED_ORIGINS` | Sí | — | Orígenes exactos del frontend, separados por coma; HTTPS en producción, sin `*` |
| `TRUST_PROXY_HOPS` | Sí, con proxy | `0` | Proxies confiables: `1` Nginx o Cloudflare, `2` ambos. Necesario para ver la IP real |
| `THROTTLE_TTL` / `THROTTLE_LIMIT` | No | `60` / `300` | Límite global de peticiones por IP |
| `BODY_LIMIT` | No | `200kb` | Tamaño máximo del cuerpo JSON |
| `UPLOADS_DIR` | Recomendada | carpeta del proyecto | Fotos de productos y logos; fuera del proyecto y con respaldo |

## Base de datos

| Variable | Obligatoria | Por defecto | Uso |
| --- | --- | --- | --- |
| `DB_HOST` / `DB_PORT` | Sí | `127.0.0.1` / `3306` | Servidor MySQL |
| `DB_USER` | Sí | — | Usuario propio con permisos mínimos; nunca `root` |
| `DB_PASSWORD` | Sí | — | 12+ caracteres |
| `DB_NAME` | Sí | — | Base del sistema |
| `DB_POOL_SIZE` | No | `10` | Conexiones simultáneas |
| `DB_SSL` | No | `false` | `true` si la base está en otro servidor |

## Sesión

| Variable | Obligatoria | Por defecto | Uso |
| --- | --- | --- | --- |
| `JWT_ACCESS_SECRET` | Sí | — | Firma de tokens de acceso y desafíos de equipo; 32+ caracteres aleatorios |
| `JWT_REFRESH_SECRET` | Sí | — | Firma de tokens de renovación; distinto del anterior |
| `JWT_EXPIRES_IN` | No | `15m` | Vigencia del token de acceso |

Generar secretos: `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`.
Cambiar `JWT_ACCESS_SECRET` cierra todas las sesiones y pide firmar de nuevo el desafío de equipo (los equipos
aprobados siguen aprobados).

## Factura electrónica ARCA

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `FISCAL_ENCRYPTION_KEY` | Recomendada | Cifra el ticket de acceso de ARCA en la base; si falta, se deriva de `JWT_ACCESS_SECRET` |
| `FISCAL_SECRETS_DIR` | Una de las dos | Carpeta con `empresa.crt` / `empresa.key` (perfil fiscal `file:…`) |
| `ARCA_CERT` / `ARCA_KEY` | Una de las dos | Certificado y llave en PEM o base64 (perfil fiscal `env:…`) |
| `ARCA_WSAA_URL_*` / `ARCA_WSFE_URL_*` | No | Solo si ARCA cambia sus direcciones oficiales |

Guía: [alta-arca.md](../operations/alta-arca.md).

## Vendedor IA por WhatsApp

| Variable | Obligatoria | Uso |
| --- | --- | --- |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` / `GEMINI_API_KEY` | Al menos una | Proveedores de IA; sin clave se omiten |
| `AI_PROVIDER_ORDER` | No | Orden de respaldo, por defecto `anthropic,openai,gemini` |
| `AI_ANTHROPIC_MODEL` / `AI_OPENAI_MODEL` / `AI_GEMINI_MODEL` | No | Modelos (por defecto, rápidos y económicos) |
| `AI_TIMEOUT_MS` | No | Tiempo máximo por respuesta, `45000` |
| `WHATSAPP_VERIFY_TOKEN` | Sí, con el módulo | Texto propio que se carga en Meta al registrar el webhook |
| `WHATSAPP_APP_SECRET` | Sí, con el módulo | Valida la firma de cada mensaje |
| `WHATSAPP_GRAPH_VERSION` | No | Versión de la Graph API, `v21.0` |
| `WHATSAPP_ACCESS_TOKEN` | No | Solo instalaciones de una empresa; lo normal es cargarlo cifrado en el panel |
| `AI_SALES_SYNC_WEBHOOK` | No | Solo pruebas: `true` procesa el mensaje antes de responder a Meta |

Guía: [vendedor-ia-whatsapp.md](../operations/vendedor-ia-whatsapp.md).

## Primer arranque

| Variable | Uso |
| --- | --- |
| `ADMIN_BOOTSTRAP_USERNAME` / `ADMIN_BOOTSTRAP_PASSWORD` / `ADMIN_BOOTSTRAP_EMAIL` | Crean el operador de la plataforma con `npm run seed:prod`. Borrar la contraseña del entorno apenas se use |
