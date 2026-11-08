import { Router } from 'express';
import { z } from 'zod';
import { pool, enTransaccion, moverStock } from '../../db';
import { AppError } from '../../errores';
import { h, ok, paginacion } from '../../utils/http';
import { requerirPermiso, tienePermiso } from '../../middleware/auth';
import { aCentavos, aDecimal } from '../../utils/dinero';
import { registrarEvento } from '../../modulos/eventos/servicio';

/**
 * Compras a proveedores. Una compra nace en "borrador" (no toca el stock);
 * al RECIBIRLA, cada línea entra al inventario con un movimiento "entrada"
 * ligado a la compra, y opcionalmente actualiza el precio de compra.
 * Una compra recibida no se edita: si hubo un error, se anula y sus unidades salen.
 */
export const r = Router();
const ver = requerirPermiso('inventario.ver');
const gestionar = requerirPermiso('compras.gestionar');

const esquemaCompra = z.object({
  proveedor_id: z.number().int().positive(),
  factura_proveedor: z.string().trim().max(60).nullable().optional(),
  fecha_compra: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Fecha AAAA-MM-DD').optional(),
  notas: z.string().trim().max(1000).nullable().optional(),
  lineas: z
    .array(z.object({ producto_id: z.number().int().positive(), cantidad: z.number().int().positive().max(100000), costo_unitario: z.number().min(0).max(99_999_999).multipleOf(0.01) }))
    .min(1)
    .max(300)
    .refine((l) => new Set(l.map((x) => x.producto_id)).size === l.length, 'Un producto aparece dos veces: suma las cantidades en una sola línea'),
});

