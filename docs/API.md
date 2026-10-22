# API — Don Repuestos Jaimes

Base: `http://localhost:4000/api`

## Formato de respuesta

Todas las respuestas tienen la misma forma:

```json
{ "ok": true, "data": { ... } }
{ "ok": false, "error": { "codigo": "STOCK_INSUFICIENTE", "mensaje": "texto para humanos", "detalles": { ... } } }
```

`codigo` es estable: úsalo en el frontend o en n8n para decidir qué hacer. Los errores 500 nunca exponen detalles internos (quedan en *registros_eventos*).

| Código | HTTP | Significado |
|---|---|---|
| `VALIDACION` | 400 | Datos inválidos. `detalles` = `[{ campo, mensaje }]` |
| `NO_AUTENTICADO` / `SESION_INVALIDA` | 401 | Falta token o expiró |
| `FIRMA_INVALIDA` | 401 | Webhook sin firma HMAC válida |
| `SIN_PERMISOS` | 403 | El rol no permite la acción |
| `PRODUCTO_NO_ENCONTRADO` | 404 | |
| `STOCK_INSUFICIENTE` | 409 | `detalles = { referencia, disponible, solicitado }` |
| `INVENTARIO_NEGATIVO` | 409 | Salida mayor que el stock |
| `TRANSICION_INVALIDA` | 409 | Cambio de estado no permitido |
| `PRECIO_NO_CONFIRMADO` | 422 | El producto no tiene precio; no se puede vender |
| `CONFIRMACION_REQUERIDA` | 400 | Pedido sin `confirmado_por_cliente: true` |
| `DEMASIADAS_SOLICITUDES` | 429 | Límite de solicitudes |
| `ERROR_INTERNO` | 500 | Error inesperado |

## Autenticación

- **Panel:** `POST /auth/login` → `token`. Enviar `Authorization: Bearer <token>`. El rol se vuelve a consultar en cada solicitud (si desactivas un usuario, pierde acceso de inmediato).
- **Integraciones (n8n):** encabezados
  - `X-DRJ-Timestamp`: segundos Unix
  - `X-DRJ-Firma`: `hex(HMAC_SHA256(WEBHOOK_SECRET, timestamp + "." + cuerpo_crudo))`
  - Se rechazan firmas con más de 5 minutos (anti-replay).

Ejemplo en Node.js:

```js
const cuerpo = JSON.stringify({ canal: 'whatsapp', canal_usuario_id: '573001234567', texto: 'hola' });
const ts = Math.floor(Date.now() / 1000).toString();
const firma = crypto.createHmac('sha256', process.env.WEBHOOK_SECRET).update(`${ts}.${cuerpo}`).digest('hex');
await fetch(`${API}/integraciones/mensaje`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-drj-timestamp': ts, 'x-drj-firma': firma }, body: cuerpo });
```

---

## Herramientas del asistente

### `buscar_repuesto(modelo, año, repuesto)` → `GET /repuestos/buscar` (público)

Query: `modelo` (texto, ej. "FZ 2.0" o id), `anio`, `repuesto` (texto libre o clave de categoría), opcionales `posicion` (`delantero|trasero`), `tipo` (`original|generico`).

```json
{
  "estado": "ok",
  "modelo": { "id": 1, "nombre": "FZ 2.0" },
  "anio": 2018,
  "categoria": "pastillas_freno",
  "resultados": [{
    "producto_id": 1, "referencia": "DEMO-PF-FZ2-D-OR", "nombre": "Pastillas de freno delanteras",
    "tipo": "original", "marca": "Yamaha", "posicion": "delantero",
    "precio": "68000.00", "precio_confirmado": true,
    "disponibilidad": { "cantidad": 5, "estado": "disponible", "tiempo_abastecimiento_dias": null },
    "compatibilidad": { "modelo": "FZ 2.0", "anio_desde": 2016, "anio_hasta": 2024, "verificada": true, "fuente": "...", "notas": null },
    "advertencia_seguridad": true, "es_demo": true
  }],
  "fuera_de_rango": []
}
```

`estado`: `ok`, `sin_resultados`, `anio_no_compatible` (existe para el modelo pero no para ese año: ver `fuera_de_rango`, **no ofrecer como compatible**), `modelo_ambiguo` (+`candidatos_modelo`), `modelo_no_encontrado`, `repuesto_ambiguo` (+`opciones_categoria`), `repuesto_no_reconocido`.

