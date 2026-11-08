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

- **Panel:** `POST /auth/login` → cookie `drj_panel` + `csrf` (y `token` para `Authorization: Bearer`, ver § Panel). El rol se vuelve a consultar en cada solicitud (si desactivas un usuario, pierde acceso de inmediato).
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
| GET | `/modelos`, `/categorias` | Catálogos. Cada modelo trae su `fabricante`; cada categoría, su `grupo` |
| GET | `/categorias/arbol` | Grupos (Frenos, Motor…) con sus categorías |
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

## Tienda en línea (pública y cuenta de cliente)

Precios, stock y totales se calculan **siempre en el servidor**; el navegador solo guarda el `id` del carrito.

| Método | Ruta | Descripción |
|---|---|---|
| GET | `/catalogo/productos?q&categoria&fabricante&modelo&version&anio&cilindraje&marca&tipo&precio_min&precio_max&disponible&orden&pagina&tamano` | Listado. `q` busca por SKU, referencia, código de barras, texto sin tildes y con errores de digitación. `modelo`/`anio` solo cuentan compatibilidades **verificadas**. Una categoría grupo incluye sus categorías |
| GET | `/catalogo/productos/:slug` · `/catalogo/productos/:slug/relacionados` | Detalle (especificaciones, compatibilidades, disponibilidad) |
| GET | `/catalogo/destacados` · `/catalogo/sugerencias?q` · `/catalogo/categorias` | Portada, autocompletar y árbol de categorías |
| GET | `/catalogo/fabricantes` · `/catalogo/fabricantes/:id/modelos` · `/catalogo/modelos/:id/versiones` | Selector "¿qué moto tienes?" |
| GET | `/envios/tarifas` | Costos de envío confirmados |
| POST | `/carritos` | Carrito nuevo → `{ id }` |
| GET | `/carritos/:id` | Líneas con precio y stock recalculados; cada línea trae `problema` (`agotado`, `stock_insuficiente`, `precio_no_confirmado`, `inactivo`) y el carrito `listo_para_pedido` |
| PUT / DELETE | `/carritos/:id/items/:productoId` | `{ cantidad }`. Errores: `AGOTADO`, `STOCK_INSUFICIENTE`, `PRECIO_NO_CONFIRMADO`, `CARRITO_CERRADO` |
| POST | `/carritos/:id/checkout` | `{ cliente, entrega, metodo_pago, confirmado_por_cliente: true }` → `{ pedido, whatsapp }`. 201 al crear, 200 si se repite (idempotente por carrito). `whatsapp` es `null` hasta que el dueño confirme `whatsapp_ventas`. **No marca ningún pago** |
| POST | `/clientes/registro` · `/clientes/sesion` | Cuenta con correo y contraseña → cookie `drj_cliente` + `csrf` |
| DELETE | `/clientes/sesion` | Cerrar sesión |
| GET | `/clientes/yo` | Perfil + `csrf` |
| GET | `/clientes/yo/pedidos[/:codigo]` | Pedidos hechos **desde que se abrió la cuenta** |
| GET · PUT / DELETE | `/clientes/yo/favoritos` · `/clientes/yo/favoritos/:productoId` | Favoritos |
| POST | `/clientes/yo/carrito/fusionar` | `{ carrito_id }`: une el carrito anónimo con el de la cuenta |

Los precios de catálogo, carrito, favoritos y asistente **ya incluyen la promoción vigente**; cuando hay una, el producto trae `promocion: { nombre, precio_antes, termina_at }`.

Escrituras con cookie: enviar `X-CSRF-Token: <csrf>` y `credentials: 'include'`.

## Panel administrativo

**Sesión:** `POST /auth/login` deja la cookie `drj_panel` (HttpOnly) y devuelve `{ token, usuario, csrf }`. Con la cookie, toda escritura lleva `X-CSRF-Token`; con `Authorization: Bearer <token>` no hace falta. `POST /auth/logout`, `GET /auth/yo`, `PUT /auth/password { actual, nueva }`.

**Permisos:** cada ruta exige un permiso de la tabla `rol_permisos`, que se vuelve a leer en cada solicitud. Roles base: **admin** (todo), **vendedor** (`catalogo.ver`, `inventario.ver`, `ventas.ver`, `inventario.mover`, `compras.gestionar`, `pedidos.gestionar`, `atencion.gestionar`), **consulta** (los tres `.ver`). Se pueden crear roles nuevos.

