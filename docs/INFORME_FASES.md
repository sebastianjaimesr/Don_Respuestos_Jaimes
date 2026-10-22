# Informe por fases

Formato pedido en la sección 16: qué se hizo, archivos, cómo probar, errores encontrados y qué falta.

Entorno donde se construyó y probó: Ubuntu 24.04, Node.js 22, PostgreSQL 16.15, Chromium (Playwright) y n8n 2.35.7.

---

## Fase 1 — Análisis

- **Hecho:** inspección del entorno (sin proyecto previo ni repositorio), requisitos, riesgos y mitigaciones.
- **Archivos:** `docs/PLAN_TECNICO.md`.
- **Errores:** ninguno.
- **Pendiente:** nada.

## Fase 2 — Planificación

- **Hecho:** monolito modular; motor del asistente en el backend (n8n solo transporta); motor por reglas en v1 (sin LLM pago) para que sea imposible inventar datos.
- **Archivos:** `docs/PLAN_TECNICO.md`.

**Decisiones clave explicadas:**

| Decisión | Por qué | Ejemplo práctico |
|---|---|---|
| Dinero en `NUMERIC(14,2)` y cálculos en centavos enteros | `0.1 + 0.2 = 0.30000000000000004` en JavaScript | `aCentavos('68000.00') = 6800000` |
| Tipo original/genérico atado a la marca (FK compuesta) | Imposible "mezclar" un genérico con marca Yamaha | Insertar genérico con marca Yamaha → error de la BD |
| `SELECT … FOR UPDATE` en el inventario al registrar el pedido | Dos clientes no pueden comprar la última unidad a la vez | Prueba [16] |
| Clave de idempotencia por pedido | Doble clic o reintento de n8n no duplica la venta | Prueba [12] |
| Compatibilidad con bandera `verificada` + fuente | "No inventar compatibilidades" | R15 bujía → "sin verificar" |
| Coincidencia de modelo por alias **más largo** | "fz 2.0" ≠ "fz 25"; "fz" solo es ambiguo y se pregunta | Prueba unitaria de modelos |
| Advisory lock por conversación | Dos mensajes simultáneos del mismo cliente no pisan el contexto | `atencion.ts` |

## Fase 3 — Base de datos

- **Hecho:** 17 tablas + vista, claves, `CHECK`, índices, triggers de `updated_at`, migraciones versionadas, configuración comercial con bandera `confirmado`, datos FICTICIOS (`DEMO-*`, `es_demo = true`) y script para borrarlos.
- **Archivos:** `database/migrations/001_esquema_inicial.sql`, `002_configuracion_negocio.sql`, `database/seeds/demo_ficticio.sql`, `borrar_demo.sql`, `backend/src/scripts/migrar.ts`.
- **Cómo probar:** `npm run db:migrar && npm run db:demo`.
- **Verificado:** stock negativo rechazado, genérico con marca original rechazado, referencia duplicada (sin importar mayúsculas/espacios) rechazada, seed idempotente.

## Fase 4 — Backend

- **Hecho:** API Express + TypeScript; herramientas `buscar_repuesto`, `registrar_pedido`, `escalar_a_humano`; cotizaciones; motor conversacional con los 7 pasos del flujo de ventas; panel con JWT y roles; webhooks firmados; registro de eventos sin datos sensibles.
- **Archivos principales:** `backend/src/asistente/motor.ts`, `extraccion.ts`, `modulos/catalogo/servicio.ts`, `modulos/pedidos/servicio.ts`, `modulos/ventas/lineas.ts`, `modulos/escalamiento/servicio.ts`, `rutas/*.ts`.
- **Cómo probar:** `npm run dev:backend` y `npm test`. Endpoints en [API.md](API.md).
- **Errores encontrados y solución:**
  1. Elegir el modelo con "la 1" respondía "no encontré ese modelo" → la respuesta a una pregunta pendiente ahora cuenta como dato nuevo.
  2. "aceite" como respuesta a "¿filtro de aire o de aceite?" buscaba aceite de motor → si hay opciones pendientes, se resuelven primero.
  3. `FOR UPDATE` no se puede aplicar al lado nulo de un `LEFT JOIN` → se usa `JOIN` con inventario (todo producto se crea con su fila de inventario).
  4. PostgreSQL no deducía el tipo de un parámetro usado en `SET` y en `CASE` → cast explícito `$2::text`.
  5. "Sí, agrégalo" sobre un producto agotado no explicaba por qué no se podía → si hay una sola opción mostrada, se elige y se explica la razón.
  6. TypeScript 7 eliminó `moduleResolution: node10` → se fijó TypeScript 5.9 por compatibilidad.

## Fase 5 — Frontend