async function obtenerCompra(id: number) {
  const { rows } = await pool.query(
    `SELECT c.*, pr.nombre AS proveedor, a.nombre AS asesor FROM compras c JOIN proveedores pr ON pr.id = c.proveedor_id
     LEFT JOIN asesores a ON a.id = c.asesor_id WHERE c.id = $1`,
    [id],
  );
  if (!rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Compra no encontrada');
  const det = await pool.query(
    `SELECT d.producto_id, p.sku, p.nombre, d.cantidad, d.costo_unitario, d.subtotal FROM detalle_compras d JOIN productos p ON p.id = d.producto_id
     WHERE d.compra_id = $1 ORDER BY d.id`,
    [id],
  );
  return { ...rows[0], lineas: det.rows };
}

async function guardarLineas(db: { query: typeof pool.query }, compraId: number, lineas: z.infer<typeof esquemaCompra>['lineas']) {
  await db.query('DELETE FROM detalle_compras WHERE compra_id = $1', [compraId]);
  let total = 0;
  for (const l of lineas) {
    const sub = aCentavos(l.costo_unitario) * l.cantidad;
    total += sub;
    await db.query('INSERT INTO detalle_compras (compra_id, producto_id, cantidad, costo_unitario, subtotal) VALUES ($1,$2,$3,$4,$5)', [
      compraId,
      l.producto_id,
      l.cantidad,
      l.costo_unitario,
      aDecimal(sub),
    ]);
  }
  await db.query('UPDATE compras SET subtotal = $2 WHERE id = $1', [compraId, aDecimal(total)]);
}

const traducir = (e: unknown): never => {
  if ((e as { code?: string }).code === '23503') throw new AppError(400, 'REFERENCIA_INVALIDA', 'El proveedor o alguno de los productos no existe');
  throw e;
};

r.get(
  '/compras',
  ver,
  h(async (req, res) => {
    const { pagina, tamano, offset } = paginacion(req.query);
    const estado = z.enum(['borrador', 'recibida', 'anulada']).optional().parse(req.query.estado || undefined);
    const { rows } = await pool.query(
      `SELECT c.id, c.codigo, c.estado, c.fecha_compra, c.factura_proveedor, c.subtotal, c.recibida_at, pr.nombre AS proveedor,
              (SELECT COUNT(*)::int FROM detalle_compras d WHERE d.compra_id = c.id) AS lineas
       FROM compras c JOIN proveedores pr ON pr.id = c.proveedor_id
       WHERE ($1::text IS NULL OR c.estado = $1) ORDER BY c.id DESC LIMIT $2 OFFSET $3`,
      [estado ?? null, tamano, offset],
    );
    ok(res, { items: rows, pagina, tamano });
  }),
);
r.get('/compras/:id', ver, h(async (req, res) => ok(res, await obtenerCompra(z.coerce.number().int().parse(req.params.id)))));

r.post(
  '/compras',
  gestionar,
  h(async (req, res) => {
    const d = esquemaCompra.parse(req.body);
    const id = await enTransaccion(async (db) => {
      const { rows } = await db.query(
        'INSERT INTO compras (proveedor_id, factura_proveedor, fecha_compra, notas, asesor_id) VALUES ($1, $2, COALESCE($3::date, CURRENT_DATE), $4, $5) RETURNING id',
        [d.proveedor_id, d.factura_proveedor ?? null, d.fecha_compra ?? null, d.notas ?? null, req.usuario!.id],
      );
      await guardarLineas(db, rows[0].id, d.lineas);
      return rows[0].id as number;
    }, { usuarioId: req.usuario!.id }).catch(traducir);
    ok(res, await obtenerCompra(id), 201);
  }),
);

r.put(
  '/compras/:id',
  gestionar,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const d = esquemaCompra.parse(req.body);
    await enTransaccion(async (db) => {
      const c = (await db.query('SELECT estado FROM compras WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!c) throw new AppError(404, 'NO_ENCONTRADO', 'Compra no encontrada');
      if (c.estado !== 'borrador') throw new AppError(409, 'COMPRA_CERRADA', 'Solo se puede editar una compra en borrador');
      await db.query('UPDATE compras SET proveedor_id=$2, factura_proveedor=$3, fecha_compra=COALESCE($4::date, fecha_compra), notas=$5 WHERE id=$1', [
        id,
        d.proveedor_id,
        d.factura_proveedor ?? null,
        d.fecha_compra ?? null,
        d.notas ?? null,
      ]);
      await guardarLineas(db, id, d.lineas);
    }, { usuarioId: req.usuario!.id }).catch(traducir);
    ok(res, await obtenerCompra(id));
  }),
);

/** Recibir: suma el stock de cada línea y, si se pide, actualiza el precio de compra del producto. */
r.post(
  '/compras/:id/recibir',
  gestionar,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const { actualizar_costos } = z.object({ actualizar_costos: z.boolean().default(false) }).parse(req.body ?? {});
    if (actualizar_costos && !tienePermiso(req, 'precios.editar')) throw new AppError(403, 'SIN_PERMISOS', 'No tienes permiso para cambiar precios de compra');
    const codigo = await enTransaccion(async (db) => {
      const c = (await db.query('SELECT codigo, estado FROM compras WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!c) throw new AppError(404, 'NO_ENCONTRADO', 'Compra no encontrada');
      if (c.estado !== 'borrador') throw new AppError(409, 'COMPRA_CERRADA', `La compra ya está ${c.estado}`);
      const lineas = (await db.query('SELECT producto_id, cantidad, costo_unitario FROM detalle_compras WHERE compra_id = $1 ORDER BY producto_id', [id])).rows;
      if (!lineas.length) throw new AppError(400, 'SIN_ITEMS', 'La compra no tiene productos');
      for (const l of lineas) {
        // Si el producto se creó sin fila de inventario (importación antigua), se crea en 0
        await db.query('INSERT INTO inventario (producto_id, cantidad) VALUES ($1, 0) ON CONFLICT (producto_id) DO NOTHING', [l.producto_id]);
        await moverStock(db, { productoId: l.producto_id, tipo: 'entrada', delta: l.cantidad, motivo: `Compra ${c.codigo}`, compraId: id, asesorId: req.usuario!.id });
        if (actualizar_costos) await db.query('UPDATE productos SET precio_compra = $2 WHERE id = $1', [l.producto_id, l.costo_unitario]);
      }
      await db.query(`UPDATE compras SET estado = 'recibida', recibida_at = now() WHERE id = $1`, [id]);
      return c.codigo as string;
    }, { usuarioId: req.usuario!.id, origen: 'compra' });
    void registrarEvento('info', 'compra_recibida', `Compra ${codigo} recibida`, { compra_id: id, asesor_id: req.usuario!.id });
    ok(res, await obtenerCompra(id));
  }),
);

/** Anular: un borrador simplemente se anula; una compra recibida saca sus unidades (si todavía están). */
r.post(
  '/compras/:id/anular',
  gestionar,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const { motivo } = z.object({ motivo: z.string().trim().min(3).max(200) }).parse(req.body);
    await enTransaccion(async (db) => {
      const c = (await db.query('SELECT codigo, estado FROM compras WHERE id = $1 FOR UPDATE', [id])).rows[0];
      if (!c) throw new AppError(404, 'NO_ENCONTRADO', 'Compra no encontrada');
      if (c.estado === 'anulada') throw new AppError(409, 'COMPRA_CERRADA', 'La compra ya está anulada');
      if (c.estado === 'recibida') {
        const lineas = (await db.query('SELECT producto_id, cantidad FROM detalle_compras WHERE compra_id = $1 ORDER BY producto_id', [id])).rows;
        for (const l of lineas) {
          const stock = (await db.query('SELECT cantidad FROM inventario WHERE producto_id = $1', [l.producto_id])).rows[0]?.cantidad ?? 0;
          if (stock < l.cantidad) {
            throw new AppError(409, 'STOCK_INSUFICIENTE', `No se puede anular: del producto #${l.producto_id} ya se vendieron unidades de esta compra (quedan ${stock}). Registra una salida o ajuste.`);
          }
          await moverStock(db, { productoId: l.producto_id, tipo: 'salida', delta: -l.cantidad, motivo: `Anulación de ${c.codigo}: ${motivo}`, compraId: id, asesorId: req.usuario!.id });
        }
      }
      await db.query(`UPDATE compras SET estado = 'anulada', notas = concat_ws(E'\\n', notas, $2::text) WHERE id = $1`, [id, `Anulada: ${motivo}`]);
    }, { usuarioId: req.usuario!.id });
    ok(res, await obtenerCompra(id));
  }),
);
