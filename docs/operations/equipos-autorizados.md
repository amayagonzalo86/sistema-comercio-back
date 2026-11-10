# Equipos autorizados

Permite que solo las computadoras aprobadas ingresen a una empresa, sin IP fija ni VPN y sin costo.

## Cómo funciona

- **HTTPS o `localhost`:** el navegador crea una llave ECDSA P-256 que no se puede exportar (WebCrypto,
  guardada en IndexedDB) y firma un desafío del servidor en cada ingreso. El servidor guarda solo la
  llave pública y su huella.
- **HTTP en la red local:** WebCrypto no está disponible; el navegador guarda un token aleatorio de equipo
  y el servidor guarda solo `sha256('device-token:' + token)`.
- El código que se muestra (`7F3A-91C2`) son los primeros 8 caracteres de la huella: sirve para reconocer el
  equipo en el panel.

| Estado | Ingresa | Cómo se llega |
| --- | --- | --- |
| `PENDING` | No (si se exige) | Primer ingreso del equipo |
| `APPROVED` | Sí | El super administrador lo aprueba |
| `REVOKED` | No | El super administrador lo revoca; la sesión abierta se corta en la siguiente petición |

Los operadores de la plataforma están exentos para no quedar fuera del sistema.

## Activar en una empresa

1. Plataforma › **Equipos autorizados** › elegir la empresa.
2. Activar **Exigir equipos autorizados**. Se puede activar aunque no haya equipos aprobados: cada PC queda
   bloqueada con su código hasta aprobarla.
3. En cada PC: ingresar, anotar el código que aparece y aprobarlo en el panel. Ponerle un nombre
   («Caja 1 Centro»).

Todo queda en la auditoría: `DEVICE_REGISTERED`, `DEVICE_APPROVED`, `DEVICE_REVOKED`, `DEVICE_RENAMED`,
`DEVICE_APPROVAL_ENABLED` / `DISABLED`.

## Problemas frecuentes

| Síntoma | Causa | Solución |
| --- | --- | --- |
| Una PC aprobada vuelve a pedir aprobación | Se borraron los datos del sitio, cambió de navegador o de dirección (http ↔ https, IP ↔ dominio) | Aprobar el nuevo código y revocar el viejo |
| «No se pudo verificar este equipo» | Navegador en modo privado o bloqueo de almacenamiento | Usar una ventana normal; permitir datos del sitio |
| El super administrador quedó fuera | No debería pasar (operadores exentos) | Revisar que su usuario sea operador de la plataforma |

Para acceso desde fuera del local, usar el dominio con HTTPS detrás de Cloudflare: es más seguro que el
token sobre HTTP.
