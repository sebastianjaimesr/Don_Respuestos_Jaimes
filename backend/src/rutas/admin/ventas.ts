import { pagosDePedido, recalcularEstadoPago } from '../../modulos/pagos/servicio';
import { Router } from 'express';
import { z } from 'zod';
import { pool, enTransaccion, moverStock } from '../../db';
import { config } from '../../config';
import { AppError } from '../../errores';
import { h, ok, paginacion } from '../../utils/http';
import { aCentavos } from '../../utils/dinero';
import { requerirPermiso, tienePermiso } from '../../middleware/auth';
import { obtenerCotizacion } from '../../modulos/cotizaciones/servicio';
import { cambiarEstadoPedido, obtenerPedido } from '../../modulos/pedidos/servicio';

/** Cotizaciones, pedidos y pagos. */
export const r = Router();
const ver = requerirPermiso('ventas.ver');
const gestionar = requerirPermiso('pedidos.gestionar');

// =====================================================================
// Cotizaciones y pedidos
// =====================================================================
r.get(
  '/cotizaciones',
  ver,
  h(async (req, res) => {
    const { pagina, tamano, offset } = paginacion(req.query);
    const estado = z.enum(['emitida', 'aceptada', 'vencida', 'anulada']).optional().parse(req.query.estado || undefined);
    const [lista, total] = await Promise.all([
      pool.query(
        `SELECT c.codigo, c.estado, c.subtotal, c.costo_envio, c.envio_confirmado, c.total, c.fecha_emision, c.vigente_hasta, cl.nombre AS cliente,
                (SELECT COUNT(*) FROM detalle_cotizacion d WHERE d.cotizacion_id = c.id)::int AS items
         FROM cotizaciones c LEFT JOIN clientes cl ON cl.id = c.cliente_id
         WHERE ($1::text IS NULL OR c.estado = $1) ORDER BY c.fecha_emision DESC LIMIT $2 OFFSET $3`,
        [estado ?? null, tamano, offset],
      ),
      pool.query('SELECT COUNT(*)::int AS n FROM cotizaciones WHERE ($1::text IS NULL OR estado = $1)', [estado ?? null]),
    ]);
    ok(res, { items: lista.rows, total: total.rows[0].n, pagina, tamano });
  }),
);
r.get('/cotizaciones/:codigo', ver, h(async (req, res) => ok(res, await obtenerCotizacion(String(req.params.codigo)))));
r.patch(
  '/cotizaciones/:codigo',
  gestionar,
  h(async (req, res) => {
    const { estado } = z.object({ estado: z.enum(['anulada', 'vencida']) }).parse(req.body);
    const { rows } = await pool.query(`UPDATE cotizaciones SET estado = $2 WHERE codigo = $1 AND estado = 'emitida' RETURNING codigo, estado`, [req.params.codigo, estado]);
    if (!rows[0]) throw new AppError(409, 'TRANSICION_INVALIDA', 'Solo se pueden anular o vencer cotizaciones emitidas');
    ok(res, rows[0]);
  }),
);

r.get(
  '/pedidos',
  ver,
  h(async (req, res) => {
    const { pagina, tamano, offset } = paginacion(req.query);
    const f = z
      .object({
        estado: z.enum(['registrado', 'confirmado', 'en_preparacion', 'enviado', 'entregado', 'cancelado']).optional(),
        q: z.string().max(80).optional(),
      })
      .parse({ estado: req.query.estado || undefined, q: req.query.q || undefined });
    const params = [f.estado ?? null, f.q ? `%${f.q}%` : null];
    const where = `WHERE ($1::text IS NULL OR p.estado = $1) AND ($2::text IS NULL OR p.codigo ILIKE $2 OR cl.nombre ILIKE $2 OR cl.telefono ILIKE $2)`;
    const [lista, total] = await Promise.all([
      pool.query(
        `SELECT p.codigo, p.estado, p.estado_pago, p.metodo_pago, p.modalidad_entrega, p.ciudad_entrega, p.total, p.envio_confirmado, p.created_at,
                cl.nombre AS cliente, cl.telefono
         FROM pedidos p JOIN clientes cl ON cl.id = p.cliente_id ${where}
         ORDER BY p.created_at DESC LIMIT ${tamano} OFFSET ${offset}`,
        params,
      ),
      pool.query(`SELECT COUNT(*)::int AS n FROM pedidos p JOIN clientes cl ON cl.id = p.cliente_id ${where}`, params),
    ]);
    ok(res, { items: lista.rows, total: total.rows[0].n, pagina, tamano });
  }),
);
r.get('/pedidos/:codigo', ver, h(async (req, res) => ok(res, await obtenerPedido(String(req.params.codigo)))));
r.patch(
  '/pedidos/:codigo',
  gestionar,
  h(async (req, res) => {
    const d = z
      .object({
        estado: z.enum(['confirmado', 'en_preparacion', 'enviado', 'entregado', 'cancelado']).optional(),
        estado_pago: z.enum(['pendiente', 'confirmado', 'rechazado', 'reembolsado']).optional(),
      })
      .refine((x) => x.estado || x.estado_pago, 'Indica estado o estado_pago')
      .parse(req.body);
    ok(res, await cambiarEstadoPedido(String(req.params.codigo), d, req.usuario!.id));
  }),
);


// ---- Pagos (registro manual) ----
// Ningún flujo marca un pago como exitoso sin que un asesor lo verifique (o, en el
// futuro, sin la confirmación firmada de la pasarela).
r.get(
  '/pedidos/:codigo/pagos',
  ver,
  h(async (req, res) => {
    ok(res, await pagosDePedido(String(req.params.codigo)));
  }),
);
r.post(
  '/pedidos/:codigo/pagos',
  gestionar,
  h(async (req, res) => {
    const d = z
      .object({
        monto: z.number().positive().max(99_999_999).multipleOf(0.01),
        metodo: z.enum(['nequi', 'daviplata', 'transferencia', 'efectivo', 'contraentrega']),
        referencia: z.string().trim().max(120).nullable().optional(),
        estado: z.enum(['aprobado', 'rechazado']),
      })
      .parse(req.body);
    const r2 = await enTransaccion(async (db) => {
      const pe = (await db.query('SELECT id, total, estado FROM pedidos WHERE codigo = $1 FOR UPDATE', [String(req.params.codigo)])).rows[0];
      if (!pe) throw new AppError(404, 'PEDIDO_NO_ENCONTRADO', 'No existe ese pedido');
      if (pe.estado === 'cancelado') throw new AppError(409, 'PEDIDO_CANCELADO', 'El pedido está cancelado');
      let pago;
      try {
        pago = (
          await db.query(
            `INSERT INTO pagos (pedido_id, proveedor, metodo, referencia_externa, monto, estado, asesor_id) VALUES ($1, 'manual', $2, $3, $4, $5, $6) RETURNING *`,
            [pe.id, d.metodo, d.referencia ?? null, d.monto, d.estado, req.usuario!.id],
          )
        ).rows[0];
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new AppError(409, 'PAGO_DUPLICADO', 'Ya se registró un pago con esa referencia');
        throw e;
      }
      const r3 = await recalcularEstadoPago(db, pe.id);
      return { pago, ...r3 };
    }, { usuarioId: req.usuario!.id });
    ok(res, r2, 201);
  }),
);
