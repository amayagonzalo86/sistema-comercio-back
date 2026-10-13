# Datos de demostración

## Opción rápida: `base-completa.sql` (todo en un archivo)

Crea la base `sistema_comercio`, **todas las tablas**, el usuario administrador y los datos demo.
No hace falta `npm run seed` ni arrancar la API antes. **Borra y recrea todas las tablas.**

```powershell
mysql -u root -p --default-character-set=utf8mb4 -e "source database/demo/base-completa.sql"
```

Ingreso: usuario `admin`, contraseña `Admin-Comercio-2026!` (cambiala después de entrar).
Para regenerarlo cuando cambien las entidades: esquema con `synchronize` + `npm run seed` + `datos-demo.sql`,
y volcado con `mysqldump` (esquema, tablas del administrador y luego `datos-demo.sql`).

## Opción sobre una base existente: `datos-demo.sql`

`datos-demo.sql` carga la empresa ficticia **Almacenes del Centro SRL** para probar el frontend:
4 locales + depósito, 37 productos, 32 clientes, 4 proveedores, ~3.700 ventas de los últimos 90 días,
cajas abiertas hoy, pedidos de compra, deuda con proveedores (una vencida), transferencias, promociones y
**preventa**: pedidos de venta cobrados en caja (Casa Central y Nueva Córdoba), 4 esperando cobro hoy y uno anulado.

```bash
# 1. Esquema: arrancar la API una vez en desarrollo (synchronize) y detenerla
npm run start:dev
# 2. Usuario administrador (requiere ADMIN_BOOTSTRAP_PASSWORD en .env)
npm run seed
# 3. Datos demo
mysql -u erp_app -p sistema_comercio < database/demo/datos-demo.sql
```

- Ingresás con el **mismo usuario administrador** (operador de la plataforma, con acceso a la empresa demo).
  Es invisible para la empresa: `demo.titular` no lo ve en Empleados y en la auditoría sus acciones figuran como
  "Soporte de la plataforma".
- Usuarios por rol con la misma contraseña: `demo.titular` (dueño de la empresa), `demo.encargado`, `demo.cajero`, `demo.vendedor`, `demo.vendedora`, `demo.deposito`, `demo.contador`.
  `demo.cajero` tiene **dos roles** (Caja + Depósito): cobra y también recibe mercadería.
- Empleados: como titular o administración, en **Empresa → Empleados** das de alta personas con uno o más roles,
  editás sus datos, les cambiás la contraseña o los desactivás.
- Para probar la preventa: ingresá como `demo.vendedora` (Casa Central), armá un pedido en el punto de venta y anotá el número;
  después ingresá como `demo.cajero` y cobralo desde **Pedidos de venta** o con **Cargar pedido** en el punto de venta.
- Es re-ejecutable: borra la empresa demo y la vuelve a crear con fechas relativas a hoy.
- Para regenerar el archivo: `python3 database/demo/generar_datos_demo.py`.
- **No ejecutar en producción.**
