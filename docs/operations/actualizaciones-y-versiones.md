# Actualizaciones y versiones

## Ramas y versiones

- `main` es siempre lo que está (o puede estar) en producción.
- Cada cambio va en una rama corta (`feature/…`, `fix/…`, `docs/…`) con su PR; se mezcla cuando pasan
  lint, typecheck, build y e2e.
- Las ramas `tmp/…` son pruebas descartables: **no se mezclan**.
- Versionado semántico con etiquetas: `vMAYOR.MENOR.PARCHE`. MENOR = funciones nuevas; PARCHE = correcciones;
  MAYOR = cambios que exigen acción del cliente.

```bash
git checkout main && git pull
git tag -a v1.8.0 -m "Logo de empresa, equipos autorizados por HTTP"
git push origin v1.8.0
```

Backend y frontend se etiquetan con la misma versión cuando se publican juntos.

## Publicar una versión

1. Avisar a los clientes si hay corte (ventana de mantenimiento: madrugada, 48 h de aviso; ver el contrato).
2. Respaldo verificado de la base ([respaldos-y-restauracion.md](respaldos-y-restauracion.md)).
3. Backend:

   ```bash
   cd /opt/erp/sistema-comercio-back
   git fetch --tags && git checkout v1.8.0
   npm ci
   npm run migration:run          # compila y aplica migraciones pendientes
   pm2 reload erp-api             # o: docker run … con la nueva imagen
   ```

4. Frontend:

   ```bash
   cd /opt/erp/sistema-comercio-front
   git fetch --tags && git checkout v1.8.0
   npm ci
   npm run build
   pm2 reload erp-web
   ```

5. Verificar: `GET /api/v1/health`, ingresar, hacer una venta de prueba en homologación si se tocó la parte fiscal.
6. Publicar las notas de la versión para los clientes (qué cambió, si deben hacer algo).

## Volver atrás

- Sin migraciones nuevas: `git checkout v1.7.2`, `npm ci`, build y `reload`.
- Con migraciones: las migraciones son aditivas siempre que se pueda. Si hay que revertir una,
  `npm run migration:revert` (una por vez) o restaurar el respaldo del paso 2. Decidirlo antes de publicar.

## Dependencias

- `npm audit --omit=dev` en cada PR; las vulnerabilidades altas o críticas se corrigen antes de publicar.
- Actualizar Node.js LTS y las dependencias principales (NestJS, Next.js, TypeORM) una vez por trimestre.
- `npm ci` siempre: instala exactamente el `package-lock.json`. En Windows, si da `EPERM`, cerrar el editor y
  los servidores que usen `node_modules` y repetir.
