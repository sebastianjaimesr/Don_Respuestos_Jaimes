# Plan técnico — Don Repuestos Jaimes

## Fase 1 — Análisis del entorno

**Qué encontré**

- No existía ningún proyecto previo: no hay repositorio de GitHub conectado ni archivos. Se construye desde cero, así que no se reemplaza ninguna tecnología existente.
- Entorno de desarrollo: Ubuntu 24.04, Node.js 22, npm 10, PostgreSQL 16 (servidor local disponible), Git. No hay Docker en ejecución.
- No hay credenciales de WhatsApp, Telegram, n8n ni de un proveedor de IA. Esas integraciones quedan preparadas pero no conectadas (sección 9 y 16 del prompt).

**Requisitos clave (resumen del prompt)**

1. El asistente nunca inventa precios, referencias, compatibilidades ni existencias: todo sale de la base de datos.
2. Totales calculados por código en el servidor.
3. Pedido solo con confirmación explícita del cliente, en una transacción, con control de concurrencia e idempotencia.
4. Escalamiento a humano registrado siempre; notificación solo si hay canal configurado.
5. Panel administrativo con autenticación y roles verificados en el backend.
6. Datos de demostración marcados como ficticios.

**Riesgos identificados y cómo se mitigan**

| Riesgo | Mitigación |
|---|---|
| Vender unidades que no existen (dos pedidos a la vez) | `SELECT ... FOR UPDATE` sobre el inventario dentro de la transacción + `CHECK (cantidad >= 0)` en la tabla |
| Pedido duplicado (doble clic o reintento de n8n) | Clave de idempotencia única por pedido |
| Recomendar un repuesto incompatible | Compatibilidad por modelo + rango de años, con bandera `verificada`. Lo no verificado se muestra como "por confirmar con un asesor" |
| Modelos con nombres parecidos (FZ 2.0 vs FZ 25) | Cada modelo es un registro distinto; si el texto del cliente coincide con varios, el asistente pregunta cuál es |
| Que la IA "invente" | El motor conversacional v1 es determinista (reglas + base de datos). Un LLM se puede conectar después, pero solo para entender texto, nunca como fuente de datos |
| Datos comerciales sin confirmar (envíos, dirección) | Tabla `configuracion_negocio` con bandera `confirmado`; la interfaz muestra "pendiente de confirmar" |
| Webhooks falsificados | Firma HMAC-SHA256 con marca de tiempo (anti-replay) |
| Datos personales | El seguimiento de un pedido exige código + teléfono; los logs no guardan teléfonos ni direcciones completas |

## Fase 2 — Arquitectura y planificación

**Decisión de arquitectura: monolito modular.** Un solo backend Express dividido en módulos (inventario, compatibilidad, cotizaciones, pedidos, clientes, conversaciones, escalamiento, eventos). Para un negocio que arranca es lo más barato de operar (un proceso + una base de datos), y los módulos están separados para poder extraerlos si un día hace falta. Microservicios aquí solo agregarían costo y complejidad.

**Motor conversacional.** El asistente vive en el backend, no en n8n. Así la misma lógica sirve para el chat web, WhatsApp o Telegram: n8n solo transporta mensajes (canal → webhook → backend → respuesta). La v1 usa un motor por reglas (detección de modelo, año, repuesto, posición y tipo con sinónimos en español colombiano) que funciona sin internet ni pagos.

**Stack**

- Frontend: React 18 + TypeScript + Vite + Tailwind CSS 3.
- Backend: Node.js 22 + TypeScript + Express 4 + `pg` (consultas parametrizadas) + Zod (validación).
- Base de datos: PostgreSQL 16, migraciones SQL versionadas.
- Auth: JWT firmado + contraseñas con bcrypt; roles `admin`, `vendedor`, `consulta`.
- Pruebas: Vitest + Supertest contra una base de datos PostgreSQL de prueba real.
- Automatización: n8n por webhooks firmados.

**Estructura de carpetas**

```
don-repuestos-jaimes/
├── backend/            API Express + motor del asistente
│   ├── src/modulos/    inventario, compatibilidad, cotizaciones, pedidos, clientes,
│   │                   conversaciones, escalamiento, auth, admin, integraciones
│   ├── src/asistente/  motor conversacional (extracción + flujo de ventas)
│   └── tests/          pruebas unitarias y de integración
├── frontend/           chat del cliente + panel administrativo
├── database/
│   ├── migrations/     SQL versionado
│   └── seeds/          datos FICTICIOS de demostración
├── n8n/workflows/      flujos exportables
└── docs/               API, configuración, guía de inventario, pendientes
```

**Entidades**: marcas, modelos_motocicleta, productos, compatibilidades, inventario, movimientos_inventario, clientes, cotizaciones, detalle_cotizacion, pedidos, detalle_pedido, conversaciones, mensajes, asesores, transferencias_atencion, registros_eventos, configuracion_negocio.

**Endpoints principales** (detalle completo en `docs/API.md`)

- Públicos: `POST /api/chat/mensajes`, `GET /api/repuestos/buscar`, `GET /api/compatibilidades`, `GET /api/disponibilidad/:referencia`, `POST /api/cotizaciones`, `POST /api/pedidos`, `GET /api/pedidos/seguimiento`, `POST /api/escalamientos`, `GET /api/negocio`.
- Integración: `POST /api/integraciones/mensaje` (n8n, firmado).
- Admin (JWT + rol): productos, compatibilidades, inventario y movimientos, alertas, cotizaciones, pedidos, atención humana, métricas, configuración.

**Plan de ejecución**: fases 3 a 8 en orden, verificando cada una con pruebas o ejecución real antes de pasar a la siguiente.
