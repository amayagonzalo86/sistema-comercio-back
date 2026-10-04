# Arquitectura objetivo del ERP

## Objetivo y alcance

Construir un ERP comercial SaaS multiempresa para operar en Argentina. Cada cliente (tenant) debe poder administrar sus sucursales, usuarios, catálogo, inventario, ventas, compras, caja y configuración fiscal con aislamiento verificable entre empresas.

La aplicación se mantiene como monolito modular mientras el producto y la carga lo permitan. Separar servicios antes de medir cuellos de botella elevaría el costo operativo sin aportar aislamiento por sí mismo.

## Fundamentos incorporados en esta etapa

La migración `1791000000000-CreateSaasCore` agrega:

- `tenants`: organización, estado, moneda y zona horaria.
- `tenant_memberships`: relación usuario-empresa con un rol dentro de esa empresa.
- `audit_events`: eventos de auditoría indexados por empresa, fecha, recurso y request.
- `fiscal_profiles`: CUIT, condición IVA, inscripción de IIBB y ambiente ARCA. Certificados y claves se guardan como referencias a un gestor de secretos, nunca como contenido.

La siguiente etapa de implementación añade guard de membresía activa y rol vigente, alta de empresas por operador de plataforma, empresa heredada para los datos existentes, y `tenant_id` en sucursales, productos, stock por sucursal, listas de precios y personas. El login selecciona la membresía más antigua cuando no recibe `tenantId`; `GET /api/v1/auth/tenants` permite consultar las empresas activas propias y volver a iniciar sesión seleccionando el `tenantId` deseado. Esto reduce el riesgo en esos módulos, pero aún no prueba el aislamiento de toda la API ni constituye una liberación de producción.

## Decisiones que deben guiar el desarrollo

### Aislamiento de empresas

- El tenant activo se resuelve desde una membresía vigente del usuario autenticado; no se acepta como confiable un `tenantId` enviado por el cliente.
- Toda consulta y modificación de datos comerciales debe filtrar por tenant. Las claves únicas de negocio deben incorporar tenant cuando corresponda.
- Las relaciones entre registros de negocio deben impedir referencias cruzadas entre tenants.
- Cada sucursal debe pertenecer a un tenant y la autorización debe comprobar también el alcance por sucursal.
- Las pruebas de autorización deben intentar leer, modificar y borrar IDs de otra empresa.

### Seguridad y privacidad

- Aplicar controles verificables contra riesgos de autorización, autenticación, configuración, consumo de recursos y manejo de API tomando como referencia OWASP API Security Top 10.
- No registrar contraseñas, tokens, claves, certificados ni cuerpos de request completos en `audit_events` o logs.
- La auditoría debe escribirse desde los casos de uso críticos y conservar actor, tenant, recurso, fecha y request correlacionables. La inmutabilidad y retención deberán imponerse con permisos y políticas de base de datos.
- Definir minimización, acceso, rectificación, retención y eliminación de datos personales conforme al marco argentino de protección de datos. Revisar esos flujos con asesoría legal antes de comercializar.
- Aplicar MFA para administradores, sesiones revocables por dispositivo, rate limits por usuario/IP, secretos rotables y respuestas sin información sensible.

### Operaciones concurrentes

- Usar transacciones, claves idempotentes y restricciones de base de datos para operaciones que cobran, emiten comprobantes o modifican existencias.
- El inventario se modelará con movimientos inmutables y un saldo materializado actualizado atómicamente; no se permiten actualizaciones de stock sin movimiento asociado.
- Evitar listas sin paginación y consultas N+1; indexar filtros reales por tenant, sucursal y fecha.
- Mantener la API sin estado para permitir réplicas horizontales. Para tareas lentas o reintentos se necesitarán cola y patrón outbox, con límites de conexiones y métricas.
- Validar con pruebas de carga los objetivos de concurrencia y latencia antes de elegir infraestructura o prometer capacidad.

## Hoja de ruta técnica

1. **Aislamiento y acceso**: extender filtros por tenant a todos los módulos (incluyendo compras, ventas, caja y reportes); garantizar relaciones compuestas entre tenant y sucursal/producto/persona; habilitar cambio de empresa con reemisión de sesión; agregar auditoría en altas, cambios de permisos, catálogo y operaciones; probar acceso cruzado entre empresas. La migración actual puede requerir depuración previa si encuentra códigos de sucursal o asociaciones de producto/sucursal duplicados.
2. **Operación comercial**: integrar el libro actual con compras, ventas, transferencias, devoluciones y comprobantes internos; construir caja, pagos y notas de crédito; aplicar la misma atomicidad e idempotencia en cada flujo.
3. **Fiscal Argentina**: puntos de venta, tipos de comprobante, numeración fiscal serializada por CUIT/punto/tipo, CAE/CAEA y almacenamiento de respuesta. Implementar adaptadores y homologar con ARCA antes de producción; seleccionar WSFEv1 o WSMTXCA según el detalle exigido por la operación.
4. **Seguridad operativa**: MFA, recuperación segura, rotación de refresh por sesión, protección de secretos, respaldos cifrados con pruebas de restauración, alertas y respuesta a incidentes.
5. **SaaS y monetización**: planes, límites por plan, suscripciones, medición de uso, facturación del servicio y proceso de alta/baja. Integrar el medio de pago luego de definir modelo comercial y proveedor.
6. **Liberación**: CI con lint/build/migraciones, pruebas de autorización entre tenants, pruebas de integración fiscal, carga, revisión de seguridad y despliegue progresivo. `synchronize` debe mantenerse desactivado en producción; las migraciones deben ejecutarse sobre un respaldo verificado.

## Referencias de trabajo

- [Documentación de webservices de factura electrónica ARCA](https://www.arca.gob.ar/ws/documentacion/ws-factura-electronica.asp).
- [Ley 25.326 de Protección de los Datos Personales](https://www.argentina.gob.ar/normativa/nacional/64790/actualizacion).
- [OWASP API Security Top 10](https://owasp.org/projects/api-security-project).
