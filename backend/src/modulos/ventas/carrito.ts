import { z } from 'zod';
import { pool } from '../../db';
import { AppError } from '../../errores';
import { aCentavos, aDecimal, formatoCOP } from '../../utils/dinero';
import { obtenerPedido, registrarPedido, METODOS_PAGO } from '../pedidos/servicio';
import { obtenerConfiguracion } from '../negocio/servicio';
import { normalizarTelefono } from '../../utils/texto';

/**
 * Carrito de la tienda guardado en el SERVIDOR (no en localStorage).
 * El id (UUID aleatorio) funciona como llave del carrito anónimo; un carrito
 * de una cuenta solo lo abre esa cuenta. Precios, stock y totales se
 * recalculan en cada lectura: el navegador nunca dice cuánto cuesta algo.
 */

const MAX_CANTIDAD = 100;

async function carritoAccesible(id: string, clienteId: number | null) {
  const { rows } = await pool.query('SELECT id, cliente_id, estado FROM carritos WHERE id = $1', [id]);
  const c = rows[0];
  // Mismo error si no existe o es de otra cuenta: no revelamos qué carritos existen.
  if (!c || (c.cliente_id !== null && c.cliente_id !== clienteId)) throw new AppError(404, 'CARRITO_NO_ENCONTRADO', 'No encontramos ese carrito');
  return c as { id: string; cliente_id: number | null; estado: string };
}

async function carritoActivo(id: string, clienteId: number | null) {
  const c = await carritoAccesible(id, clienteId);
  if (c.estado !== 'activo') throw new AppError(409, 'CARRITO_CERRADO', 'Este carrito ya se convirtió en un pedido. Empieza uno nuevo.');
  return c;
}

/** Con sesión: devuelve (o crea) el carrito activo de la cuenta. Sin sesión: crea uno anónimo. */
export async function crearCarrito(clienteId: number | null) {
  if (clienteId) {
    const ya = await pool.query(`SELECT id FROM carritos WHERE cliente_id = $1 AND estado = 'activo'`, [clienteId]);
    if (ya.rows[0]) return obtenerCarrito(ya.rows[0].id, clienteId);
  }
  try {
    const { rows } = await pool.query('INSERT INTO carritos (cliente_id) VALUES ($1) RETURNING id', [clienteId]);
    return obtenerCarrito(rows[0].id, clienteId);
  } catch (e) {
    // Dos pestañas creando el carrito de la misma cuenta a la vez
    if ((e as { code?: string }).code === '23505' && clienteId) return crearCarrito(clienteId);
    throw e;
  }
}

export async function obtenerCarrito(id: string, clienteId: number | null) {
  const c = await carritoAccesible(id, clienteId);
  const { rows } = await pool.query(
    `SELECT ci.producto_id, ci.cantidad, p.slug, p.sku, p.nombre, p.tipo, vp.precio, vp.precio_lista, vp.promocion, p.activo, p.es_demo, ma.nombre AS marca,
            e.cantidad AS stock, e.estado AS disponibilidad
     FROM carrito_items ci JOIN productos p ON p.id = ci.producto_id JOIN v_precio_vigente vp ON vp.producto_id = p.id
     JOIN marcas_repuesto ma ON ma.id = p.marca_id JOIN v_estado_inventario e ON e.producto_id = p.id
     WHERE ci.carrito_id = $1 ORDER BY ci.agregado_at, ci.producto_id`,
    [id],
  );
  let subtotalC = 0;
  const items = rows.map((r) => {
    let problema: string | null = null;
    if (!r.activo) problema = 'producto_inactivo';
    else if (r.precio === null) problema = 'precio_no_confirmado';
    else if (r.stock === null || r.stock <= 0) problema = 'agotado';
    else if (r.cantidad > r.stock) problema = 'stock_insuficiente';
    const sub = problema ? null : aCentavos(r.precio) * r.cantidad;
    if (sub !== null) subtotalC += sub;
    return {
      producto_id: r.producto_id,
      slug: r.slug,
      sku: r.sku,
      nombre: r.nombre,
      tipo: r.tipo,
      marca: r.marca,
      cantidad: r.cantidad,
      precio_unitario: r.precio as string | null,
      promocion: r.promocion ? { nombre: r.promocion as string, precio_antes: r.precio_lista as string } : null,
      subtotal: sub === null ? null : aDecimal(sub),
      disponibles: r.activo ? r.stock : 0,
      problema,
      es_demo: r.es_demo,
    };
  });
  return {
    id: c.id,
    estado: c.estado,
    items,
    subtotal: aDecimal(subtotalC),
    // El envío se calcula al confirmar el pedido, con la ciudad de entrega.
    listo_para_pedido: c.estado === 'activo' && items.length > 0 && items.every((i) => i.problema === null),
  };
}

