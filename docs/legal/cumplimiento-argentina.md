# Cumplimiento normativo para comercializar el ERP en Argentina

> Este documento resume obligaciones legales y fiscales que afectan al producto y cómo las cubre el código.
> No reemplaza el asesoramiento de un contador público y un abogado: validá cada punto antes de vender
> el servicio, porque ARCA y la AAIP actualizan sus normas con frecuencia.

## 1. IVA en ventas

### Qué hace el sistema

| Tema | Regla aplicada | Dónde |
|---|---|---|
| Alícuotas | Solo se aceptan 0 %, 2,5 %, 5 %, 10,5 %, 21 % y 27 %, con sus códigos ARCA de WSFEv1 (3, 9, 8, 4, 5, 6). | `src/modules/fiscal/vat/vat.ts` |
| Productos exentos / no gravados | `vatTreatment = EXEMPT` (art. 7 Ley de IVA) o `NOT_TAXED`. Se informan como importe exento / no gravado y su alícuota queda en 0 (restricción `CHECK` en MySQL). | `PATCH /api/v1/products/:id/vat` |
| Precio con o sin IVA | `priceIncludesVat = true` toma el precio como final y extrae el IVA contenido; `false` suma el IVA al neto. | Producto |
| Clase de comprobante | Emisor RI → **A** a RI y a monotributistas (RG 5003/2021), **B** al resto. Emisor Monotributo/Exento → **C** (sin IVA). Exportación → **E**. | `resolveVoucherClass` |
| Quitar el IVA de una venta | Solo OWNER/ADMIN, con motivo (`EXPORT`, `TIERRA_DEL_FUEGO`, `DIPLOMATIC`, `OTHER_LEGAL`) y respaldo escrito; queda en la venta y en la auditoría. | `POST /api/v1/sales` campo `vatExemption` |
| Leyenda RG 5003/2021 | En comprobantes A a monotributistas se devuelve la leyenda obligatoria sobre el crédito fiscal. | `fiscalNotes.legend` |
| Transparencia fiscal (Ley 27.743, RG 5614/2024) | En comprobantes B se devuelve el bloque "Régimen de Transparencia Fiscal al Consumidor" con el IVA contenido. | `fiscalNotes.fiscalTransparency` |
| Identificación del receptor | CUIT/CUIL validada con dígito verificador; un comprobante A exige CUIT válida del cliente. RI, Monotributo y Exento deben cargarse con CUIT. | `PersonsService`, `SalesService` |
| Precisión | Todo el cálculo usa enteros (centavos) y se cumple `total = neto + IVA + exento + no gravado`. | `computeVatLine` |

La condición frente al IVA del **emisor** se toma del perfil fiscal activo de la empresa (`fiscal_profiles.vat_condition_code`,
por ejemplo `RESPONSABLE_INSCRIPTO` o `MONOTRIBUTO`). Sin perfil, el sistema asume Responsable Inscripto para conservar el
comportamiento anterior: **configurá el perfil fiscal de cada cliente del SaaS antes de usarlo en producción.**

### Ejemplos de uso

```http
PATCH /api/v1/products/{id}/vat
{ "vatTreatment": "TAXED", "taxRate": 10.5, "priceIncludesVat": true, "reason": "Carne vacuna - alícuota reducida" }

PATCH /api/v1/products/{id}/vat
{ "vatTreatment": "EXEMPT", "reason": "Libro - exento art. 7 Ley de IVA" }

POST /api/v1/sales   (Idempotency-Key obligatorio)
{ "branchId": "...", "customerPersonId": "...", "lines": [...], "payments": [...],
  "vatExemption": { "reason": "EXPORT", "note": "Permiso de embarque 26001EC01123456X" } }
```

### Pendiente para emitir comprobantes válidos

Las ventas quedan con `fiscalStatus = NOT_ISSUED`: **todavía no son facturas**. Para emitir facturas electrónicas falta:

1. Adaptador WSAA (autenticación con certificado digital) + WSFEv1 (solicitud de CAE) en homologación.
2. Puntos de venta y numeración correlativa por CUIT / punto de venta / tipo de comprobante, con bloqueo transaccional.
3. Guardar CAE, vencimiento y respuesta de ARCA; generar el PDF con QR obligatorio.
4. Notas de crédito/débito vinculadas al comprobante original.
5. Certificados en un gestor de secretos (el modelo ya guarda solo referencias, nunca el contenido).

