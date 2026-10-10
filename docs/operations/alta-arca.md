# Puesta en marcha de la factura electrónica (ARCA)

Pasos para habilitar la facturación de un cliente. Hacelos junto con su contador: requieren la clave fiscal del titular.

## 1. Certificado digital

En el servidor (o en tu PC) generá la clave privada y el pedido de certificado (CSR):

```bash
openssl genrsa -out empresa.key 2048
openssl req -new -key empresa.key -out empresa.csr \
  -subj "/C=AR/O=RAZON SOCIAL SA/CN=erp-sucursales/serialNumber=CUIT 30712345671"
```

- **Homologación (pruebas)**: en ARCA, servicio *WSASS – Autogestión Certificados Homologación*: crear el alias, pegar
  el CSR, descargar el certificado (`empresa.crt`) y autorizar el servicio **wsfe** para ese alias.
- **Producción**: servicio *Administración de Certificados Digitales*: agregar alias con el CSR y descargar el
  certificado. Luego, en *Administrador de Relaciones de Clave Fiscal*, nueva relación → servicio
  **Facturación Electrónica (wsfe)** → representante: el certificado creado.

La clave privada (`empresa.key`) **nunca** se sube a GitHub ni se envía por correo.

## 2. Puntos de venta

En ARCA, *Administración de puntos de venta y domicilios*: dar de alta un punto de venta por sucursal con sistema
**"RECE para aplicativo y web services"**. Anotá el número de cada uno.

## 3. Cargar los secretos en el servidor

Opción A — archivos (recomendado en VPS):

```bash
sudo mkdir -p /etc/erp/arca && sudo cp empresa.crt empresa.key /etc/erp/arca/
sudo chown -R 1000:1000 /etc/erp/arca && sudo chmod 600 /etc/erp/arca/*
# .env:  FISCAL_SECRETS_DIR=/etc/erp/arca
# Docker: agregar  -v /etc/erp/arca:/etc/erp/arca:ro
```

Opción B — variables de entorno (Render/Railway): `ARCA_CERT` y `ARCA_KEY` con el contenido PEM (o en base64).

Definí también `FISCAL_ENCRYPTION_KEY` (32+ caracteres aleatorios) para cifrar el ticket de acceso.

## 4. Configurar en el sistema

```http
PUT /api/v1/fiscal/profile
{ "taxId": "30712345671", "legalName": "RAZON SOCIAL SA", "vatConditionCode": "RESPONSABLE_INSCRIPTO",
  "environment": "HOMOLOGATION", "certificateSecretRef": "file:empresa.crt", "privateKeySecretRef": "file:empresa.key",
  "grossIncomeRegistration": "901-123456-7", "activityStartDate": "2015-03-01", "commercialAddress": "Av. Siempreviva 742, CABA" }

POST /api/v1/fiscal/points-of-sale   { "branchId": "<sucursal>", "number": 3 }      ← una vez por sucursal
GET  /api/v1/fiscal/status                                                         ← debe responder credentials: "OK"
GET  /api/v1/fiscal/receiver-conditions                                            ← tabla oficial de condiciones de IVA
```

## 5. Pruebas en homologación

Emití en homologación al menos: factura A a un RI, factura B a consumidor final sin identificar, factura B con DNI,
nota de crédito de cada una y una venta con producto exento. Verificá con el contador los PDF impresos (datos del
emisor, CAE, vencimiento y QR).

## 6. Pasar a producción

Repetí el perfil con `"environment": "PRODUCTION"` y el certificado de producción, y cargá los puntos de venta de
producción. El sistema guarda por separado la numeración y los tickets de cada ambiente.

## Fuera de alcance por ahora

- Facturas E de exportación (requieren WSFEX).
- Factura de Crédito Electrónica MiPyME (cuando la operación con grandes empresas supera el monto fijado por ARCA).
- Percepciones de Ingresos Brutos y otros tributos en el comprobante (`ImpTrib` se informa en 0).
- Exportación del Libro IVA Digital.
