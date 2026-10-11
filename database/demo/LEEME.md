# Datos de demostración

`datos-demo.sql` carga la empresa ficticia **Almacenes del Centro SRL** para probar el frontend:
4 locales + depósito, 37 productos, 32 clientes, 4 proveedores, ~3.700 ventas de los últimos 90 días,
cajas abiertas hoy, pedidos de compra, deuda con proveedores (una vencida), transferencias y promociones.

```bash
# 1. Esquema: arrancar la API una vez en desarrollo (synchronize) y detenerla
npm run start:dev
# 2. Usuario administrador (requiere ADMIN_BOOTSTRAP_PASSWORD en .env)
npm run seed
# 3. Datos demo
mysql -u erp_app -p sistema_comercio < database/demo/datos-demo.sql
```

- Ingresás con el **mismo usuario administrador** (queda como titular de la empresa demo).
- Usuarios por rol con la misma contraseña: `demo.encargado`, `demo.cajero`, `demo.vendedor`, `demo.deposito`, `demo.contador`.
- Es re-ejecutable: borra la empresa demo y la vuelve a crear con fechas relativas a hoy.
- Para regenerar el archivo: `python3 database/demo/generar_datos_demo.py`.
- **No ejecutar en producción.**
