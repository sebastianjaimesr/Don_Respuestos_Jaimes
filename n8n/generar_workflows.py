"""
Genera los workflows de n8n (JSON importables) de Don Repuestos Jaimes.
Ejecuta:  python3 n8n/generar_workflows.py
Los secretos NUNCA van en el JSON: se leen de variables de entorno de n8n ($env).
"""
import json, uuid, pathlib

SALIDA = pathlib.Path(__file__).parent / "workflows"
SALIDA.mkdir(exist_ok=True)

def nodo(nombre, tipo, version, pos, params, **extra):
    return {"id": str(uuid.uuid5(uuid.NAMESPACE_DNS, nombre + tipo)), "name": nombre, "type": tipo,
            "typeVersion": version, "position": pos, "parameters": params, **extra}

def codigo(nombre, pos, js, **extra):
    return nodo(nombre, "n8n-nodes-base.code", 2, pos, {"jsCode": js.strip()}, **extra)

def webhook(nombre, pos, ruta, metodo="POST", modo="responseNode", raw=False):
    p = {"httpMethod": metodo, "path": ruta, "responseMode": modo, "options": {"rawBody": True} if raw else {}}
    return nodo(nombre, "n8n-nodes-base.webhook", 2, pos, p, webhookId=str(uuid.uuid5(uuid.NAMESPACE_URL, ruta + metodo)))

def responder(nombre, pos, cuerpo="={{ JSON.stringify($json) }}", codigo_http=200):
    return nodo(nombre, "n8n-nodes-base.respondToWebhook", 1.1, pos,
                {"respondWith": "text", "responseBody": cuerpo,
                 "options": {"responseCode": codigo_http, "responseHeaders": {"entries": [{"name": "content-type", "value": "application/json"}]}}})

def http_firmado(nombre, pos, ruta_api):
    """POST al backend con el cuerpo crudo y la firma HMAC calculada en el nodo anterior."""
    return nodo(nombre, "n8n-nodes-base.httpRequest", 4.2, pos, {
        "method": "POST",
        "url": "={{ $env.DRJ_API_URL }}" + ruta_api,
        "sendHeaders": True,
        "headerParameters": {"parameters": [
            {"name": "x-drj-timestamp", "value": "={{ $json.ts }}"},
            {"name": "x-drj-firma", "value": "={{ $json.firma }}"}]},
        "sendBody": True, "contentType": "raw", "rawContentType": "application/json", "body": "={{ $json.cuerpo }}",
        "options": {"timeout": 20000}}, onError="continueErrorOutput")

def http_json(nombre, pos, url, cuerpo_js, headers=None):
    p = {"method": "POST", "url": url, "sendBody": True, "specifyBody": "json", "jsonBody": cuerpo_js, "options": {"timeout": 15000}}
    if headers:
        p["sendHeaders"] = True
        p["headerParameters"] = {"parameters": [{"name": k, "value": v} for k, v in headers.items()]}
    return nodo(nombre, "n8n-nodes-base.httpRequest", 4.2, pos, p, onError="continueErrorOutput")

def conectar(*pares):
    c = {}
    for origen, destino, *salida in pares:
        idx = salida[0] if salida else 0
        main = c.setdefault(origen, {"main": []})["main"]
        while len(main) <= idx:
            main.append([])
        main[idx].append({"node": destino, "type": "main", "index": 0})
    return c

ARCHIVO_ERRORES = "06-registro-errores.json"

def id_workflow(archivo):
    # id estable (n8n lo exige al importar y lo usa para enlazar el workflow de errores)
    return "drj" + uuid.uuid5(uuid.NAMESPACE_DNS, archivo).hex[:13]