export async function fijarItem(id: string, clienteId: number | null, productoId: number, cantidad: number) {
  if (!Number.isInteger(cantidad) || cantidad < 1 || cantidad > MAX_CANTIDAD) {
    throw new AppError(400, 'CANTIDAD_INVALIDA', `La cantidad debe ser un número entero entre 1 y ${MAX_CANTIDAD}`);
  }
  await carritoActivo(id, clienteId);
  const { rows } = await pool.query(
    'SELECT p.sku, p.activo, p.precio, e.cantidad AS stock FROM productos p JOIN v_estado_inventario e ON e.producto_id = p.id WHERE p.id = $1',
    [productoId],
  );
  const p = rows[0];
  if (!p || !p.activo) throw new AppError(404, 'PRODUCTO_NO_ENCONTRADO', 'Ese producto no existe o ya no está disponible');
  if (p.precio === null) throw new AppError(422, 'PRECIO_NO_CONFIRMADO', 'Este producto aún no tiene precio confirmado. Consulta con un asesor.');
  if (!p.stock) throw new AppError(409, 'AGOTADO', 'Este producto está agotado');
  if (cantidad > p.stock) throw new AppError(409, 'STOCK_INSUFICIENTE', `Solo hay ${p.stock} ${p.stock === 1 ? 'unidad' : 'unidades'} disponibles`, { disponibles: p.stock });
  await pool.query(
    `INSERT INTO carrito_items (carrito_id, producto_id, cantidad) VALUES ($1, $2, $3)
     ON CONFLICT (carrito_id, producto_id) DO UPDATE SET cantidad = EXCLUDED.cantidad`,
    [id, productoId, cantidad],
  );
  await pool.query('UPDATE carritos SET updated_at = now() WHERE id = $1', [id]);
  return obtenerCarrito(id, clienteId);
}

export async function quitarItem(id: string, clienteId: number | null, productoId: number) {
  await carritoActivo(id, clienteId);
  await pool.query('DELETE FROM carrito_items WHERE carrito_id = $1 AND producto_id = $2', [id, productoId]);
  return obtenerCarrito(id, clienteId);
}

/** Al iniciar sesión: pasa los productos del carrito anónimo al carrito de la cuenta. */
export async function fusionarCarrito(anonimoId: string, clienteId: number) {
  const anon = await carritoActivo(anonimoId, null);
  if (anon.cliente_id === clienteId) return obtenerCarrito(anonimoId, clienteId);
  const cuenta = await crearCarrito(clienteId);
  await pool.query(
    `INSERT INTO carrito_items (carrito_id, producto_id, cantidad)
     SELECT $2, producto_id, cantidad FROM carrito_items WHERE carrito_id = $1
     ON CONFLICT (carrito_id, producto_id) DO UPDATE SET cantidad = LEAST(${MAX_CANTIDAD}, carrito_items.cantidad + EXCLUDED.cantidad)`,
    [anonimoId, cuenta.id],
  );
  await pool.query(`UPDATE carritos SET estado = 'abandonado' WHERE id = $1`, [anonimoId]);
  return obtenerCarrito(cuenta.id, clienteId);
}

export const esquemaCheckout = z.object({
  cliente: z.object({
    nombre: z.string().trim().min(2).max(120),
    telefono: z.string().trim().refine((t) => normalizarTelefono(t) !== null, 'Teléfono colombiano inválido'),
    ciudad: z.string().trim().min(2).max(80),
    email: z.string().trim().email().max(160).optional().nullable(),
  }),
  entrega: z.object({
    modalidad: z.enum(['recogida_tienda', 'envio']),
    ciudad: z.string().trim().min(2).max(80).optional().nullable(),
    direccion: z.string().trim().min(5).max(200).optional().nullable(),
  }),
  metodo_pago: z.enum(METODOS_PAGO),
  confirmado_por_cliente: z.literal(true, { errorMap: () => ({ message: 'Debes confirmar el pedido' }) }),
  notas: z.string().trim().max(500).optional().nullable(),
});

