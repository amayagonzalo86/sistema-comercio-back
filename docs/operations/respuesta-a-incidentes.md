# Respuesta a incidentes

Qué hacer cuando el servicio se cae o hay sospecha de un problema de seguridad. Plazos del contrato:
primera respuesta en 1 hora para severidad 1, y aviso al cliente de un incidente con datos dentro de las
72 horas.

## Severidades

| Severidad | Ejemplo | Respuesta | Avisar a clientes |
| --- | --- | --- | --- |
| 1 — Crítica | Nadie puede ingresar o vender; sospecha de acceso indebido a datos | Inmediata, todo el equipo | Sí, apenas se confirma |
| 2 — Alta | Falla la factura electrónica, un módulo o una sucursal | En 4 h hábiles | Solo a los afectados |
| 3 — Normal | Error menor con alternativa | Planificada | No |

## Pasos

1. **Detectar y registrar.** Abrir una entrada en el registro de incidentes con hora, quién lo detectó y síntoma.
2. **Contener.**
   - Caída: revisar `GET /api/v1/health`, `pm2 logs`/`docker logs`, espacio en disco y MySQL.
   - Seguridad: según el caso, revocar equipos (Plataforma › Equipos autorizados), desactivar usuarios,
     rotar `JWT_ACCESS_SECRET` y `JWT_REFRESH_SECRET` (cierra todas las sesiones), rotar la clave de la base
     y las claves de IA/WhatsApp, activar el modo *Under Attack* de Cloudflare.
3. **Preservar evidencia.** Copiar logs y la tabla `audit_events` del período antes de cambiar nada más.
   No borrar registros.
4. **Corregir y volver a operar.** Aplicar el arreglo o restaurar un respaldo; verificar.
5. **Avisar.**
   - A los clientes afectados, por email, dentro de las 72 horas: qué pasó, qué datos y cuántos titulares
     pueden estar afectados, qué se hizo y un contacto.
   - El cliente (responsable de sus datos) decide si avisa a la AAIP y a sus titulares; AS Informática le
     entrega la información que necesite.
   - Si el incidente afecta datos de los que AS Informática es responsable (usuarios, facturación), evaluar
     el aviso a la AAIP.
6. **Revisión posterior.** En 5 días hábiles: causa raíz, qué se cambia para que no se repita, y cerrar la
   entrada del registro.

## Señales a vigilar

- Logs `warn` «Reutilización de refresh token detectada»: alguien usó un token robado o viejo.
- «Acceso bloqueado por lista blanca IP» repetido.
- Muchos `DEVICE_REGISTERED` de equipos desconocidos en poco tiempo.
- Picos de 401/403/429 en Cloudflare.
- Comprobantes ARCA rechazados en serie (certificado vencido o cambio de ARCA).

## Contactos

| Rol | Nombre | Teléfono |
| --- | --- | --- |
| Responsable técnico | [COMPLETAR] | [COMPLETAR] |
| Respaldo | [COMPLETAR] | [COMPLETAR] |
| Proveedor del servidor | [COMPLETAR] | Panel / soporte |
