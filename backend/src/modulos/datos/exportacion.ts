import { pool } from '../../db';
import { Celda, escribirCsv, escribirXlsx, Formato } from './archivos';
import { COLUMNAS } from './importacion';

/**
 * Exportación del inventario con los MISMOS encabezados de la importación de
 * productos: el archivo se puede editar y volver a importar. Al final van dos
 * columnas informativas (stock y estado) que la importación ignora; el stock se
 * cambia con la importación de tipo "stock", que deja movimiento auditado.
 */
export async function exportarInventario(formato: Formato, filtros: { activo?: boolean; categoria?: string }) {
  const { rows } = await pool.query(
    `SELECT p.sku, p.nombre, c.slug AS categoria, ma.nombre AS marca, p.tipo, p.precio, p.precio_compra, i.stock_minimo,
            p.referencia, p.codigo_barras, p.descripcion, p.posicion, i.ubicacion, p.activo, e.cantidad AS stock_actual, e.estado AS estado_stock, p.es_demo
     FROM productos p JOIN categorias c ON c.id = p.categoria_id LEFT JOIN categorias g ON g.id = c.padre_id
     JOIN marcas_repuesto ma ON ma.id = p.marca_id
     LEFT JOIN inventario i ON i.producto_id = p.id JOIN v_estado_inventario e ON e.producto_id = p.id
     WHERE ($1::boolean IS NULL OR p.activo = $1) AND ($2::text IS NULL OR c.slug = $2 OR g.slug = $2)
     ORDER BY p.sku`,
    [filtros.activo ?? null, filtros.categoria ?? null],
  );
  const encabezados = [...COLUMNAS.productos.obligatorias, ...COLUMNAS.productos.opcionales, 'stock_actual', 'estado_stock', 'es_demo'];
  const filas: Celda[][] = rows.map((r) =>
    encabezados.map((e) => {
      const v = r[e];
      if (v === null || v === undefined) return null;
      if (e === 'precio' || e === 'precio_compra') return Number(v);
      if (typeof v === 'boolean') return v ? 'sí' : 'no';
      return v;
    }),
  );
  return formato === 'csv' ? escribirCsv(encabezados, filas) : escribirXlsx('Inventario', encabezados, filas);
}
