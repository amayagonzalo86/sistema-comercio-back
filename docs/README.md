# Documentación de Comercio ERP

Índice de toda la documentación del proyecto. La técnica vive en este repositorio (y en `docs/` del
frontend); la legal y la del cliente están como documentos editables en Claude Docs, porque se completan,
se revisan con un abogado y se envían a clientes.

## Para el cliente y legal (Claude Docs)

| Documento | Para qué |
| --- | --- |
| [Marco legal y cumplimiento](https://claude.ai/artifact/TJPi7hrq5sTnnKKAHB8Dwq) | Normas que aplican al SaaS (Ley 25.326, 11.723, CCyC, 24.240, ARCA) y checklist antes de vender |
| [Contrato de suscripción SaaS](https://claude.ai/artifact/Um5Q6ag2UHTYhACGwXetVq) | Términos, planes, SLA, responsabilidad, baja y salida de datos |
| [Privacidad y tratamiento de datos](https://claude.ai/artifact/QnpXR7r7cXK5XCzJp3KsWb) | Política de privacidad (responsable) y acuerdo de tratamiento (encargado, art. 25) |
| [Manual del cliente](https://claude.ai/artifact/5rzG5QPpf6wgNdLYqm6ZGb) | Puesta en marcha y uso diario, roles, ARCA, WhatsApp IA, preguntas frecuentes |

Los campos `[COMPLETAR: …]` se llenan con los datos reales del proveedor antes de usar los documentos.

## Técnica (este repositorio)

| Área | Documento |
| --- | --- |
| Arquitectura | [Arquitectura objetivo](architecture/erp-argentina.md) · [Modelo de seguridad](architecture/seguridad.md) |
| API | [Guía de la API para el frontend](api/guia-api.md) |
| Referencia | [Variables de entorno](reference/variables-de-entorno.md) |
| Despliegue | [Despliegue seguro y de bajo costo](operations/despliegue-seguro.md) |
| Operación | [Respaldos y restauración](operations/respaldos-y-restauracion.md) · [Actualizaciones y versiones](operations/actualizaciones-y-versiones.md) · [Respuesta a incidentes](operations/respuesta-a-incidentes.md) |
| Funciones | [Alta de ARCA](operations/alta-arca.md) · [Equipos autorizados](operations/equipos-autorizados.md) · [Vendedor IA por WhatsApp](operations/vendedor-ia-whatsapp.md) |
| Normativa en el producto | [Cumplimiento en Argentina (IVA, consumidor, datos)](legal/cumplimiento-argentina.md) |

Frontend: ver `docs/README.md` del repositorio `sistema-comercio-front`.

## Reglas que no se negocian

- Nunca subir `.env`, certificados ni llaves a Git. Los certificados de ARCA se referencian como `file:` o `env:`.
- `npm ci` (no `npm install`) en servidores y CI: instala exactamente el `package-lock.json`.
- Migraciones con `npm run migration:run` después de un respaldo verificado. Nunca recargar
  `base-completa.sql` sobre una base con datos.
- Las acciones del personal de la plataforma dentro de una empresa quedan siempre en la auditoría.