| Método | Ruta | Permiso | Descripción |
|---|---|---|---|
| GET | `/admin/metricas` | `ventas.ver` | Ventas del día y del mes (hora de Bogotá), inventario a costo y a venta, agotados, stock bajo, más vendidos, inventario por categoría |
| GET | `/admin/productos?q&categoria&tipo&estado_stock&activo&pagina&tamano` · `/admin/productos/:id` | `catalogo.ver` | Lista y detalle |
| POST / PUT | `/admin/productos[/:id]` | `productos.editar` (+ `precios.editar` si cambia el precio de venta o de compra) | Incluye `referencia_fabricante`, `codigo_barras`, `precio_compra`, `especificaciones`, `destacado`, `proveedor_id` |
| PATCH | `/admin/productos/:id/estado` | `productos.editar` | `{ activo?, destacado? }` |
| DELETE | `/admin/productos/:id` | `productos.editar` | Solo si nunca tuvo movimientos, ventas, cotizaciones ni compras; si no → 409 `PRODUCTO_CON_HISTORIAL` (desactívalo) |
| GET | `/admin/productos/:id/precios` | `catalogo.ver` | Historial de precios con origen (`manual`, `compra`, `masivo`, …) y asesor |
| POST | `/admin/precios/masivo` | `precios.masivo` | `{ filtros: {categoria?, marca_id?, proveedor_id?, tipo?, ids?}, modo: porcentaje\|valor, valor, redondeo: ninguno\|cien\|mil, aplicar }`. Exige un filtro. `aplicar: false` = vista previa. Los productos sin precio no se tocan |
| POST / PUT / DELETE | `/admin/productos/:id/compatibilidades`, `/admin/compatibilidades/:id` | `compatibilidades.editar` | Verificada exige fuente |
| GET · POST / PUT | `/admin/fabricantes`, `/admin/modelos`, `/admin/versiones` | `catalogo.ver` · `productos.editar` | Catálogo de motos |
| GET · POST / PUT | `/admin/categorias/arbol`, `/admin/categorias[/:id]` | `catalogo.ver` · `productos.editar` | Dos niveles (grupo › categoría), con sinónimos que usa el asistente y la búsqueda |
| GET · POST / PUT | `/admin/marcas[/:id]` | `catalogo.ver` · `productos.editar` | Marca de fabricante = original |
| GET · POST / PUT | `/admin/proveedores[/:id]` | `catalogo.ver` · `compras.gestionar` | |
| GET | `/admin/inventario/alertas` · `/admin/inventario/movimientos?producto_id&tipo&asesor_id&desde&hasta` · `/admin/inventario/:productoId/movimientos` | `inventario.ver` | Alertas y bitácora |
| POST | `/admin/inventario/:productoId/movimientos` | `inventario.mover` | `{ tipo: entrada\|salida, cantidad, motivo }` o `{ tipo: ajuste, cantidad_nueva, motivo }` |
| GET · POST / PUT | `/admin/compras[/:id]` | `inventario.ver` · `compras.gestionar` | Borrador editable `{ proveedor_id, factura_proveedor, fecha_compra, notas, lineas[] }` |
| POST | `/admin/compras/:id/recibir` | `compras.gestionar` (+ `precios.editar` con `actualizar_costos`) | Suma el stock con movimientos `entrada` ligados a la compra |
| POST | `/admin/compras/:id/anular` | `compras.gestionar` | `{ motivo }`. Si ya se recibió, saca las unidades; 409 si ya se vendieron |
| GET · PATCH | `/admin/cotizaciones[/:codigo]` | `ventas.ver` · `pedidos.gestionar` | `{ estado: anulada\|vencida }` |
| GET · PATCH | `/admin/pedidos?estado&q[/:codigo]` | `ventas.ver` · `pedidos.gestionar` | `{ estado?, estado_pago? }`. Cancelar devuelve stock |
| GET · POST | `/admin/pedidos/:codigo/pagos` | `ventas.ver` · `pedidos.gestionar` | Pago manual verificado por un asesor `{ monto, metodo, referencia, estado: aprobado\|rechazado }`. El pedido queda `confirmado` solo cuando lo aprobado cubre el total |
| GET · PATCH | `/admin/transferencias[/:id]` | `ventas.ver` · `atencion.gestionar` | Atención humana |
| GET · POST | `/admin/transferencias/:id/mensajes` | `ventas.ver` · `atencion.gestionar` | Ver conversación / responder |
| GET · PUT | `/admin/configuracion[/:clave]` | sesión · `configuracion.editar` | `{ valor, confirmado }` |
| GET / POST / PATCH | `/admin/asesores[/:id]` | `usuarios.gestionar` | Usuarios del panel |
| GET / POST · PUT | `/admin/roles` · `/admin/roles/:clave/permisos` | `usuarios.gestionar` | Roles y sus permisos (el rol admin no se edita) |
| GET | `/admin/eventos?nivel` · `/admin/auditoria?tabla&registro_id&asesor_id` | `auditoria.ver` | Eventos y quién cambió qué |
| GET · POST / PUT | `/admin/promociones?estado[/:id]` | `catalogo.ver` · `precios.editar` | `{ nombre, tipo_descuento: porcentaje\|valor, valor, alcance: producto\|categoria\|marca, producto_id \| categoria \| marca_id, inicia_at, termina_at, activo }` (fechas ISO con zona). Gana el mayor descuento; no se suman |
| GET · POST / PUT | `/admin/envios/tarifas[/:id]` | `catalogo.ver` · `configuracion.editar` | `{ ciudad, departamento, costo, dias_estimados, activo }` |
| GET | `/admin/productos/:id/imagenes` | `catalogo.ver` | Fotos del producto |
| POST | `/admin/productos/:id/imagenes/firma` | `imagenes.editar` | `{ tipo: image/jpeg\|image/png\|image/webp, bytes ≤ 5 MB }` → `{ clave, subida: { url, metodo: PUT, encabezados } }`. El navegador sube el archivo directo a esa URL |
| POST | `/admin/productos/:id/imagenes` | `imagenes.editar` | `{ clave, alt?, principal? }`: verifica tamaño y contenido real; la primera foto es la principal |
| PATCH / DELETE | `/admin/imagenes/:id` | `imagenes.editar` | `{ alt?, orden?, principal: true }` / borrar (si era la principal, pasa a la siguiente) |
| POST | `/admin/importaciones?tipo=productos\|precios\|stock\|compatibilidades&archivo=nombre.xlsx` | `importaciones.aplicar` + el permiso del tipo | Cuerpo = el archivo crudo (`.csv` con `;` o `,`, o `.xlsx`; máx. 10 MB y 20.000 filas). **Valida en seco**: devuelve estado `validada` o `con_errores`, resumen y errores por fila. No cambia nada |
| GET | `/admin/importaciones` · `/admin/importaciones/:id` · `/admin/importaciones/:id/errores.csv` | `importaciones.aplicar` | Historial, detalle y reporte de errores |
| POST | `/admin/importaciones/:id/aplicar` | `importaciones.aplicar` + el permiso del tipo | `{ modo: solo_validas\|todo_o_nada }`. Vuelve a validar contra la base actual y aplica en una transacción. Precios → historial con origen `importacion`; stock → movimiento `ajuste` |
| POST | `/admin/importaciones/:id/descartar` | `importaciones.aplicar` | |
| GET | `/admin/importaciones/plantillas/:tipo?formato=xlsx\|csv` | `catalogo.ver` | Plantilla con una fila de ejemplo |
| GET | `/admin/exportaciones/inventario?formato=xlsx\|csv&activo&categoria` | `exportaciones.descargar` | Mismas columnas que la importación de productos (se puede editar y volver a importar) + `stock_actual`, `estado_stock`, `es_demo` informativas |

**Columnas de importación** (los encabezados se normalizan: "Año desde" = `anio_desde`, "Precio compra" = `precio_compra`):

| Tipo | Obligatorias | Opcionales | Permiso extra |
|---|---|---|---|
| productos | sku, nombre, categoria, marca | tipo, precio, precio_compra, stock_minimo, referencia, codigo_barras, descripcion, posicion, ubicacion, activo | `productos.editar` y `precios.editar` |
| precios | sku | precio, precio_compra (al menos uno) | `precios.editar` |
| stock | sku, motivo | cantidad (contada) **o** diferencia | `inventario.mover` |
| compatibilidades | sku, fabricante, modelo, anio_desde, anio_hasta | version, verificada (sí/no), fuente (obligatoria si verificada), notas | `compatibilidades.editar` |

Un SKU existente se **actualiza** (solo las columnas que trae el archivo); uno nuevo se crea con stock 0. Precios: `15000`, `15.000`, `$ 15.000` y `1.234.567,50` son válidos; vacío = sin precio confirmado.

Transiciones de pedido: `registrado → confirmado | cancelado`, `confirmado → en_preparacion | cancelado`, `en_preparacion → enviado | entregado | cancelado`, `enviado → entregado`.