Los datos que WSFEv1 necesita ya se guardan: clase de comprobante, neto gravado, IVA por alícuota (`arca_vat_rate_id`),
exento, no gravado y la condición de IVA del receptor.

## 2. Precios al consumidor (Ley 24.240 de Defensa del Consumidor)

Los precios exhibidos a consumidores finales deben ser **precios finales con impuestos incluidos**. Para comercios que venden
a consumidor final, cargá los productos con `priceIncludesVat = true`: así el precio de góndola coincide con el total del ticket
y el sistema discrimina el IVA contenido.

## 3. Protección de datos personales (Ley 25.326)

El ERP guarda datos personales de clientes, proveedores y empleados (nombre, documento, email, teléfono, dirección).
Como proveedor SaaS, tu empresa actúa normalmente como **encargado del tratamiento** y cada cliente como **responsable**.

Obligaciones a cubrir antes de comercializar:

- **Registro**: inscribir las bases de datos en el Registro Nacional de Bases de Datos de la AAIP (lo hace el responsable;
  conviene documentar cómo ayudar a tus clientes).
- **Contrato de encargo de tratamiento** (DPA) con cada cliente: finalidad, medidas de seguridad, confidencialidad,
  prohibición de uso para otros fines y destino de los datos al terminar el contrato.
- **Derechos de los titulares**: acceso (gratuito, en intervalos de 6 meses salvo interés legítimo), rectificación,
  actualización y supresión. Pendiente en el código: endpoints de exportación y anonimización de una persona.
- **Seguridad**: el sistema ya aplica cifrado de contraseñas con Argon2id, control de acceso por empresa y sucursal,
  auditoría de operaciones críticas, límites de intentos de login y lista blanca de IP opcional. Completar con
  respaldos cifrados, cifrado en tránsito (HTTPS obligatorio, `DB_SSL=true` si la base está en otro servidor) y un
  procedimiento escrito de respuesta a incidentes.
- **Transferencia internacional**: elegir el hosting importa. Los países de la Unión Europea están reconocidos con nivel
  adecuado de protección (por ejemplo, Hetzner en Alemania o Finlandia). Si alojás en un país sin esa calificación
  (por ejemplo, regiones de EE. UU.), se requieren cláusulas contractuales específicas o el consentimiento del titular.
- **Minimización**: no se guardan contraseñas, tokens ni certificados en logs ni en la auditoría; las IPs del límite de
  login se guardan como HMAC y se purgan a las 24 h.

## 4. Conservación de registros

El Código Civil y Comercial (art. 328) obliga a conservar la documentación contable por **10 años**, y la normativa
tributaria exige conservar comprobantes y registros mientras no prescriban las facultades de ARCA. Por eso:

- Ventas, ítems, pagos, movimientos de inventario y auditoría **no deben borrarse** físicamente.
- Definir respaldos con retención de 10 años (por ejemplo, volcado diario cifrado en almacenamiento de objetos con
  versionado y política de ciclo de vida) y probar la restauración periódicamente.

## 5. Facturación de tu propio servicio SaaS

- La suscripción al ERP es un servicio gravado: facturarla con el IVA correspondiente según tu condición fiscal.
- Publicar Términos y Condiciones, Política de Privacidad y un acuerdo de nivel de servicio (SLA) con disponibilidad,
  soporte, respaldos y procedimiento de baja/exportación de datos.
- Botón de arrepentimiento: si vendés suscripciones online a consumidores, la normativa de defensa del consumidor exige
  un mecanismo visible para revocar la aceptación.

## 6. Referencias

- ARCA — webservices de factura electrónica: https://www.arca.gob.ar/ws/documentacion/ws-factura-electronica.asp
- RG 5003/2021 (comprobantes A a monotributistas): https://blogdelcontador.com.ar/news-33688-los-responsables-inscriptos-deberan-emitir-comprobantes-clase-a-a-los-monotributistas-a-partir-del-1o-de-julio
- Régimen de Transparencia Fiscal al Consumidor (Ley 27.743 / RG 5614): https://www.iprofesional.com/impuestos/425337-iva-en-facturas-las-claves-del-regimen-que-entra-en-plena-vigencia-el-proximo-martes
- Ley 25.326 de Protección de los Datos Personales: https://www.argentina.gob.ar/normativa/nacional/64790/actualizacion
- OWASP API Security Top 10: https://owasp.org/projects/api-security-project
