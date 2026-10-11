# Comercio ERP — Frontend

Interfaz web del ERP comercial multi-sucursal para empresas argentinas. Consume la API NestJS de
[`sistema-comercio-back`](https://github.com/amayagonzalo86/sistema-comercio-back).

**Stack:** Next.js 16 (App Router) · React 19 · TypeScript estricto · Bootstrap 5.3 (SCSS propio) · Bootstrap Icons.

## Qué incluye

| Área | Pantallas |
|---|---|
| Dirección | Tablero del dueño (ventas netas, margen, tickets, comparación con el período anterior, ranking de sucursales, alertas operativas, mapa de calor por hora) y reportes (productos, rubros, vendedores, medios de pago, inventario valorizado, mercadería sin rotación, exportación CSV). |
| Ventas | Punto de venta con lector de código de barras, cotización en vivo (promociones, IVA, letra A/B/C), cobro dividido con vuelto, factura electrónica ARCA al cobrar; listado y detalle de ventas; devoluciones totales o parciales; notas de crédito. |
| Caja | Apertura con fondo inicial, ingresos/egresos, cierre con arqueo y diferencia. |
| Comprobantes | Listado ARCA y hoja imprimible/PDF con letra, CAE, vencimiento, QR (generado localmente) y leyenda de transparencia fiscal (Ley 27.743). |
| Mercadería | Catálogo por sucursal, alta multi-sucursal, ficha con precios, IVA (asignar/quitar), ajustes de stock, kardex e historial de precios; aumentos masivos con vista previa y redondeo. |
| Stock | Matriz producto × sucursal, bajo mínimo, transferencias con recepción y faltantes, reposición sugerida (transferir primero, comprar después). |
| Compras | Pedidos a proveedores (borrador → enviado → recibido), recepción precargada desde el pedido, cuentas a pagar con vencidos y pagos imputados. |
| Clientes | Clientes y proveedores con CUIT validada, promociones (% y 3x2), fidelización (mejores clientes, inactivos, exportación con consentimiento). |
| Empresa | Perfil fiscal y puntos de venta ARCA, sucursales con lista blanca IP, auditoría. |

La navegación se adapta al rol (titular, administración, encargado, cajero, vendedor, depósito, contaduría, consulta),
replicando los permisos del backend. Atajos: <kbd>Ctrl</kbd>+<kbd>K</kbd> buscar pantalla, <kbd>F2</kbd> punto de venta /
buscar producto, <kbd>F4</kbd> nuevo cliente, <kbd>F9</kbd> cobrar.

## Seguridad

- **Access token solo en memoria** (nunca en `localStorage`): un script inyectado no puede robar una sesión persistente.
- **Refresh token en cookie HttpOnly + SameSite=Strict**, renovación automática *single-flight* ante un 401.
- **Mismo origen**: Next.js reenvía `/api/v1/*` al backend, por lo que el navegador no necesita CORS y la cookie viaja sola.
- **Idempotency-Key** estable por operación en ventas, devoluciones, caja, transferencias, recepciones, ajustes y pagos:
  reintentar tras un corte de red no duplica la operación.
- **Cabeceras**: Content-Security-Policy restrictiva, HSTS, `X-Frame-Options: DENY`, `nosniff`, `Referrer-Policy`, `Permissions-Policy`.
- **Redirecciones seguras** tras el login (solo rutas internas) y CSV exportado con protección contra inyección de fórmulas.
- Los certificados de ARCA **nunca** pasan por el frontend: solo se cargan referencias (`file:` / `env:`).

## Puesta en marcha local (paso a paso)

Requisitos: Node.js 20.9 o superior (recomendado 22 LTS), Git y el backend corriendo en `http://localhost:3000`.

```bash
# 1. Clonar y entrar
git clone git@github.com:amayagonzalo86/sistema-comercio-front.git
cd sistema-comercio-front

# 2. Instalar dependencias exactas del lockfile
npm ci

# 3. Variables de entorno (no contienen secretos)
cp .env.example .env.local        # en Windows PowerShell: Copy-Item .env.example .env.local

# 4. Levantar en modo desarrollo (puerto 3001)
npm run dev
```

Abrí <http://localhost:3001> e ingresá con el usuario administrador creado por el seeder del backend.

> En el `.env` del **backend** dejá `ALLOWED_ORIGINS=http://localhost:3001`. Con el proxy de Next.js no es estrictamente
> necesario, pero mantiene la configuración coherente si en algún momento se llama a la API directo.

### Scripts

| Comando | Qué hace |
|---|---|
| `npm run dev` | Servidor de desarrollo con recarga en caliente (puerto 3001). |
| `npm run typecheck` | Verificación de tipos estricta. |
| `npm run lint` | ESLint (reglas de Next.js, React y TypeScript). |
| `npm run build` | Build de producción (`.next/standalone`). |
| `npm start` | Sirve el build de producción en el puerto 3001. |

## Estructura

```
src/
  app/
    login/                 Ingreso (con selección de empresa si el usuario tiene varias)
    (erp)/                 Área autenticada con barra lateral y barra superior
      tablero/ reportes/ ventas/ caja/ comprobantes/ catalogo/ stock/ compras/
      contactos/ marketing/ configuracion/
  components/
    shell/                 Barra lateral, barra superior, paleta de comandos
    ui/                    Superficies, tablas, modales, avisos, estados, letra de comprobante
    charts/                Gráficos SVG sin dependencias (área, barras, mapa de calor)
    forms/                 Buscadores de productos/personas, alta de contactos, renglones de compra
  lib/
    api/                   Cliente HTTP seguro, contratos tipados y endpoints
    auth/                  Sesión y permisos por rol
    hooks/                 Datos, atajos de teclado, debounce, preferencias
    format.ts              Moneda, fechas (hora argentina), CUIT, etiquetas
  styles/globals.scss      Tema Bootstrap y sistema visual
```

## Flujo de trabajo con Git (Gitflow)

```bash
git checkout develop                       # o main si todavía no usás develop
git pull
git checkout -b feature/mi-cambio
# ...cambios...
npm run typecheck && npm run lint && npm run build
git add -A
git commit -m "feat: descripción del cambio"
git push -u origin feature/mi-cambio       # abrir Pull Request; el CI valida tipos, lint, build y auditoría
```

## Despliegue

Ver [docs/despliegue.md](docs/despliegue.md): VPS con Docker + Nginx (mismo dominio para la app y la API), Cloudflare y
variables de entorno.
