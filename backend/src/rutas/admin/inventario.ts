import { Router } from 'express';
import { z } from 'zod';
import { pool, enTransaccion, moverStock } from '../../db';
import { config } from '../../config';
import { AppError } from '../../errores';
import { h, ok, paginacion } from '../../utils/http';
import { requerirPermiso, tienePermiso } from '../../middleware/auth';
import { registrarEvento } from '../../modulos/eventos/servicio';

/** Existencias, movimientos y compras. */
export const r = Router();
const ver = requerirPermiso('inventario.ver');
const mover = requerirPermiso('inventario.mover');

// =====================================================================
// Inventario
// =====================================================================
r.get(
  '/inventario/alertas',
  ver,
  h(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT p.id, p.sku AS referencia, p.nombre, p.tipo, p.es_demo, e.cantidad, e.stock_minimo, e.estado, e.tiempo_abastecimiento_dias
       FROM productos p JOIN v_estado_inventario e ON e.producto_id = p.id
       WHERE p.activo AND e.estado IN ('agotado', 'stock_bajo')
       ORDER BY (e.estado = 'agotado') DESC, e.cantidad, p.nombre`,
    );
    ok(res, rows);
  }),
);

const esquemaMovimiento = z.discriminatedUnion('tipo', [
  z.object({ tipo: z.literal('entrada'), cantidad: z.number().int().positive().max(100000), motivo: z.string().trim().min(3).max(200) }),
  z.object({ tipo: z.literal('salida'), cantidad: z.number().int().positive().max(100000), motivo: z.string().trim().min(3).max(200) }),
  z.object({ tipo: z.literal('ajuste'), cantidad_nueva: z.number().int().min(0).max(1000000), motivo: z.string().trim().min(3).max(200) }),
]);

/** Registra una entrada, salida o ajuste. Bloquea la fila para que dos cambios simultáneos no se pisen. */
r.post(
  '/inventario/:productoId/movimientos',
  mover,
  h(async (req, res) => {
    const productoId = z.coerce.number().int().parse(req.params.productoId);
    const m = esquemaMovimiento.parse(req.body);
    const r = await enTransaccion(async (db) => {
      const { rows } = await db.query('SELECT cantidad FROM inventario WHERE producto_id = $1 FOR UPDATE', [productoId]);
      if (!rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'El producto no tiene registro de inventario');
      const anterior: number = rows[0].cantidad;
      const delta = m.tipo === 'entrada' ? m.cantidad : m.tipo === 'salida' ? -m.cantidad : m.cantidad_nueva - anterior;
      if (delta === 0) throw new AppError(400, 'SIN_CAMBIO', 'El ajuste no cambia la cantidad');
      const nueva = anterior + delta;
      if (nueva < 0) throw new AppError(409, 'INVENTARIO_NEGATIVO', `No puedes sacar ${-delta} unidades: solo hay ${anterior}`);
      return moverStock(db, { productoId, tipo: m.tipo, delta, motivo: m.motivo, asesorId: req.usuario!.id });
    }, { usuarioId: req.usuario!.id });
    void registrarEvento('info', 'inventario_movimiento', `Movimiento de inventario (${m.tipo})`, { producto_id: productoId, cantidad: r.cantidad, asesor_id: req.usuario!.id });
    ok(res, r, 201);
  }),
);

r.get(
  '/inventario/:productoId/movimientos',
  ver,
  h(async (req, res) => {
    const productoId = z.coerce.number().int().parse(req.params.productoId);
    const { pagina, tamano, offset } = paginacion(req.query);
    const { rows } = await pool.query(
      `SELECT m.*, a.nombre AS asesor, pe.codigo AS pedido_codigo FROM movimientos_inventario m
       LEFT JOIN asesores a ON a.id = m.asesor_id LEFT JOIN pedidos pe ON pe.id = m.pedido_id
       WHERE m.producto_id = $1 ORDER BY m.id DESC LIMIT $2 OFFSET $3`,
      [productoId, tamano, offset],
    );
    ok(res, { items: rows, pagina, tamano });
  }),
);


/** Bitácora global de movimientos con filtros (producto, tipo, fechas, asesor). */
r.get(
  '/inventario/movimientos',
  ver,
  h(async (req, res) => {
    const { pagina, tamano, offset } = paginacion(req.query);
    const f = z
      .object({
        producto_id: z.coerce.number().int().positive().optional(),
        tipo: z.enum(['entrada', 'salida', 'ajuste', 'venta', 'devolucion']).optional(),
        asesor_id: z.coerce.number().int().positive().optional(),
        desde: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
        hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      })
      .parse(req.query);
    const params = [f.producto_id ?? null, f.tipo ?? null, f.asesor_id ?? null, f.desde ?? null, f.hasta ?? null];
    // Las fechas se interpretan en hora de Colombia
    const where = `WHERE ($1::int IS NULL OR m.producto_id = $1) AND ($2::text IS NULL OR m.tipo = $2) AND ($3::int IS NULL OR m.asesor_id = $3)
      AND ($4::date IS NULL OR m.created_at >= ($4::date)::timestamp AT TIME ZONE 'America/Bogota')
      AND ($5::date IS NULL OR m.created_at < ($5::date + 1)::timestamp AT TIME ZONE 'America/Bogota')`;
    const [lista, total] = await Promise.all([
      pool.query(
        `SELECT m.*, p.sku, p.nombre AS producto, a.nombre AS asesor, pe.codigo AS pedido_codigo, co.codigo AS compra_codigo
         FROM movimientos_inventario m JOIN productos p ON p.id = m.producto_id
         LEFT JOIN asesores a ON a.id = m.asesor_id LEFT JOIN pedidos pe ON pe.id = m.pedido_id LEFT JOIN compras co ON co.id = m.compra_id
         ${where} ORDER BY m.id DESC LIMIT ${tamano} OFFSET ${offset}`,
        params,
      ),
      pool.query(`SELECT COUNT(*)::int AS n FROM movimientos_inventario m ${where}`, params),
    ]);
    ok(res, { items: lista.rows, total: total.rows[0].n, pagina, tamano });
  }),
);
