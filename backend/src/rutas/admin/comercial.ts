import { Router } from 'express';
import { z } from 'zod';
import { pool, enTransaccion } from '../../db';
import { AppError } from '../../errores';
import { h, ok } from '../../utils/http';
import { requerirPermiso } from '../../middleware/auth';

/**
 * Promociones y tarifas de envío.
 * El precio con promoción se calcula en la vista `v_precio_vigente` (migración 012),
 * que usan el catálogo, el carrito, el asistente y el pedido: no hay dos cálculos.
 */
export const r = Router();
const ver = requerirPermiso('catalogo.ver');
const precios = requerirPermiso('precios.editar');
const config = requerirPermiso('configuracion.editar');

const fecha = z.string().datetime({ offset: true, message: 'Fecha y hora ISO con zona, ej. 2026-12-01T00:00:00-05:00' });
const esquemaPromo = z
  .object({
    nombre: z.string().trim().min(3).max(120),
    descripcion: z.string().trim().max(1000).nullable().optional(),
    tipo_descuento: z.enum(['porcentaje', 'valor']),
    valor: z.number().positive().max(99_999_999).multipleOf(0.01),
    alcance: z.enum(['producto', 'categoria', 'marca']),
    producto_id: z.number().int().positive().optional(),
    categoria: z.string().trim().max(40).optional(),
    marca_id: z.number().int().positive().optional(),
    inicia_at: fecha,
    termina_at: fecha,
    activo: z.boolean().default(true),
  })
  .refine((d) => d.tipo_descuento !== 'porcentaje' || d.valor <= 90, { message: 'El porcentaje máximo es 90', path: ['valor'] })
  .refine((d) => new Date(d.termina_at) > new Date(d.inicia_at), { message: 'La promoción debe terminar después de empezar', path: ['termina_at'] })
  .refine(
    (d) => (d.alcance === 'producto' ? !!d.producto_id : d.alcance === 'categoria' ? !!d.categoria : !!d.marca_id),
    { message: 'Indica el producto, la categoría o la marca según el alcance', path: ['alcance'] },
  );

const SELECT_PROMO = `
  SELECT pr.id, pr.nombre, pr.descripcion, pr.tipo_descuento, pr.valor, pr.alcance, pr.inicia_at, pr.termina_at, pr.activo,
         p.id AS producto_id, p.sku AS producto_sku, c.slug AS categoria, ma.id AS marca_id, ma.nombre AS marca,
         CASE WHEN NOT pr.activo THEN 'inactiva' WHEN now() < pr.inicia_at THEN 'programada' WHEN now() >= pr.termina_at THEN 'vencida' ELSE 'vigente' END AS estado,
         (SELECT COUNT(*)::int FROM v_precio_vigente vp WHERE vp.promocion_id = pr.id) AS productos_con_esta_promocion
  FROM promociones pr
  LEFT JOIN productos p ON p.id = pr.producto_id
  LEFT JOIN categorias c ON c.id = pr.categoria_id
  LEFT JOIN marcas_repuesto ma ON ma.id = pr.marca_id`;

