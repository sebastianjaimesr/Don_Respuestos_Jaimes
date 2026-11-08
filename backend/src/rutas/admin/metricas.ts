import { Router } from 'express';
import { z } from 'zod';
import { pool, enTransaccion, moverStock } from '../../db';
import { config } from '../../config';
import { AppError } from '../../errores';
import { h, ok, paginacion } from '../../utils/http';
import { requerirPermiso, tienePermiso } from '../../middleware/auth';

/** Tablero del panel. */
export const r = Router();

// =====================================================================
// Métricas
// =====================================================================
r.get(
  '/metricas',
  requerirPermiso('ventas.ver'),
  h(async (_req, res) => {
    const [ventas, inventario, atencion, top, porDia, porCategoria] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota') AS pedidos_hoy,
          COALESCE(SUM(total) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota'), 0) AS ventas_hoy,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota') AS pedidos_mes,
          COALESCE(SUM(total) FILTER (WHERE created_at >= date_trunc('month', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota'), 0) AS ventas_mes,
          COUNT(*) FILTER (WHERE estado = 'registrado') AS pendientes_confirmar
        FROM pedidos WHERE estado <> 'cancelado'`),
      pool.query(`
        SELECT COUNT(*) FILTER (WHERE p.activo) AS productos_activos,
               COUNT(*) FILTER (WHERE p.activo AND e.estado = 'stock_bajo') AS stock_bajo,
               COUNT(*) FILTER (WHERE p.activo AND e.estado = 'agotado') AS agotados,
               COUNT(*) FILTER (WHERE p.activo AND p.precio IS NULL) AS sin_precio,
               COALESCE(SUM(e.cantidad * p.precio) FILTER (WHERE p.activo), 0) AS valor_inventario,
               COALESCE(SUM(e.cantidad * p.precio_compra) FILTER (WHERE p.activo), 0) AS valor_inventario_costo,
               COUNT(*) FILTER (WHERE p.activo AND p.precio_compra IS NULL) AS sin_costo,
               COUNT(*) AS productos_total
        FROM productos p JOIN v_estado_inventario e ON e.producto_id = p.id`),
      pool.query(`SELECT COUNT(*) FILTER (WHERE estado = 'pendiente') AS pendientes, COUNT(*) FILTER (WHERE estado = 'en_atencion') AS en_atencion FROM transferencias_atencion`),
      pool.query(`
        SELECT d.referencia, d.descripcion, SUM(d.cantidad)::int AS unidades, SUM(d.subtotal) AS total
        FROM detalle_pedido d JOIN pedidos p ON p.id = d.pedido_id
        WHERE p.estado <> 'cancelado' AND p.created_at >= now() - interval '30 days'
        GROUP BY d.referencia, d.descripcion ORDER BY unidades DESC LIMIT 5`),
      pool.query(`
        SELECT to_char(dia, 'YYYY-MM-DD') AS dia, COALESCE(SUM(p.total), 0) AS total, COUNT(p.id)::int AS pedidos
        FROM generate_series((now() AT TIME ZONE 'America/Bogota')::date - 13, (now() AT TIME ZONE 'America/Bogota')::date, interval '1 day') AS dia
        LEFT JOIN pedidos p ON (p.created_at AT TIME ZONE 'America/Bogota')::date = dia::date AND p.estado <> 'cancelado'
        GROUP BY dia ORDER BY dia`),
      pool.query(`
        SELECT COALESCE(g.slug, c.slug) AS grupo, COALESCE(g.nombre, c.nombre) AS etiqueta, COUNT(*)::int AS productos,
               COALESCE(SUM(e.cantidad), 0)::int AS unidades, COALESCE(SUM(e.cantidad * p.precio), 0) AS valor
        FROM productos p JOIN categorias c ON c.id = p.categoria_id LEFT JOIN categorias g ON g.id = c.padre_id
        JOIN v_estado_inventario e ON e.producto_id = p.id
        WHERE p.activo GROUP BY 1, 2 ORDER BY valor DESC`),
    ]);
    ok(res, { ventas: ventas.rows[0], inventario: inventario.rows[0], atencion: atencion.rows[0], top_productos: top.rows, ventas_por_dia: porDia.rows, inventario_por_categoria: porCategoria.rows });
  }),
);

