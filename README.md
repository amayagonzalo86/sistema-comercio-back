# Sistema Comercio ERP

Backend REST para un ERP comercial construido con NestJS, TypeScript, TypeORM y MySQL. La dirección del producto es un SaaS multiempresa para comercios argentinos.

## Estado

El repositorio contiene autenticación, usuarios, personas, roles, sucursales, productos, stock por sucursal y listas de precios. La base de plataforma agrega empresas, membresías por empresa, eventos de auditoría y perfiles fiscales para preparar el aislamiento y la integración con ARCA.

**La base SaaS todavía no está terminada para producción:** las rutas y consultas actuales aún deben aplicar tenant y sucursal en cada operación. El perfil fiscal no emite comprobantes. Revisá [la arquitectura y hoja de ruta](docs/architecture/erp-argentina.md).

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

La API escucha por defecto en `http://localhost:3000/api/v1`. El login local es `POST /auth/login` con JSON `{ "username": "...", "password": "..." }`.

El seeder actual crea `admin` con una clave conocida solo si el usuario no existe. Es exclusivamente para desarrollo: cambiá esa contraseña inmediatamente y reemplazá el mecanismo de bootstrap por una invitación segura antes de publicar el servicio.

## Migraciones

En desarrollo, el esquema se sincroniza automáticamente. En otros entornos, usar migraciones versionadas:

```bash
npm run migration:run
```

No habilites `synchronize` en producción. Revisá y respaldá la base antes de aplicar cada migración.

## Variables relevantes

Ver [.env.example](.env.example). La aplicación valida variables de base de datos, entorno, JWT y CORS durante el arranque. Configurá `ALLOWED_ORIGINS` con los orígenes exactos que usan los clientes.

## Seguridad y operación

El objetivo es verificar controles de autenticación y autorización, aislamiento por empresa, límites de consumo, auditoría, secretos, backups y observabilidad antes de comercializar. La guía de arquitectura incluye las fases pendientes, el modelo de concurrencia y referencias de ARCA, protección de datos y OWASP.

No se debe interpretar la existencia de entidades de auditoría o fiscales como cumplimiento normativo completo. La integración fiscal requiere homologación con ARCA y revisión de los flujos impositivos del producto.
