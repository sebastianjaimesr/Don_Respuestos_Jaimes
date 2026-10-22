# Configuración de servicios externos

Nada de esto es obligatorio para usar el chat web y el panel. Son integraciones opcionales que quedan **preparadas, no simuladas**: sin credenciales reales no funcionan.

## 1. Secreto compartido backend ↔ n8n

Genera un secreto largo y ponlo en **ambos** lados:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

- Backend (`backend/.env`): `WEBHOOK_SECRET=<secreto>`
- n8n (variables de entorno): `DRJ_WEBHOOK_SECRET=<el mismo secreto>`

Cada mensaje entre los dos va firmado con HMAC-SHA256 (ver [API.md](API.md#autenticación)). Si alguien intenta llamar al backend sin la firma, recibe 401.

## 2. n8n

### Variables de entorno de n8n

| Variable | Obligatoria | Para qué |
|---|---|---|
| `NODE_FUNCTION_ALLOW_BUILTIN=crypto` | Sí | Los nodos Code calculan y verifican firmas |
| `N8N_BLOCK_ENV_ACCESS_IN_NODE=false` | Sí | Los workflows leen secretos con `$env` (así no quedan dentro del JSON) |
| `DRJ_API_URL` | Sí | URL del backend, ej. `https://api.tudominio.com` |
| `DRJ_WEBHOOK_SECRET` | Sí | Igual a `WEBHOOK_SECRET` del backend |
| `DRJ_AVISO_ASESOR_URL` | No | Webhook entrante de Slack / Discord / Google Chat para avisar a los asesores |
| `WHATSAPP_*`, `TELEGRAM_*` | Según canal | Ver abajo |

> Si tu n8n es n8n Cloud y no permite `$env`, reemplaza esas expresiones por **Credentials** o **Variables** de n8n. Nunca pegues secretos dentro del JSON del workflow.

### Importar los workflows

En n8n: **Workflows → Import from file** → elige los archivos de `n8n/workflows/`:

| Archivo | Qué hace |
|---|---|
| `01-mensaje-entrante-generico.json` | Webhook `POST /webhook/drj/mensaje` → backend → responde. Sirve para cualquier canal o para probar con curl |
| `02-notificar-asesor.json` | Recibe el aviso de escalamiento del backend y avisa a los asesores |
| `03-whatsapp-cloud-api.json` | Webhook de Meta (verificación GET + mensajes POST) → backend → responde por WhatsApp |
| `04-telegram.json` | Webhook de Telegram → backend → responde por Telegram |
| `05-mensaje-asesor-saliente.json` | Cuando un asesor responde desde el panel, entrega el mensaje por WhatsApp o Telegram |
| `06-registro-errores.json` | Error workflow: guarda en el backend los fallos de cualquier flujo |

Después de importar:
1. Activa (publica) los workflows que vayas a usar **y también el 06**: en n8n 2.x un workflow de errores inactivo no se ejecuta.
2. Los workflows 01 a 05 ya traen configurado el 06 como *Error workflow* (Settings → Error workflow).
3. En `backend/.env`:
   - `N8N_NOTIFICACION_URL=https://TU-N8N/webhook/drj/escalamiento`
   - `N8N_SALIENTE_URL=https://TU-N8N/webhook/drj/saliente`
4. Reinicia el backend.

Los webhooks que llama el backend (02 y 05) deben responder `{"recibido": true}`; si n8n responde otra cosa (por ejemplo, 200 vacío porque el flujo falló), el backend NO marca el aviso como entregado. Los flujos incluidos ya responden así.

**Probado:** los workflows 01, 02, 05 y 06 se importaron y ejecutaron contra el backend real en n8n 2.35.7. Los 03 (WhatsApp) y 04 (Telegram) se importaron sin errores, pero no se pudieron probar de punta a punta porque requieren cuentas reales de Meta y Telegram.

Los workflows se generan con `python3 n8n/generar_workflows.py`. Si cambias algo, edita ese script y vuelve a generarlos (así el cambio queda versionado en git).

### Probar el flujo 01 con curl

```bash
curl -X POST https://TU-N8N/webhook/drj/mensaje \
  -H 'content-type: application/json' \
  -d '{"canal":"otro","canal_usuario_id":"prueba-1","texto":"pastillas delanteras fz 2.0 2018"}'
```

### ¿Dónde se identifica la intención?

En el **backend** (motor del asistente), no en n8n. Los pasos 2 a 7 del flujo de referencia (intención, modelo/año/repuesto, inventario, formato, cotización, pedido) los hace el backend; n8n solo recibe, firma, reenvía y entrega. Así el comportamiento es idéntico en web, WhatsApp y Telegram, y se prueba con las pruebas automatizadas.

## 3. WhatsApp Cloud API (Meta)

Necesitas: cuenta de Meta Business verificada, una app en developers.facebook.com con el producto WhatsApp y un número de teléfono registrado.

1. En la app de Meta → WhatsApp → Configuración:
   - URL de devolución de llamada: `https://TU-N8N/webhook/drj/whatsapp`
   - Token de verificación: inventa uno y ponlo en `WHATSAPP_VERIFY_TOKEN`.
   - Suscríbete al campo `messages`.
2. Variables en n8n:
   - `WHATSAPP_TOKEN`: token de acceso permanente (usuario del sistema).
   - `WHATSAPP_PHONE_NUMBER_ID`: ID del número.
   - `WHATSAPP_APP_SECRET`: secreto de la app (para verificar `X-Hub-Signature-256`).
3. Activa el workflow 03.

Límites a tener en cuenta: fuera de la ventana de 24 horas desde el último mensaje del cliente, Meta exige **plantillas aprobadas**; las conversaciones tienen costo según la tarifa vigente de Meta para Colombia. Revisa ambos puntos en la documentación oficial antes de lanzar.

## 4. Telegram

1. Crea el bot con **@BotFather** → guarda el token en `TELEGRAM_BOT_TOKEN`.
2. Inventa un secreto y guárdalo en `TELEGRAM_WEBHOOK_SECRET`.
3. Registra el webhook (una sola vez):
   ```
   https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://TU-N8N/webhook/drj/telegram&secret_token=<SECRETO>
   ```
4. Activa el workflow 04.

## 5. Avisos a los asesores

El workflow 02 envía `{ "text": "...", "content": "..." }` a `DRJ_AVISO_ASESOR_URL`. Eso es compatible con webhooks entrantes de Slack (`text`), Discord (`content`) y Google Chat (`text`). Si prefieres correo o un grupo de WhatsApp, cambia el nodo **Enviar aviso** por el nodo correspondiente de n8n.

Si no configuras nada, las solicitudes igual quedan en **Panel → Atención humana** y el asistente le dice al cliente que su solicitud quedó registrada (sin prometer tiempos).

## 6. (Futuro) Un modelo de lenguaje para entender mejor el texto

La v1 entiende el texto con reglas (rápido, gratis y verificable). Si más adelante quieres un LLM para frases muy libres, la forma segura es usarlo **solo para extraer** modelo, año, repuesto e intención, y seguir llamando a las mismas herramientas (`buscar_repuesto`, `registrar_pedido`, `escalar_a_humano`) para los datos. El LLM nunca debe ser la fuente de precios, stock o compatibilidad.