- **Hecho:** chat del cliente (tarjetas de producto solo con campos confirmados, botones reales, formulario de entrega, resumen, confirmación, aviso de asesor, consulta periódica de respuestas del asesor) y panel (resumen con métricas, productos con búsqueda/filtros/paginación, detalle con compatibilidades y movimientos, inventario con alertas, cotizaciones, pedidos con transiciones, atención humana con respuesta al cliente, configuración, usuarios, eventos).
- **Archivos:** `frontend/src/chat/*`, `frontend/src/paginas/admin/*`, `frontend/src/componentes/ui.tsx`.
- **Cómo probar:** `npm run dev:frontend` → http://localhost:5173 y /admin.
- **Verificado:** recorrido automatizado en Chromium: búsqueda → agregar → cotización → formulario → resumen → confirmación → pedido registrado; vista de celular (390 px); login, resumen, productos, detalle, cambio de estado de pedido y configuración. Sin errores en consola.
- **Errores y solución:** `react-router-dom` 6 tenía avisos de seguridad moderados → `react-router` 7.18; Tailwind 3 arrastraba una dependencia vulnerable de desarrollo → Tailwind 4; tablas angostas con scroll horizontal innecesario → ancho mínimo solo en tablas grandes; encabezado del chat apretado en celular → textos secundarios ocultos en pantallas pequeñas.

## Fase 6 — Automatización (n8n)

- **Hecho:** 6 workflows (genérico, aviso a asesor, WhatsApp Cloud API, Telegram, mensaje saliente del asesor, registro de errores), generados por script, sin secretos en el JSON.
- **Archivos:** `n8n/generar_workflows.py`, `n8n/workflows/*.json`, `docs/CONFIGURACION_SERVICIOS.md`.
- **Verificado en n8n 2.35.7 real:** 01 (conversación completa a través de n8n), 02 (escalamiento → `notificado = true`), 05 (firma y ruteo) y 06 (un error del 01 quedó en `registros_eventos`).
- **No verificado:** 03 y 04 de punta a punta (requieren cuentas reales de Meta y Telegram). Importan y se activan sin errores.
- **Errores y solución:**
  1. n8n exige `id` en el JSON para importar → id estable por archivo.
  2. n8n responde 200 vacío aunque el flujo falle → el backend ahora exige `{"recibido": true}` para marcar un aviso como entregado.
  3. El nodo Switch con salida -1 cortaba el flujo antes de responder → reemplazado por filtros en nodos Code.
  4. En n8n 2.x el workflow de errores debe estar activo → documentado y enlazado automáticamente en los demás flujos.

## Fase 7 — Pruebas

`npm test` → **61 pruebas, todas pasan**, contra PostgreSQL real.

| # | Caso del prompt | Prueba |
|---|---|---|
| 1 | Búsqueda de repuesto existente | `herramientas.test.ts` [1], `chat.test.ts` [1][5] |
| 2 | Búsqueda sin resultados | `herramientas.test.ts` [2] |
| 3 | Compatibilidad confirmada | [3], [3b] (no verificada) |
| 4 | Incompatibilidad modelo/año | [4], [4b] (FZ 25 ≠ FZ 2.0), `chat.test.ts` [4] |
| 5 | Original frente a genérico | [5], [5b] (la BD impide mezclarlos) |
| 6 | Producto agotado | [6], `chat.test.ts` [6][7] |
| 7 | Precio faltante | [7], `chat.test.ts` [6][7] |
| 8 | Inventario insuficiente | [8] |
| 9 | Cotización con varios productos | [9][10] |
| 10 | Subtotales y total correctos | [9][10], [10b] (envío confirmado), `dinero.test.ts` |
| 11 | Pedido sin confirmación | [11], [11b], `chat.test.ts` [11][12] |
| 12 | Pedido confirmado y registrado | [12], [12b], `chat.test.ts` [11][12], [12b] |
| 13 | Error de base de datos | `seguridad.test.ts` [13] (API, asistente y salud) |
| 14 | Atención humana | `chat.test.ts` [14], [14b], `seguridad.test.ts` [14c] (notificación firmada) |
| 15 | Usuario sin permisos cambiando inventario | `seguridad.test.ts` [15] |
| 16 | Dos pedidos simultáneos sobre la última unidad | [16], [16b] (8 compras simultáneas sobre 3 unidades) |

Además: firmas HMAC, webhook con cuerpo alterado, idempotencia, cancelación que devuelve stock, seguimiento con teléfono incorrecto, usuario desactivado, datos de tarjeta no guardados.

## Fase 8 — Documentación y despliegue

- **Hecho:** README con instalación paso a paso, API, configuración de servicios externos, guía de inventario, pendientes de producción, este informe, `.env.example` (backend, frontend, docker) sin credenciales, `docker-compose.yml` de apoyo.
- **No verificado:** `docker-compose.yml` (no había Docker en el entorno).
- **Qué falta:** ver [PENDIENTES_PRODUCCION.md](PENDIENTES_PRODUCCION.md). Lo más importante: cargar inventario y compatibilidades reales, confirmar datos comerciales, política de datos personales y hosting.