Reglas: `precio: null` = precio no confirmado. `compatibilidad.verificada: false` = no es coincidencia garantizada. Montos como texto decimal (no float).

### `registrar_pedido(cliente, items, entrega)` → `POST /pedidos` (firma o personal)

Encabezado opcional `Idempotency-Key` (o campo `clave_idempotencia`).

```json
{
  "cliente": { "nombre": "Laura Gómez", "telefono": "3159876543", "ciudad": "Pereira", "direccion": null },
  "items": [{ "producto_id": 3, "cantidad": 2 }],
  "entrega": { "modalidad": "envio", "ciudad": "Pereira", "direccion": "Cra 7 # 20-15" },
  "metodo_pago": "nequi",
  "confirmado_por_cliente": true,
  "clave_idempotencia": "whatsapp-573159876543-001",
  "cotizacion_codigo": "COT-000004"
}
```

Respuesta `201` (o `200` con `idempotente: true` si la clave ya existía):
`{ codigo: "PED-000001", estado: "registrado", subtotal, costo_envio, envio_confirmado, total, lineas: [...], idempotente }`

Garantías: valida todo en servidor; recalcula precios y totales desde la BD (ignora cualquier precio enviado); bloquea las filas de inventario (`SELECT … FOR UPDATE`) para que dos pedidos simultáneos no vendan la misma unidad; descuenta stock y deja movimientos `venta` en la misma transacción; el envío solo se suma si el negocio lo confirmó.

### `escalar_a_humano(motivo)` → `POST /escalamientos` (firma o personal)

```json
{ "motivo": "compatibilidad_dudosa", "detalle": "Cliente con FZ 2.0 2015", "conversacion_id": "uuid" }
```

`motivo`: `solicitud_cliente | cliente_molesto | compatibilidad_dudosa | datos_faltantes | precio_no_confirmado | producto_agotado | error_sistema | otro`.
Respuesta: `{ id, estado, notificado, ya_existia, canal_configurado }`. `notificado` solo es `true` si n8n respondió 2xx.

---

## Chat web (público, con límite de solicitudes)

| Método | Ruta | Descripción |
|---|---|---|
| POST | `/chat/conversaciones` | Crea conversación. → `{ conversacion_id, respuestas: [saludo] }` |
| POST | `/chat/conversaciones/:id/mensajes` | `{ texto }` o `{ accion, etiqueta_accion }` → `{ respuestas[], estado, asesor_atendiendo, texto_respuesta }` |
| GET | `/chat/conversaciones/:id/mensajes?despues=ID` | Mensajes nuevos (para ver respuestas del asesor) |

Cada respuesta: `{ mensaje_id, tipo, texto, datos?, acciones? }`. `tipo`: `texto | productos | carrito | cotizacion | formulario_entrega | resumen_pedido | pedido_registrado | escalado | error`. `texto` siempre sirve sola (para WhatsApp/Telegram); `datos` y `acciones` son para el chat web.

Acciones (botones): `agregar {producto_id, cantidad}`, `quitar`, `ver_carrito`, `cotizar`, `iniciar_pedido`, `datos_entrega {datos}`, `confirmar_pedido`, `rechazar_confirmacion`, `escalar`, `elegir_modelo`, `elegir_categoria`, `elegir_posicion`, `nueva_busqueda`.

