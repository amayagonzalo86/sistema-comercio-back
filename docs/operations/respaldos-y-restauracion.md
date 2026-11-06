# Respaldos y restauración

Objetivo: perder como máximo 24 horas de datos (RPO) y volver a operar en menos de 4 horas (RTO). Los
comprobantes fiscales se conservan 10 años, así que los respaldos mensuales se guardan ese plazo.

## Qué se respalda

| Qué | Cómo | Frecuencia | Retención |
| --- | --- | --- | --- |
| Base MySQL | `mysqldump --single-transaction`, comprimido y cifrado con GPG | Diaria, 03:00 | 30 diarios + 12 mensuales + 1 por año durante 10 años |
| `UPLOADS_DIR` (fotos y logos) | `tar` cifrado | Diaria | 30 días |
| Certificados ARCA (`FISCAL_SECRETS_DIR`) | Copia cifrada fuera del servidor | Al cambiar | Mientras estén vigentes |
| `.env` de producción | Gestor de contraseñas del equipo | Al cambiar | Siempre la última |

La llave privada GPG de restauración **no** se guarda en el servidor.

## Script diario

`/usr/local/bin/erp-backup.sh` (dueño `root`, permisos `700`):

```bash
#!/usr/bin/env bash
set -euo pipefail
STAMP=$(date +%F)
DEST=/var/backups/erp
RECIPIENT=backups@tuempresa.com.ar
mkdir -p "$DEST"

mysqldump --defaults-extra-file=/etc/erp/backup.cnf --single-transaction --routines --triggers \
  --set-gtid-purged=OFF sistema_comercio \
  | gzip | gpg --batch --yes --encrypt --recipient "$RECIPIENT" > "$DEST/db-$STAMP.sql.gz.gpg"

tar -C /var/lib/erp -czf - uploads \
  | gpg --batch --yes --encrypt --recipient "$RECIPIENT" > "$DEST/uploads-$STAMP.tar.gz.gpg"

# Copia externa (rclone a un almacenamiento de objetos con versionado: Backblaze B2, Hetzner Storage Box, etc.)
rclone copy "$DEST" erp-offsite:erp-backups --include "*-$STAMP.*"

# Limpieza local: solo los últimos 7 días quedan en el servidor
find "$DEST" -name '*.gpg' -mtime +7 -delete
```

`/etc/erp/backup.cnf` (permisos `600`), con un usuario de MySQL que solo tenga `SELECT, LOCK TABLES, SHOW VIEW, TRIGGER, EVENT`:

```ini
[client]
user=erp_backup
password=CLAVE_LARGA
```

Cron: `0 3 * * * root /usr/local/bin/erp-backup.sh >> /var/log/erp-backup.log 2>&1`

Configurar la retención larga (mensual y anual) con las reglas de ciclo de vida del almacenamiento externo.

## Restaurar

Hacerlo primero en una base nueva; nunca sobre la base en uso sin un respaldo previo de esta.

```bash
gpg --decrypt db-2026-11-05.sql.gz.gpg | gunzip > restore.sql
mysql -u root -p -e "CREATE DATABASE sistema_comercio_restore CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci"
mysql -u root -p sistema_comercio_restore < restore.sql
DB_NAME=sistema_comercio_restore npm run migration:run:prod   # deja la base al nivel de la versión actual
shred -u restore.sql
```

Para volver a operar: detener la API, apuntar `DB_NAME` a la base restaurada (o renombrarla), iniciar la API
y comprobar `GET /api/v1/health`.

## Prueba mensual (obligatoria)

1. Restaurar el último respaldo en una base temporal.
2. Comprobar que la cantidad de ventas y comprobantes del último día coincide con producción.
3. Iniciar una API apuntando a esa base e ingresar.
4. Anotar fecha, duración y resultado en el registro de pruebas; borrar la base temporal.

Un respaldo que nunca se restauró no es un respaldo.
