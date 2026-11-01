# Vendedor IA por WhatsApp (módulo premium `AI_SALES`)

Un asistente atiende el WhatsApp de la empresa: busca productos con precio y stock reales, ofrece solo las
promociones vigentes, cotiza (total, total en efectivo y cuotas con tarjeta del día), registra al cliente,
acuerda la forma de pago y la entrega (retiro o envío, con comentarios de flete/horario) y confirma un
**pedido de venta** que aparece en la cola de caja con la etiqueta «WhatsApp IA».

- No inventa precios ni descuentos: todo sale del mismo motor de precios que la caja.
- Si el cliente pide un descuento especial, hace un reclamo o algo que no puede resolver, **deriva a una persona**.
  Desde el panel *Ventas › WhatsApp IA* una persona responde por el mismo WhatsApp y puede devolverle la
  conversación al asistente.
- Cambia solo de proveedor de IA cuando uno se queda sin crédito, limita peticiones o no responde
  (Anthropic → OpenAI → Gemini, configurable). Si fallan todos, avisa al cliente y deriva a una persona.

## 1. Servidor (`.env`)

```dotenv
ANTHROPIC_API_KEY=sk-ant-...
OPENAI_API_KEY=sk-...
GEMINI_API_KEY=...
AI_PROVIDER_ORDER=anthropic,openai,gemini

WHATSAPP_VERIFY_TOKEN=un-texto-largo-que-inventes
WHATSAPP_APP_SECRET=el-app-secret-de-meta
```

Con una sola clave de IA funciona igual (sin respaldo). Reiniciá la API después de cambiar el `.env`.

## 2. Meta (WhatsApp Cloud API)

1. En <https://developers.facebook.com> creá una app de tipo **Empresa** y agregá el producto **WhatsApp**.
2. En *WhatsApp › Configuración de la API* anotá el **Phone number ID** del número (no es el teléfono).
3. Generá un **token permanente** con un usuario del sistema (Business Settings › Usuarios del sistema)
   con los permisos `whatsapp_business_messaging` y `whatsapp_business_management`.
4. En *WhatsApp › Configuración › Webhook*:
   - URL de devolución de llamada: `https://TU-DOMINIO/api/v1/ai-sales/webhook`
   - Token de verificación: el mismo valor de `WHATSAPP_VERIFY_TOKEN`.
   - Suscribite al campo **messages**.
5. En *Configuración básica* copiá el **App Secret** a `WHATSAPP_APP_SECRET`.

Si usás Cloudflare, dejá pasar `POST /api/v1/ai-sales/webhook` (sin desafío de navegador): cada mensaje
viene firmado (`X-Hub-Signature-256`) y la API rechaza los que no tienen la firma correcta.

## 3. Activación por empresa

1. El operador de la plataforma activa el módulo: *Plataforma › Empresas › Módulos › Vendedor IA por WhatsApp*.
2. Un administrador de la empresa abre *Ventas › WhatsApp IA › Configuración* y carga: Phone number ID,
   teléfono visible, token (se guarda cifrado y nunca se vuelve a mostrar), nombre del asistente, saludo,
   **información del local** (horarios, zonas y costos de envío/flete, retiro), sucursal, usuario que figura
   como vendedor de los pedidos, medios de pago y límite diario de respuestas.
3. Probá con **«Probar el asistente»** (simulador: mismas herramientas y precios, sin enviar WhatsApp).
4. Activá el asistente.

## 4. Costos

Cada respuesta usa unos pocos miles de tokens (modelos rápidos por defecto). El panel muestra el consumo por
proveedor y el límite diario corta el gasto: al alcanzarlo, las conversaciones pasan a una persona.
Las respuestas dentro de la ventana de atención de 24 h que abre el cliente no se cobran como plantilla según la tarifa de Meta (verificá la tarifa vigente en tu cuenta).