async function obtenerPromo(id: number) {
  const { rows } = await pool.query(`${SELECT_PROMO} WHERE pr.id = $1`, [id]);
  if (!rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Promoción no encontrada');
  return rows[0];
}

async function guardarPromo(id: number | null, d: z.infer<typeof esquemaPromo>, usuarioId: number) {
  try {
    return await enTransaccion(async (db) => {
      let categoriaId: number | null = null;
      if (d.alcance === 'categoria') {
        const c = (await db.query('SELECT id FROM categorias WHERE slug = $1', [d.categoria])).rows[0];
        if (!c) throw new AppError(400, 'CATEGORIA_INVALIDA', 'Esa categoría no existe');
        categoriaId = c.id;
      }
      const v = [
        d.nombre,
        d.descripcion ?? null,
        d.tipo_descuento,
        d.valor,
        d.alcance,
        d.alcance === 'producto' ? d.producto_id : null,
        categoriaId,
        d.alcance === 'marca' ? d.marca_id : null,
        d.inicia_at,
        d.termina_at,
        d.activo,
      ];
      if (id === null) {
        const { rows } = await db.query(
          `INSERT INTO promociones (nombre, descripcion, tipo_descuento, valor, alcance, producto_id, categoria_id, marca_id, inicia_at, termina_at, activo, asesor_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) RETURNING id`,
          [...v, usuarioId],
        );
        return rows[0].id as number;
      }
      const { rowCount } = await db.query(
        `UPDATE promociones SET nombre=$2, descripcion=$3, tipo_descuento=$4, valor=$5, alcance=$6, producto_id=$7, categoria_id=$8, marca_id=$9,
                inicia_at=$10, termina_at=$11, activo=$12 WHERE id = $1`,
        [id, ...v],
      );
      if (!rowCount) throw new AppError(404, 'NO_ENCONTRADO', 'Promoción no encontrada');
      return id;
    }, { usuarioId });
  } catch (e) {
    if ((e as { code?: string }).code === '23503') throw new AppError(400, 'REFERENCIA_INVALIDA', 'El producto o la marca no existe');
    throw e;
  }
}

r.get(
  '/promociones',
  ver,
  h(async (req, res) => {
    const estado = z.enum(['vigente', 'programada', 'vencida', 'inactiva']).optional().parse(req.query.estado || undefined);
    const { rows } = await pool.query(`SELECT * FROM (${SELECT_PROMO}) x WHERE ($1::text IS NULL OR x.estado = $1) ORDER BY x.inicia_at DESC, x.id DESC LIMIT 200`, [estado ?? null]);
    ok(res, rows);
  }),
);
r.get('/promociones/:id', ver, h(async (req, res) => ok(res, await obtenerPromo(z.coerce.number().int().parse(req.params.id)))));
r.post('/promociones', precios, h(async (req, res) => ok(res, await obtenerPromo(await guardarPromo(null, esquemaPromo.parse(req.body), req.usuario!.id)), 201)));
r.put(
  '/promociones/:id',
  precios,
  h(async (req, res) => ok(res, await obtenerPromo(await guardarPromo(z.coerce.number().int().parse(req.params.id), esquemaPromo.parse(req.body), req.usuario!.id)))),
);

// ---- Tarifas de envío ----
// Fuente del costo de envío por ciudad para checkout, asistente y cotizaciones
// (cotizarEnvio en modulos/negocio/servicio.ts; ver docs/ARQUITECTURA.md § 10).
const esquemaTarifa = z.object({
  ciudad: z.string().trim().min(2).max(80),
  departamento: z.string().trim().max(80).nullable().optional(),
  costo: z.number().min(0).max(99_999_999).multipleOf(0.01),
  dias_estimados: z.number().int().min(0).max(60).nullable().optional(),
  activo: z.boolean().default(true),
});

r.get('/envios/tarifas', ver, h(async (_req, res) => ok(res, (await pool.query('SELECT * FROM tarifas_envio ORDER BY ciudad')).rows)));
for (const [metodo, ruta] of [['post', '/envios/tarifas'], ['put', '/envios/tarifas/:id']] as const) {
  r[metodo](
    ruta,
    config,
    h(async (req, res) => {
      const d = esquemaTarifa.parse(req.body);
      const id = req.params.id ? z.coerce.number().int().parse(req.params.id) : null;
      const v = [d.ciudad, d.departamento ?? null, d.costo, d.dias_estimados ?? null, d.activo];
      try {
        const { rows } = await enTransaccion(
          (db) =>
            id === null
              ? db.query('INSERT INTO tarifas_envio (ciudad, departamento, costo, dias_estimados, activo) VALUES ($1,$2,$3,$4,$5) RETURNING *', v)
              : db.query('UPDATE tarifas_envio SET ciudad=$2, departamento=$3, costo=$4, dias_estimados=$5, activo=$6 WHERE id=$1 RETURNING *', [id, ...v]),
          { usuarioId: req.usuario!.id },
        );
        if (!rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Tarifa no encontrada');
        ok(res, rows[0], id === null ? 201 : 200);
      } catch (e) {
        if ((e as { code?: string }).code === '23505') throw new AppError(409, 'DUPLICADO', 'Ya hay una tarifa para esa ciudad');
        throw e;
      }
    }),
  );
}
