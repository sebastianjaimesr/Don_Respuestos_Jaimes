# Workflows de n8n

Archivos importables en `workflows/`. Instrucciones completas en [../docs/CONFIGURACION_SERVICIOS.md](../docs/CONFIGURACION_SERVICIOS.md).

| Workflow | Webhook | Probado |
|---|---|---|
| 01 Mensaje entrante genérico | `POST /webhook/drj/mensaje` | Sí (n8n 2.35.7 + backend) |
| 02 Notificar asesor | `POST /webhook/drj/escalamiento` (lo llama el backend) | Sí |
| 03 WhatsApp Cloud API | `GET/POST /webhook/drj/whatsapp` | Importa bien; requiere cuenta de Meta |
| 04 Telegram | `POST /webhook/drj/telegram` | Importa bien; requiere bot de Telegram |
| 05 Mensaje del asesor al cliente | `POST /webhook/drj/saliente` (lo llama el backend) | Sí (ruteo y firma; el envío final requiere WhatsApp/Telegram) |
| 06 Registro de errores | Error Trigger | Sí |

Para modificarlos, edita `generar_workflows.py` y ejecuta `python3 n8n/generar_workflows.py`. Ningún secreto va en el JSON: todo se lee de variables de entorno (`$env`).
