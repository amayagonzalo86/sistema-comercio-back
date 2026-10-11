# Despliegue en producción (VPS de bajo costo)

Arquitectura recomendada para 5 sucursales: **un VPS de 2 vCPU / 4 GB** (Hetzner CX22 o DigitalOcean Basic, ~USD 5–12/mes)
con Docker, MySQL 8, la API NestJS y este frontend, detrás de **Nginx** y **Cloudflare**.

```
Navegador ──HTTPS──> Cloudflare (WAF, DDoS, caché de estáticos)
                        │
                        ▼
                 Nginx (TLS, gzip, límite de peticiones)
                 ├── /api/      → API NestJS  (127.0.0.1:3000)
                 └── /          → Next.js     (127.0.0.1:3001)
```

App y API comparten dominio (`erp.tuempresa.com.ar`): la cookie de sesión (`path=/api/v1/auth`, `SameSite=Strict`,
`Secure`) funciona sin CORS y sin exponer la API en otro origen.

## 1. Construir y levantar el frontend

```bash
git clone git@github.com:amayagonzalo86/sistema-comercio-front.git && cd sistema-comercio-front
docker build \
  --build-arg API_ORIGIN=http://127.0.0.1:3000 \
  --build-arg NEXT_PUBLIC_APP_NAME="Mi Empresa ERP" \
  -t erp-front:1.0.0 .
docker run -d --name erp-front --restart unless-stopped --network host erp-front:1.0.0
```

> `API_ORIGIN` solo se usa si alguna petición llega a Next.js en `/api/v1` (por ejemplo, en una prueba sin Nginx).
> En producción Nginx envía `/api/` directo a la API.

## 2. Nginx

```nginx
limit_req_zone $binary_remote_addr zone=erp_api:10m rate=20r/s;

server {
  listen 443 ssl http2;
  server_name erp.tuempresa.com.ar;

  ssl_certificate     /etc/ssl/cloudflare/origin.pem;   # Certificado de origen de Cloudflare
  ssl_certificate_key /etc/ssl/cloudflare/origin.key;

  client_max_body_size 1m;
  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;

  location /api/ {
    limit_req zone=erp_api burst=40 nodelay;
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
    proxy_set_header X-Real-IP $remote_addr;
  }

  location /_next/static/ {
    proxy_pass http://127.0.0.1:3001;
    add_header Cache-Control "public, max-age=31536000, immutable";
  }

  location / {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto https;
  }
}

server {
  listen 80;
  server_name erp.tuempresa.com.ar;
  return 301 https://$host$request_uri;
}
```

## 3. Backend (`.env` de la API)

```dotenv
NODE_ENV=production
ALLOWED_ORIGINS=https://erp.tuempresa.com.ar
TRUST_PROXY_HOPS=2          # Cloudflare + Nginx: la API ve la IP real (rate limit y lista blanca por sucursal)
```

## 4. Cloudflare

- SSL/TLS en modo **Full (strict)** con certificado de origen.
- **WAF** administrado activado y regla de *rate limiting* para `POST /api/v1/auth/login` (por ejemplo, 10 por minuto por IP).
- Bloquear el acceso directo al VPS: en el firewall del servidor (`ufw`) permitir 80/443 solo desde los
  [rangos IP de Cloudflare](https://www.cloudflare.com/ips/) y SSH solo desde tu IP.
- Opcional: *Cloudflare Access* para restringir `/configuracion/*` a los correos del titular.

## 5. Actualizar a una nueva versión

```bash
cd sistema-comercio-front && git pull
docker build --build-arg API_ORIGIN=http://127.0.0.1:3000 -t erp-front:1.0.1 .
docker rm -f erp-front && docker run -d --name erp-front --restart unless-stopped --network host erp-front:1.0.1
```

## Checklist antes de entregar al cliente

- [ ] HTTPS activo y redirección desde HTTP.
- [ ] `ALLOWED_ORIGINS` y `TRUST_PROXY_HOPS` correctos en la API.
- [ ] Perfil fiscal cargado, certificado en el servidor y prueba de conexión ARCA en verde (homologación → producción).
- [ ] Puntos de venta asociados a cada sucursal.
- [ ] Usuarios con el rol mínimo necesario y sucursal asignada a cajeros, vendedores y depósito.
- [ ] Respaldo diario cifrado de MySQL probado con una restauración.
