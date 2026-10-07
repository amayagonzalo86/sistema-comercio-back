# Despliegue seguro y de bajo costo

Arquitectura recomendada para empezar a vender con el menor costo fijo:

```
Usuario ──HTTPS──> Cloudflare (DNS, WAF, DDoS, caché) ──HTTPS──> VPS (Nginx ──> API NestJS en Docker) ──> MySQL (mismo VPS, sin puerto público)
```

Un VPS chico (2 vCPU / 4 GB, por ejemplo Hetzner en la UE) alcanza para decenas de comercios. Escalá cuando las métricas
lo indiquen, no antes.

## 1. Servidor (Ubuntu 24.04)

```bash
# Usuario sin root con clave SSH, y bloquear acceso por contraseña
adduser deploy && usermod -aG sudo deploy
sudo sed -i 's/^#\?PasswordAuthentication .*/PasswordAuthentication no/; s/^#\?PermitRootLogin .*/PermitRootLogin no/' /etc/ssh/sshd_config
sudo systemctl restart ssh

# Firewall: solo SSH, HTTP y HTTPS. MySQL (3306) y la API (3000) NUNCA quedan expuestos.
sudo ufw default deny incoming && sudo ufw default allow outgoing
sudo ufw allow OpenSSH && sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
sudo ufw enable

# Parches de seguridad automáticos y bloqueo de fuerza bruta SSH
sudo apt update && sudo apt install -y unattended-upgrades fail2ban
sudo dpkg-reconfigure -plow unattended-upgrades
```

Opcional y recomendado: permitir 80/443 solo desde los rangos IP de Cloudflare (https://www.cloudflare.com/ips/), así
nadie puede saltear el WAF atacando la IP del servidor directamente.

## 2. MySQL con mínimo privilegio

```sql
CREATE DATABASE sistema_comercio CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- Usuario de la aplicación: solo datos, sin permisos de administración.
CREATE USER 'erp_app'@'localhost' IDENTIFIED BY 'una-clave-larga-y-aleatoria';
GRANT SELECT, INSERT, UPDATE, DELETE ON sistema_comercio.* TO 'erp_app'@'localhost';
-- Usuario de migraciones: se usa solo al desplegar.
CREATE USER 'erp_migrator'@'localhost' IDENTIFIED BY 'otra-clave-larga-y-aleatoria';
GRANT ALL PRIVILEGES ON sistema_comercio.* TO 'erp_migrator'@'localhost';
FLUSH PRIVILEGES;
```

## 3. Variables de producción

```dotenv
NODE_ENV=production
ALLOWED_ORIGINS=https://app.tuempresa.com.ar
TRUST_PROXY_HOPS=2          # Cloudflare + Nginx
DB_USER=erp_app
DB_PASSWORD=...             # 12+ caracteres; la app no arranca con claves débiles
JWT_ACCESS_SECRET=...       # node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
JWT_REFRESH_SECRET=...      # distinto del anterior
THROTTLE_TTL=60
THROTTLE_LIMIT=300
```

La aplicación **se niega a arrancar** si los secretos son cortos o iguales, si se usan los secretos de ejemplo antiguos,
si `ALLOWED_ORIGINS` tiene `*` o HTTP en producción, o si la base usa `root` o una clave débil.

## 4. Nginx (proxy inverso)

```nginx
server {
  listen 443 ssl http2;
  server_name api.tuempresa.com.ar;
  # Certificado de origen de Cloudflare (SSL/TLS > Origin Server) con modo "Full (strict)".
  ssl_certificate     /etc/ssl/cloudflare/origin.pem;
  ssl_certificate_key /etc/ssl/cloudflare/origin.key;

  client_max_body_size 1m;
  location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 30s;
  }
}
```

## 5. Cloudflare (plan gratuito)

- **SSL/TLS**: modo *Full (strict)*, *Always Use HTTPS*, TLS mínimo 1.2, HSTS activado.
- **WAF > Managed rules**: activar el conjunto gratuito de Cloudflare.
- **Rate limiting rule**: `URI Path contiene /api/v1/auth/login` → máximo 10 peticiones por minuto por IP → bloquear 10 minutos.
- **Security > Bots**: *Bot Fight Mode* activado.
- **Caching**: regla para *Bypass cache* en `api.tuempresa.com.ar/*` (la API ya envía `Cache-Control: no-store`).
- Opcional: regla de WAF que desafíe tráfico fuera de Argentina si tus clientes son solo locales.

## 6. Despliegue con Docker

```bash
docker build -t erp-api:$(git rev-parse --short HEAD) .
# Migraciones antes de cambiar la versión (con respaldo previo verificado)
docker run --rm --network host --env-file .env.migrator erp-api:<tag> npm run migration:run:prod
docker run -d --name erp-api --restart unless-stopped --network host --env-file .env erp-api:<tag>
```

Primer arranque: crear el operador de plataforma una sola vez y luego borrar la variable.

```bash
docker run --rm --network host --env-file .env -e ADMIN_BOOTSTRAP_PASSWORD='Cl4ve-Muy-Larga!' erp-api:<tag> npm run seed:prod
```

## 7. Respaldos (obligatorio: conservación legal de 10 años)

```bash
# /etc/cron.d/erp-backup — volcado diario consistente, comprimido y cifrado
0 3 * * * deploy mysqldump --single-transaction --routines --triggers sistema_comercio \
  | gzip | gpg --batch --encrypt --recipient backups@tuempresa.com.ar \
  > /var/backups/erp/erp-$(date +\%F).sql.gz.gpg
```

Copiar los archivos a un almacenamiento de objetos externo con versionado y retención, y **probar una restauración
cada mes**. Un respaldo que nunca se restauró no es un respaldo.

## 8. Monitoreo

- Health check: `GET /api/v1/health` (verifica la base) en Uptime Kuma o el monitor de la plataforma.
- Revisar los logs `warn` de "Reutilización de refresh token detectada" y "Acceso bloqueado por lista blanca IP":
  indican intentos de acceso indebido.
