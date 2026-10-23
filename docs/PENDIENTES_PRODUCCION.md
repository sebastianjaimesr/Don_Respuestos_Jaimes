# Pendientes para pasar a producción

Ordenados por prioridad. ✅ = ya está hecho en el código; lo demás lo debe hacer el negocio o quien despliegue.

## 1. Datos del negocio (bloquean la venta real)

- [ ] Borrar los datos de demostración (`database/seeds/borrar_demo.sql`).
- [ ] Cargar el catálogo real: referencias, marcas, precios confirmados ([GUIA_INVENTARIO.md](GUIA_INVENTARIO.md)).
- [ ] Cargar compatibilidades **verificadas** con su fuente (catálogo de partes Yamaha o proveedor). Sin esto el asistente no muestra el producto.
- [ ] Conteo físico inicial y carga de existencias (movimientos de entrada).
- [ ] Confirmar en Panel → Configuración: dirección, ciudades de envío, transportadoras, costo de envío, contacto humano, vigencia de cotizaciones, medios de pago.
- [ ] Revisar con el propietario los textos del asistente (saludo, despedida, advertencia de seguridad).

## 2. Legal y datos personales (Colombia)

- [ ] Política de tratamiento de datos personales (Ley 1581 de 2012) publicada y enlazada desde el chat, con autorización del cliente antes de pedir nombre, teléfono y dirección.
- [ ] Definir cuánto tiempo se guardan conversaciones y datos de clientes, y un procedimiento para borrarlos si el cliente lo pide.
- [ ] Verificar si el volumen de datos obliga a registrar la base en el RNBD de la SIC.
- [ ] Términos de garantía, cambios y devoluciones (Estatuto del Consumidor, Ley 1480 de 2011).
- [ ] Facturación electrónica: este sistema **no** emite facturas; definir cómo se integra con el software de facturación de la DIAN que use el negocio.

## 3. Infraestructura

- [x] Hosting de demostración: frontend en GitHub Pages y backend + PostgreSQL en Render plan gratis ([DESPLIEGUE_RENDER.md](DESPLIEGUE_RENDER.md)).
- [ ] Para producción: plan pago de Render (o Railway/VPS) con PostgreSQL con backups diarios; el plan gratis se duerme y su base de datos vence.
- [ ] HTTPS obligatorio en todos los dominios (también en n8n).
- [ ] `NODE_ENV=production`, `CORS_ORIGENES` con el dominio real, `CONFIAR_PROXY` según el proxy usado.
- [ ] Secretos nuevos y largos para `JWT_SECRET` y `WEBHOOK_SECRET` (nunca los de desarrollo).
- [ ] Usuario de PostgreSQL de la aplicación sin permisos de superusuario.
- [ ] Backups automáticos y **probar una restauración**.
- [ ] Monitoreo: alerta si `/api/salud` falla; revisar Panel → Registro de eventos (errores).
- [ ] Build de producción: `npm run build` (backend a `backend/dist`, frontend a `frontend/dist`) y `npm start -w backend`.
- [ ] El límite de solicitudes guarda los contadores en memoria: si corres más de una instancia del backend, usa un almacén compartido (por ejemplo Redis) para `express-rate-limit`.

## 4. Canales

- [ ] WhatsApp: cuenta Meta Business verificada, número, token permanente, plantillas aprobadas para mensajes fuera de 24 h, revisar costos ([CONFIGURACION_SERVICIOS.md](CONFIGURACION_SERVICIOS.md)).
- [ ] Telegram (opcional): bot y webhook.
- [ ] Canal de aviso a asesores (`DRJ_AVISO_ASESOR_URL`).
- [ ] Probar de punta a punta los workflows 03 y 04 con cuentas reales (no se pudieron probar aquí).

## 5. Mejoras recomendadas

- [ ] Vencer cotizaciones automáticamente (tarea programada que pase a `vencida` las que superen `vigente_hasta`).
- [ ] Recuperación de contraseña y cambio de contraseña desde el panel (hoy lo hace un administrador creando otro usuario o por base de datos).
- [ ] Sesión del panel en cookie `httpOnly` en lugar de `sessionStorage`, si el panel se expone a internet abierto.
- [ ] Carga masiva de productos y compatibilidades desde Excel/CSV.
- [ ] Cerrar conversaciones inactivas (ej. 7 días) para que el contexto no quede viejo.
- [ ] Pruebas automatizadas del frontend (hoy el frontend se probó con un recorrido automatizado en navegador, no con una suite versionada).
- [ ] Integrar un LLM solo para extraer intención/datos de frases muy libres, manteniendo las herramientas como única fuente de datos.
- [ ] Pasarela de pagos (Wompi, PayU, Mercado Pago) en una versión futura; hoy no se procesan pagos.

## Ya resuelto en el código ✅

- ✅ Validación en servidor (Zod) de todas las entradas.
- ✅ Contraseñas con bcrypt (costo 12), JWT con expiración, roles verificados en backend en cada solicitud.
- ✅ Consultas parametrizadas en toda la aplicación.
- ✅ Límite de solicitudes en chat, login y seguimiento.
- ✅ Webhooks firmados con HMAC-SHA256 y ventana anti-replay.
- ✅ Idempotencia de pedidos y bloqueo de inventario (`FOR UPDATE`) contra ventas simultáneas.
- ✅ `CHECK` en base de datos: stock y cantidades nunca negativos, totales cuadrados, tipo original/genérico atado a la marca.
- ✅ Bitácora de movimientos de inventario y de eventos (sin teléfonos, direcciones ni secretos).
- ✅ El chat no guarda mensajes que parezcan números de tarjeta y advierte al cliente.