def guardar(archivo, nombre, nodos, conexiones, notas):
    nota = nodo("Notas", "n8n-nodes-base.stickyNote", 1, [-420, -260],
                {"content": notas.strip(), "height": 420, "width": 380})
    wf_id = id_workflow(archivo)
    wf = {"id": wf_id, "name": nombre, "nodes": [nota] + nodos, "connections": conexiones, "active": False,
          "settings": {"executionOrder": "v1", **({} if archivo == ARCHIVO_ERRORES else {"errorWorkflow": id_workflow(ARCHIVO_ERRORES)})}, "meta": {"generadoPor": "n8n/generar_workflows.py"}}
    (SALIDA / archivo).write_text(json.dumps(wf, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print("✔", archivo)

FIRMAR = """
// Firma HMAC-SHA256: firma = HMAC(DRJ_WEBHOOK_SECRET, `${ts}.${cuerpo}`)
// Requiere NODE_FUNCTION_ALLOW_BUILTIN=crypto en el entorno de n8n.
const crypto = require('crypto');
const secreto = $env.DRJ_WEBHOOK_SECRET;
if (!secreto) throw new Error('Falta la variable DRJ_WEBHOOK_SECRET en n8n');
return items.map((item) => {
  const cuerpo = JSON.stringify(item.json.payload);
  const ts = Math.floor(Date.now() / 1000).toString();
  const firma = crypto.createHmac('sha256', secreto).update(`${ts}.${cuerpo}`).digest('hex');
  return { json: { ...item.json, cuerpo, ts, firma } };
});
"""

VERIFICAR_DRJ = """
// Verifica que la solicitud venga del backend de Don Repuestos Jaimes.
const crypto = require('crypto');
const secreto = $env.DRJ_WEBHOOK_SECRET;
const h = $json.headers || {};
const ts = String(h['x-drj-timestamp'] || '');
const firma = String(h['x-drj-firma'] || '');
const raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');
const esperada = crypto.createHmac('sha256', secreto).update(`${ts}.${raw}`).digest('hex');
const vigente = Math.abs(Date.now() / 1000 - Number(ts)) < 300;
const valida = vigente && firma.length === esperada.length && crypto.timingSafeEqual(Buffer.from(firma), Buffer.from(esperada));
if (!valida) throw new Error('Firma inválida: solicitud rechazada');
return [{ json: JSON.parse(raw) }];
"""

# ---------------------------------------------------------------------
# 01 — Mensaje entrante genérico (cualquier canal que pueda llamar un webhook)
# ---------------------------------------------------------------------
guardar("01-mensaje-entrante-generico.json", "DRJ 01 · Mensaje entrante (genérico)", [
    webhook("Recibir mensaje", [0, 0], "drj/mensaje"),
    codigo("Validar", [220, 0], """
// Entrada esperada: { "canal": "whatsapp"|"telegram"|"otro", "canal_usuario_id": "...", "texto": "..." }
const b = $json.body || {};
const canal = ['whatsapp', 'telegram', 'otro'].includes(b.canal) ? b.canal : 'otro';
const usuario = String(b.canal_usuario_id || '').slice(0, 120);
const texto = String(b.texto || '').slice(0, 1000);
if (!usuario || !texto) throw new Error('Faltan canal_usuario_id o texto');
return [{ json: { payload: { canal, canal_usuario_id: usuario, texto } } }];
"""),
    codigo("Firmar", [330, 0], FIRMAR),
    http_firmado("Asistente (backend)", [480, 0], "/api/integraciones/mensaje"),
    codigo("Formatear respuesta", [660, -80], """
const d = $json.data || {};
return [{ json: { ok: true, conversacion_id: d.conversacion_id, asesor_atendiendo: d.asesor_atendiendo, texto_respuesta: d.texto_respuesta, respuestas: d.respuestas } }];
"""),
    responder("Responder", [880, -80]),
    responder("Responder error", [660, 120],
              '={{ JSON.stringify({ ok: false, texto_respuesta: "Tuvimos un problema técnico. Intenta de nuevo en un momento, por favor." }) }}', 502),
], conectar(("Recibir mensaje", "Validar"), ("Validar", "Firmar"), ("Firmar", "Asistente (backend)"),
            ("Asistente (backend)", "Formatear respuesta"), ("Asistente (backend)", "Responder error", 1),
            ("Formatear respuesta", "Responder")), """
## DRJ 01 · Mensaje entrante genérico
Cliente → canal → **este webhook** → backend → respuesta.

**Entrada (POST /webhook/drj/mensaje):**
`{ "canal": "whatsapp", "canal_usuario_id": "573001234567", "texto": "pastillas fz 2.0 2018" }`

**Salida:** `{ ok, conversacion_id, asesor_atendiendo, texto_respuesta, respuestas[] }`

La intención, el modelo, el año y el repuesto los identifica el backend (no n8n), así la lógica es la misma en todos los canales.

Variables: DRJ_API_URL, DRJ_WEBHOOK_SECRET.
""")

# ---------------------------------------------------------------------
# 02 — Notificar a un asesor cuando el asistente escala
# ---------------------------------------------------------------------
guardar("02-notificar-asesor.json", "DRJ 02 · Notificar asesor (escalamiento)", [
    webhook("Escalamiento creado", [0, 0], "drj/escalamiento", raw=True),
    codigo("Verificar firma", [220, 0], VERIFICAR_DRJ),
    codigo("Preparar aviso", [440, 0], """
// Si no hay canal de aviso configurado, se detiene aquí (la solicitud ya quedó en el panel).
if (!$env.DRJ_AVISO_ASESOR_URL) return [];
const e = $json;
const texto = `🔔 Don Repuestos Jaimes: solicitud de atención #${e.transferencia_id}\\nMotivo: ${e.motivo}${e.detalle ? '\\nDetalle: ' + e.detalle : ''}\\nRevísala en el panel → Atención humana.`;
return [{ json: { text: texto, content: texto } }];
"""),
    http_json("Enviar aviso", [660, 0], "={{ $env.DRJ_AVISO_ASESOR_URL }}", "={{ JSON.stringify($json) }}"),
    responder("Responder OK", [440, 200], '={{ JSON.stringify({ recibido: true }) }}'),
], conectar(("Escalamiento creado", "Verificar firma"), ("Verificar firma", "Responder OK"), ("Verificar firma", "Preparar aviso"),
            ("Preparar aviso", "Enviar aviso")), """
## DRJ 02 · Notificar asesor
El backend llama este webhook (N8N_NOTIFICACION_URL) cuando el asistente escala una conversación.

**Entrada (firmada):** `{ evento: "escalamiento_creado", transferencia_id, motivo, detalle, conversacion_id, creado }`

**Aviso:** se envía `{ text, content }` a DRJ_AVISO_ASESOR_URL (webhook entrante de Slack, Discord, Google Chat o un bot propio). Si está vacía, no se envía nada y la solicitud queda pendiente en el panel.

Variables: DRJ_WEBHOOK_SECRET, DRJ_AVISO_ASESOR_URL (opcional).
""")

# ---------------------------------------------------------------------
# 03 — WhatsApp Cloud API (Meta)
# ---------------------------------------------------------------------
guardar("03-whatsapp-cloud-api.json", "DRJ 03 · WhatsApp Cloud API", [
    webhook("Verificación Meta (GET)", [0, -200], "drj/whatsapp", metodo="GET"),
    codigo("Validar token", [220, -200], """
const q = $json.query || {};
if (q['hub.mode'] !== 'subscribe' || q['hub.verify_token'] !== $env.WHATSAPP_VERIFY_TOKEN) throw new Error('Token de verificación inválido');
return [{ json: { challenge: String(q['hub.challenge'] || '') } }];
"""),
    responder("Devolver challenge", [440, -200], "={{ $json.challenge }}"),
    webhook("Mensaje WhatsApp (POST)", [0, 60], "drj/whatsapp", modo="onReceived", raw=True),
    codigo("Verificar firma Meta y extraer", [220, 60], """
// Meta firma cada evento con X-Hub-Signature-256 = sha256=HMAC(APP_SECRET, cuerpo)
const crypto = require('crypto');
const raw = (await this.helpers.getBinaryDataBuffer(0, 'data')).toString('utf8');
const recibida = String(($json.headers || {})['x-hub-signature-256'] || '');
const esperada = 'sha256=' + crypto.createHmac('sha256', $env.WHATSAPP_APP_SECRET).update(raw).digest('hex');
if (recibida.length !== esperada.length || !crypto.timingSafeEqual(Buffer.from(recibida), Buffer.from(esperada))) throw new Error('Firma de Meta inválida');
const body = JSON.parse(raw);
const salida = [];
for (const entry of body.entry || []) for (const ch of entry.changes || []) for (const m of (ch.value && ch.value.messages) || []) {
  // Solo texto en esta versión; otros tipos se responden con una indicación
  const texto = m.type === 'text' ? m.text.body : '[El cliente envió un archivo o audio]';
  salida.push({ json: { de: m.from, payload: { canal: 'whatsapp', canal_usuario_id: m.from, texto } } });
}
return salida; // vacío = notificación de estado (entregado/leído), no hay nada que responder
"""),
    codigo("Firmar", [440, 60], FIRMAR),
    http_firmado("Asistente (backend)", [660, 60], "/api/integraciones/mensaje"),
    codigo("¿Hay respuesta?", [880, 0], """
// Si un asesor está atendiendo, el asistente no responde (texto vacío).
const de = $('Firmar').item.json.de;
const t = ($json.data && $json.data.texto_respuesta) || '';
return t ? [{ json: { de, texto: t.slice(0, 4000) } }] : [];
"""),
    http_json("Enviar por WhatsApp", [1100, 0],
              "=https://graph.facebook.com/v21.0/{{ $env.WHATSAPP_PHONE_NUMBER_ID }}/messages",
              "={{ JSON.stringify({ messaging_product: 'whatsapp', to: $json.de, type: 'text', text: { body: $json.texto } }) }}",
              {"Authorization": "=Bearer {{ $env.WHATSAPP_TOKEN }}"}),
], conectar(("Verificación Meta (GET)", "Validar token"), ("Validar token", "Devolver challenge"),
            ("Mensaje WhatsApp (POST)", "Verificar firma Meta y extraer"), ("Verificar firma Meta y extraer", "Firmar"),
            ("Firmar", "Asistente (backend)"), ("Asistente (backend)", "¿Hay respuesta?"), ("¿Hay respuesta?", "Enviar por WhatsApp")), """
## DRJ 03 · WhatsApp Cloud API
Requiere una app de Meta con WhatsApp Business (no se simula: sin credenciales no funciona).

URL del webhook en Meta: `https://TU-N8N/webhook/drj/whatsapp`

Variables: DRJ_API_URL, DRJ_WEBHOOK_SECRET, WHATSAPP_VERIFY_TOKEN, WHATSAPP_APP_SECRET, WHATSAPP_TOKEN, WHATSAPP_PHONE_NUMBER_ID.

Ojo: fuera de la ventana de 24 h Meta exige plantillas aprobadas para escribirle al cliente.
""")

# ---------------------------------------------------------------------
# 04 — Telegram
# ---------------------------------------------------------------------
guardar("04-telegram.json", "DRJ 04 · Telegram", [
    webhook("Mensaje Telegram", [0, 0], "drj/telegram", modo="onReceived"),
    codigo("Verificar y extraer", [220, 0], """
// Telegram envía X-Telegram-Bot-Api-Secret-Token si se configuró secret_token en setWebhook
const h = $json.headers || {};
if (h['x-telegram-bot-api-secret-token'] !== $env.TELEGRAM_WEBHOOK_SECRET) throw new Error('Secreto de Telegram inválido');
const m = ($json.body || {}).message;
if (!m || !m.text) return [];
const texto = m.text === '/start' ? 'hola' : m.text;
return [{ json: { chat: m.chat.id, payload: { canal: 'telegram', canal_usuario_id: String(m.chat.id), texto } } }];
"""),
    codigo("Firmar", [440, 0], FIRMAR),
    http_firmado("Asistente (backend)", [660, 0], "/api/integraciones/mensaje"),
    codigo("¿Hay respuesta?", [880, 0], """
const chat = $('Firmar').item.json.chat;
const t = ($json.data && $json.data.texto_respuesta) || '';
return t ? [{ json: { chat, texto: t.slice(0, 4096) } }] : [];
"""),
    http_json("Enviar por Telegram", [1100, 0], "=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage",
              "={{ JSON.stringify({ chat_id: $json.chat, text: $json.texto }) }}"),
], conectar(("Mensaje Telegram", "Verificar y extraer"), ("Verificar y extraer", "Firmar"), ("Firmar", "Asistente (backend)"),
            ("Asistente (backend)", "¿Hay respuesta?"), ("¿Hay respuesta?", "Enviar por Telegram")), """
## DRJ 04 · Telegram
1. Crea un bot con @BotFather y guarda el token.
2. Registra el webhook:
`https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://TU-N8N/webhook/drj/telegram&secret_token=<SECRETO>`

Variables: DRJ_API_URL, DRJ_WEBHOOK_SECRET, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET.
""")

# ---------------------------------------------------------------------
# 05 — Mensajes del asesor hacia el cliente (WhatsApp / Telegram)
# ---------------------------------------------------------------------
guardar("05-mensaje-asesor-saliente.json", "DRJ 05 · Mensaje del asesor al cliente", [
    webhook("Mensaje del asesor", [0, 0], "drj/saliente", raw=True),
    codigo("Verificar firma", [220, 0], VERIFICAR_DRJ),
    responder("Responder OK", [440, 200], '={{ JSON.stringify({ recibido: true }) }}'),
    codigo("Separar por canal", [440, 0], """
const { canal, canal_usuario_id, texto } = $json;
return [{ json: { canal, destino: canal_usuario_id, texto: String(texto).slice(0, 4000) } }];
"""),
    codigo("¿Es WhatsApp?", [660, -100], "return $json.canal === 'whatsapp' ? [{ json: $json }] : [];"),
    codigo("¿Es Telegram?", [660, 100], "return $json.canal === 'telegram' ? [{ json: $json }] : [];"),
    http_json("WhatsApp", [880, -100], "=https://graph.facebook.com/v21.0/{{ $env.WHATSAPP_PHONE_NUMBER_ID }}/messages",
              "={{ JSON.stringify({ messaging_product: 'whatsapp', to: $json.destino, type: 'text', text: { body: $json.texto } }) }}",
              {"Authorization": "=Bearer {{ $env.WHATSAPP_TOKEN }}"}),
    http_json("Telegram", [880, 100], "=https://api.telegram.org/bot{{ $env.TELEGRAM_BOT_TOKEN }}/sendMessage",
              "={{ JSON.stringify({ chat_id: $json.destino, text: $json.texto }) }}"),
], conectar(("Mensaje del asesor", "Verificar firma"), ("Verificar firma", "Responder OK"), ("Verificar firma", "Separar por canal"),
            ("Separar por canal", "¿Es WhatsApp?"), ("Separar por canal", "¿Es Telegram?"),
            ("¿Es WhatsApp?", "WhatsApp"), ("¿Es Telegram?", "Telegram")), """
## DRJ 05 · Mensaje del asesor al cliente
El panel (Atención humana) llama este webhook (N8N_SALIENTE_URL) cuando un asesor responde a un cliente de WhatsApp o Telegram.

**Entrada (firmada):** `{ canal, canal_usuario_id, texto }`

Variables: DRJ_WEBHOOK_SECRET y las del canal correspondiente.
""")

# ---------------------------------------------------------------------
# 06 — Registro de errores de cualquier workflow
# ---------------------------------------------------------------------
guardar("06-registro-errores.json", "DRJ 06 · Registro de errores", [
    nodo("Error en un workflow", "n8n-nodes-base.errorTrigger", 1, [0, 0], {}),
    codigo("Preparar evento", [220, 0], """
const e = $json;
return [{ json: { payload: {
  nivel: 'error',
  tipo: 'workflow_fallido',
  mensaje: String((e.execution && e.execution.error && e.execution.error.message) || 'Error en workflow').slice(0, 1500),
  datos: { workflow: e.workflow && e.workflow.name, nodo: e.execution && e.execution.lastNodeExecuted, ejecucion: e.execution && e.execution.id },
} } }];
"""),
    codigo("Firmar", [440, 0], FIRMAR),
    http_firmado("Registrar en backend", [660, 0], "/api/integraciones/eventos"),
], conectar(("Error en un workflow", "Preparar evento"), ("Preparar evento", "Firmar"), ("Firmar", "Registrar en backend")), """
## DRJ 06 · Registro de errores
En cada workflow DRJ: Settings → Error workflow → "DRJ 06 · Registro de errores".

El error queda en el panel → Registro de eventos (tipo `n8n:workflow_fallido`), sin datos personales.
""")