## Otros endpoints públicos

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/salud` | Estado del servicio y la BD |
| GET | `/compatibilidades?referencia=X` | Modelos/años compatibles con una referencia |
| GET | `/compatibilidades?modelo_id=1&anio=2018` | Productos compatibles con una moto |
| GET | `/disponibilidad/:referencia` | Precio, stock y estado |
| GET | `/modelos`, `/categorias` | Catálogos |
| GET | `/negocio` | Datos comerciales (los no confirmados vienen con `valor: null, confirmado: false`) |
| GET | `/cotizaciones/:codigo` | Cotización (sin datos del cliente) |
| GET | `/pedidos/seguimiento?codigo=PED-000001&telefono=300...` | Estado del pedido; exige código + teléfono |

## Integraciones (firma HMAC)

| Método | Ruta | Entrada | Salida |
|---|---|---|---|
| POST | `/integraciones/mensaje` | `{ canal: whatsapp\|telegram\|otro, canal_usuario_id, texto }` | igual que el chat + `texto_respuesta` |
| POST | `/integraciones/eventos` | `{ nivel, tipo, mensaje, datos? }` | `{ registrado: true }` |
| POST | `/cotizaciones` | `{ items, modalidad_entrega?, ciudad?, conversacion_id? }` | cotización con líneas y totales |
| POST | `/pedidos` | ver arriba | pedido |
| POST | `/escalamientos` | ver arriba | solicitud |

Webhooks que el **backend llama** (salientes, también firmados):

| Variable | Evento | Cuerpo |
|---|---|---|
| `N8N_NOTIFICACION_URL` | escalamiento creado | `{ evento: "escalamiento_creado", transferencia_id, motivo, detalle, conversacion_id, creado }` |
| `N8N_SALIENTE_URL` | asesor responde a cliente de WhatsApp/Telegram | `{ canal, canal_usuario_id, texto }` |

## Panel administrativo (`Authorization: Bearer`)

Roles: **admin** (todo), **vendedor** (inventario, pedidos, cotizaciones, atención), **consulta** (solo lectura).

| Método | Ruta | Rol | Descripción |
|---|---|---|---|
| POST | `/auth/login` | — | `{ email, password }` → `{ token, usuario }` (10 intentos / 15 min) |
| GET | `/auth/yo` | todos | Usuario actual |
| GET | `/admin/metricas` | todos | Ventas, inventario, atención, top productos, ventas por día |
| GET | `/admin/productos?q&categoria&tipo&estado_stock&activo&pagina&tamano` | todos | Lista paginada |
| GET | `/admin/productos/:id` | todos | Detalle + compatibilidades |
| POST | `/admin/productos` | admin | Crear (stock inicial 0; tipo según la marca) |
| PUT | `/admin/productos/:id` | admin | Editar (cambio de precio queda en eventos) |
| POST | `/admin/productos/:id/compatibilidades` | admin | `{ modelo_id, anio_desde, anio_hasta, verificada, fuente, notas }` (verificada exige fuente) |
| PUT / DELETE | `/admin/compatibilidades/:id` | admin | |
| GET / POST | `/admin/marcas` | todos / admin | `{ nombre, tipo: original\|generico }` |
| GET / POST / PUT | `/admin/modelos[/:id]` | todos / admin | `{ nombre, cilindraje_cc, anio_inicio, anio_fin, alias[] }` |
| GET | `/admin/categorias` | todos | |
| GET | `/admin/inventario/alertas` | todos | Agotados y stock bajo |
| POST | `/admin/inventario/:productoId/movimientos` | admin, vendedor | `{ tipo: entrada\|salida, cantidad, motivo }` o `{ tipo: ajuste, cantidad_nueva, motivo }` |
| GET | `/admin/inventario/:productoId/movimientos` | todos | Bitácora |
| GET | `/admin/cotizaciones[/:codigo]` | todos | |
| PATCH | `/admin/cotizaciones/:codigo` | admin, vendedor | `{ estado: anulada\|vencida }` |
| GET | `/admin/pedidos?estado&q[/:codigo]` | todos | |
| PATCH | `/admin/pedidos/:codigo` | admin, vendedor | `{ estado?, estado_pago? }`. Cancelar devuelve stock |
| GET | `/admin/transferencias?estado` | todos | Solicitudes de atención humana |
| PATCH | `/admin/transferencias/:id` | admin, vendedor | `{ estado: pendiente\|en_atencion\|resuelta }` |
| GET / POST | `/admin/transferencias/:id/mensajes` | todos / admin, vendedor | Ver conversación / responder `{ texto }` |
| GET | `/admin/configuracion` | todos | |
| PUT | `/admin/configuracion/:clave` | admin | `{ valor, confirmado }` |
| GET | `/admin/eventos?nivel` | admin | Registro de eventos |
| GET / POST / PATCH | `/admin/asesores[/:id]` | admin | Usuarios del panel |

Transiciones de pedido: `registrado → confirmado | cancelado`, `confirmado → en_preparacion | cancelado`, `en_preparacion → enviado | entregado | cancelado`, `enviado → entregado`.