/** Texto del pedido para WhatsApp. Solo datos reales del pedido registrado. */
function resumenWhatsApp(p: Awaited<ReturnType<typeof registrarPedido>>) {
  const lineas = (p.lineas as { descripcion: string; referencia: string; cantidad: number; subtotal: string }[]).map(
    (l) => `• ${l.descripcion} (${l.referencia}) x${l.cantidad} — ${formatoCOP(l.subtotal)}`,
  );
  const envio = p.modalidad_entrega === 'envio' ? (p.envio_confirmado ? `Envío: ${formatoCOP(p.costo_envio)}` : 'Envío: por confirmar') : 'Recoge en tienda';
  return [`Hola, acabo de hacer el pedido ${p.codigo} en la tienda en línea:`, ...lineas, envio, `Total: ${formatoCOP(p.total)}${p.envio_confirmado || p.modalidad_entrega !== 'envio' ? '' : ' + envío'}`].join('\n');
}

/**
 * Convierte el carrito en pedido (estado "registrado", pago "pendiente").
 * Reutiliza registrarPedido: misma validación de stock con bloqueo y misma idempotencia.
 * No marca ningún pago: un asesor lo confirma cuando lo recibe.
 */
export async function checkout(id: string, clienteId: number | null, entradaCruda: unknown, claveIdempotencia?: string) {
  const d = esquemaCheckout.parse(entradaCruda);
  const c = await carritoAccesible(id, clienteId);
  const clave = claveIdempotencia ?? `carrito-${id}`;
  if (c.estado === 'convertido') {
    // Repetir el checkout devuelve el mismo pedido (doble clic, reintento por mala señal)
    const ya = await pool.query('SELECT codigo FROM pedidos WHERE carrito_id = $1', [id]);
    if (ya.rows[0]) return conWhatsApp(await registrarPedidoExistente(ya.rows[0].codigo));
  }
  if (c.estado !== 'activo') throw new AppError(409, 'CARRITO_CERRADO', 'Este carrito ya no está activo');
  const { rows: items } = await pool.query('SELECT producto_id, cantidad FROM carrito_items WHERE carrito_id = $1', [id]);
  if (!items.length) throw new AppError(400, 'SIN_ITEMS', 'Tu carrito está vacío');

  let telefono = d.cliente.telefono;
  if (clienteId) telefono = (await pool.query('SELECT telefono FROM clientes WHERE id = $1', [clienteId])).rows[0].telefono;

  const pedido = await registrarPedido(
    {
      cliente: { nombre: d.cliente.nombre, telefono, ciudad: d.cliente.ciudad, email: d.cliente.email ?? null, direccion: d.entrega.direccion ?? null },
      items,
      entrega: d.entrega,
      metodo_pago: d.metodo_pago,
      confirmado_por_cliente: true,
      clave_idempotencia: clave,
      notas: d.notas ?? null,
    },
    { canal: 'web', carritoId: id, clienteId },
  );
  await pool.query(`UPDATE carritos SET estado = 'convertido' WHERE id = $1 AND estado = 'activo'`, [id]);
  return conWhatsApp(pedido);
}

async function registrarPedidoExistente(codigo: string) {
  return { ...(await obtenerPedido(codigo)), idempotente: true };
}

async function conWhatsApp(pedido: Awaited<ReturnType<typeof registrarPedido>>) {
  const cfg = await obtenerConfiguracion();
  const numero = cfg.whatsapp_ventas?.confirmado ? String(cfg.whatsapp_ventas.valor ?? '').replace(/\D/g, '') : '';
  return {
    pedido: {
      codigo: pedido.codigo,
      estado: pedido.estado,
      estado_pago: pedido.estado_pago,
      modalidad_entrega: pedido.modalidad_entrega,
      subtotal: pedido.subtotal,
      costo_envio: pedido.costo_envio,
      envio_confirmado: pedido.envio_confirmado,
      total: pedido.total,
      lineas: pedido.lineas,
      idempotente: pedido.idempotente,
    },
    // Si el dueño no ha confirmado el número, no hay enlace (no se inventa un número).
    whatsapp: numero.length >= 10 ? `https://wa.me/${numero}?text=${encodeURIComponent(resumenWhatsApp(pedido))}` : null,
  };
}
