import { Router } from 'express';
import { z } from 'zod';
import { pool, enTransaccion, moverStock } from '../../db';
import { config } from '../../config';
import { AppError } from '../../errores';
import { h, ok, paginacion } from '../../utils/http';
import { requerirPermiso, tienePermiso } from '../../middleware/auth';
import { asegurarCategorias, categoriaPorClave } from '../../modulos/catalogo/categorias';
import { registrarEvento } from '../../modulos/eventos/servicio';

/** Productos y compatibilidades. */
export const r = Router();
const ver = requerirPermiso('catalogo.ver');
const editar = requerirPermiso('productos.editar');
const editarCompat = requerirPermiso('compatibilidades.editar');

// =====================================================================
// Productos
// =====================================================================
r.get(
  '/productos',
  ver,
  h(async (req, res) => {
    const { pagina, tamano, offset } = paginacion(req.query);
    const f = z
      .object({
        q: z.string().max(80).optional(),
        categoria: z.string().max(40).optional(),
        tipo: z.enum(['original', 'generico', 'alternativo']).optional(),
        estado_stock: z.enum(['disponible', 'stock_bajo', 'agotado']).optional(),
        activo: z.enum(['true', 'false']).optional(),
      })
      .parse(req.query);
    const params = [f.q ? `%${f.q}%` : null, f.categoria ?? null, f.tipo ?? null, f.estado_stock ?? null, f.activo ? f.activo === 'true' : null];
    const where = `WHERE ($1::text IS NULL OR p.nombre ILIKE $1 OR p.sku ILIKE $1 OR p.referencia ILIKE $1 OR p.codigo_barras ILIKE $1)
        AND ($2::text IS NULL OR cat.slug = $2) AND ($3::text IS NULL OR p.tipo = $3)
        AND ($4::text IS NULL OR e.estado = $4) AND ($5::boolean IS NULL OR p.activo = $5)`;
    const [lista, total] = await Promise.all([
      pool.query(
        `SELECT p.id, p.sku AS referencia, p.sku, p.referencia AS referencia_fabricante, p.nombre, cat.slug AS categoria, p.posicion, p.tipo,
                p.precio, p.activo, p.es_demo, ma.nombre AS marca, e.cantidad, e.stock_minimo, e.estado,
                (SELECT COUNT(*) FROM compatibilidades c WHERE c.producto_id = p.id)::int AS num_compatibilidades
         FROM productos p JOIN categorias cat ON cat.id = p.categoria_id JOIN marcas_repuesto ma ON ma.id = p.marca_id
         JOIN v_estado_inventario e ON e.producto_id = p.id
         ${where} ORDER BY p.nombre, p.sku LIMIT ${tamano} OFFSET ${offset}`,
        params,
      ),
      pool.query(
        `SELECT COUNT(*)::int AS n FROM productos p JOIN categorias cat ON cat.id = p.categoria_id JOIN v_estado_inventario e ON e.producto_id = p.id ${where}`,
        params,
      ),
    ]);
    ok(res, { items: lista.rows, total: total.rows[0].n, pagina, tamano });
  }),
);

r.get(
  '/productos/:id',
  ver,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const { rows } = await pool.query(
      `SELECT p.*, cat.slug AS categoria, cat.nombre AS categoria_nombre, ma.nombre AS marca, i.cantidad, i.stock_minimo, i.ubicacion, i.tiempo_abastecimiento_dias, e.estado AS estado_stock
       FROM productos p JOIN categorias cat ON cat.id = p.categoria_id JOIN marcas_repuesto ma ON ma.id = p.marca_id LEFT JOIN inventario i ON i.producto_id = p.id JOIN v_estado_inventario e ON e.producto_id = p.id
       WHERE p.id = $1`,
      [id],
    );
    if (!rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Producto no encontrado');
    const compat = await pool.query(
      `SELECT c.*, mo.nombre AS modelo, f.nombre AS fabricante, v.nombre AS version
       FROM compatibilidades c JOIN modelos_motocicleta mo ON mo.id = c.modelo_id JOIN fabricantes_moto f ON f.id = mo.fabricante_id
       LEFT JOIN versiones_moto v ON v.id = c.version_id
       WHERE c.producto_id = $1 ORDER BY f.nombre, mo.nombre, c.anio_desde`,
      [id],
    );
    ok(res, { ...rows[0], compatibilidades: compat.rows });
  }),
);

const esquemaProducto = z.object({
  /** Código interno (SKU). Se guarda en mayúsculas con guiones en vez de espacios. */
  referencia: z.string().trim().min(2).max(60).regex(/^[A-Za-z0-9._\- ]+$/, 'Solo letras, números, punto, guion y espacio'),
  /** Número de parte del fabricante, si es distinto del SKU. */
  referencia_fabricante: z.string().trim().max(60).nullable().optional(),
  codigo_barras: z
    .string()
    .trim()
    .regex(/^[0-9A-Za-z-]{4,40}$/, 'Código de barras inválido')
    .nullable()
    .optional(),
  nombre: z.string().trim().min(2).max(160),
  descripcion: z.string().trim().max(2000).nullable().optional(),
  categoria: z.string().trim().min(2).max(40),
  posicion: z.enum(['delantero', 'trasero']).nullable().optional(),
  marca_id: z.number().int().positive(),
  /** Solo para marcas que no son de un fabricante de motos. */
  tipo: z.enum(['generico', 'alternativo']).optional(),
  precio: z.number().positive().max(99_999_999).multipleOf(0.01).nullable(),
  precio_compra: z.number().min(0).max(99_999_999).multipleOf(0.01).nullable().optional(),
  especificaciones: z.record(z.string().max(60), z.union([z.string().max(200), z.number(), z.boolean()])).refine((o) => Object.keys(o).length <= 40, 'Máximo 40 especificaciones').optional(),
  destacado: z.boolean().optional(),
  proveedor_id: z.number().int().positive().nullable().optional(),
  activo: z.boolean().default(true),
  stock_minimo: z.number().int().min(0).max(100000).default(2),
  ubicacion: z.string().trim().max(60).nullable().optional(),
  tiempo_abastecimiento_dias: z.number().int().positive().max(365).nullable().optional(),
});
type DatosProducto = z.infer<typeof esquemaProducto>;

const aSku = (ref: string) => ref.trim().toUpperCase().replace(/\s+/g, '-');

/** Resuelve la categoría (debe ser una categoría hoja activa) y el tipo según la marca. */
async function resolverProducto(db: { query: typeof pool.query }, d: DatosProducto) {
  await asegurarCategorias();
  const cat = categoriaPorClave(d.categoria);
  if (!cat || cat.padre === null) {
    throw new AppError(400, 'VALIDACION', 'Datos inválidos', [{ campo: 'categoria', mensaje: 'Elige una categoría válida' }]);
  }
  const { rows } = await db.query('SELECT fabricante_moto_id FROM marcas_repuesto WHERE id = $1', [d.marca_id]);
  if (!rows[0]) throw new AppError(400, 'MARCA_INVALIDA', 'La marca no existe');
  // El tipo lo define la marca: la del fabricante de la moto es original; las demás, genérico o alternativo.
  const tipo = rows[0].fabricante_moto_id ? 'original' : (d.tipo ?? 'generico');
  return { categoriaId: cat.id, tipo };
}

function erroresProducto(e: unknown): never {
  const err = e as { code?: string; constraint?: string };
  if (err.code === '23505' && err.constraint === 'uq_productos_codigo_barras') throw new AppError(409, 'CODIGO_BARRAS_DUPLICADO', 'Ya existe un producto con ese código de barras');
  if (err.code === '23505') throw new AppError(409, 'REFERENCIA_DUPLICADA', 'Ya existe un producto con esa referencia');
  if (err.code === '23503') throw new AppError(400, 'REFERENCIA_INVALIDA', 'El proveedor, la marca o la categoría no existe');
  if (err.code === '23514' && err.constraint === 'ck_producto_original_oem') throw new AppError(400, 'TIPO_INVALIDO', (e as Error).message);
  throw e;
}

/** Columnas editables del producto, en orden. Lo no enviado conserva el valor anterior. */
function columnas(d: DatosProducto, categoriaId: number, tipo: string, previo: Record<string, any> = {}) {
  const ref = d.referencia_fabricante !== undefined ? d.referencia_fabricante : (previo.referencia ?? d.referencia.trim().toUpperCase());
  return {
    sku: aSku(d.referencia),
    referencia: ref,
    codigo_barras: d.codigo_barras !== undefined ? d.codigo_barras : (previo.codigo_barras ?? null),
    nombre: d.nombre,
    descripcion: d.descripcion ?? null,
    categoria_id: categoriaId,
    posicion: d.posicion ?? null,
    marca_id: d.marca_id,
    tipo,
    precio: d.precio,
    precio_compra: d.precio_compra !== undefined ? d.precio_compra : (previo.precio_compra ?? null),
    especificaciones: JSON.stringify(d.especificaciones ?? previo.especificaciones ?? {}),
    destacado: d.destacado ?? previo.destacado ?? false,
    proveedor_id: d.proveedor_id !== undefined ? d.proveedor_id : (previo.proveedor_id ?? null),
    activo: d.activo,
  };
}

r.post(
  '/productos',
  editar,
  h(async (req, res) => {
    const d = esquemaProducto.parse(req.body);
    if (d.precio_compra !== undefined && d.precio_compra !== null && !tienePermiso(req, 'precios.editar')) {
      throw new AppError(403, 'SIN_PERMISOS', 'No tienes permiso para fijar precios de compra');
    }
    try {
      const prod = await enTransaccion(async (db) => {
        const { categoriaId, tipo } = await resolverProducto(db, d);
        const c = columnas(d, categoriaId, tipo);
        const nombres = Object.keys(c);
        const { rows } = await db.query(
          `INSERT INTO productos (${nombres.join(', ')}) VALUES (${nombres.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING *, $${nombres.length + 1}::text AS categoria`,
          [...Object.values(c), d.categoria],
        );
        // El stock inicial es 0: las unidades se cargan con un movimiento de "entrada"
        await db.query('INSERT INTO inventario (producto_id, cantidad, stock_minimo, ubicacion, tiempo_abastecimiento_dias) VALUES ($1, 0, $2, $3, $4)', [
          rows[0].id,
          d.stock_minimo,
          d.ubicacion ?? null,
          d.tiempo_abastecimiento_dias ?? null,
        ]);
        return rows[0];
      }, { usuarioId: req.usuario!.id });
      void registrarEvento('info', 'producto_creado', `Producto ${prod.sku} creado`, { producto_id: prod.id, asesor_id: req.usuario!.id });
      ok(res, prod, 201);
    } catch (e) {
      erroresProducto(e);
    }
  }),
);

r.put(
  '/productos/:id',
  editar,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const d = esquemaProducto.parse(req.body);
    try {
      const r = await enTransaccion(async (db) => {
        const antes = (await db.query('SELECT * FROM productos WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!antes) throw new AppError(404, 'NO_ENCONTRADO', 'Producto no encontrado');
        const { categoriaId, tipo } = await resolverProducto(db, d);
        const c = columnas(d, categoriaId, tipo, antes);
        // Cambiar precios exige su propio permiso (además de editar productos)
        const cambiaPrecio = String(antes.precio ?? '') !== String(c.precio === null ? '' : c.precio.toFixed(2)) ||
          String(antes.precio_compra ?? '') !== String(c.precio_compra === null ? '' : Number(c.precio_compra).toFixed(2));
        if (cambiaPrecio && !tienePermiso(req, 'precios.editar')) throw new AppError(403, 'SIN_PERMISOS', 'No tienes permiso para cambiar precios');
        const nombres = Object.keys(c);
        const { rows } = await db.query(
          `UPDATE productos SET ${nombres.map((n, i) => `${n} = $${i + 2}`).join(', ')} WHERE id = $1 RETURNING *, $${nombres.length + 2}::text AS categoria`,
          [id, ...Object.values(c), d.categoria],
        );
        await db.query('UPDATE inventario SET stock_minimo=$2, ubicacion=$3, tiempo_abastecimiento_dias=$4 WHERE producto_id=$1', [
          id,
          d.stock_minimo,
          d.ubicacion ?? null,
          d.tiempo_abastecimiento_dias ?? null,
        ]);
        return { prod: rows[0], precioAnterior: antes.precio };
      }, { usuarioId: req.usuario!.id, origen: 'manual' });
      if (r.precioAnterior !== r.prod.precio) {
        void registrarEvento('info', 'precio_actualizado', `Precio de ${r.prod.sku} actualizado`, {
          producto_id: id,
          anterior: r.precioAnterior,
          nuevo: r.prod.precio,
          asesor_id: req.usuario!.id,
        });
      }
      ok(res, r.prod);
    } catch (e) {
      erroresProducto(e);
    }
  }),
);

/** Activar/desactivar o destacar sin reenviar todo el formulario. */
r.patch(
  '/productos/:id/estado',
  editar,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const d = z.object({ activo: z.boolean().optional(), destacado: z.boolean().optional() }).refine((x) => x.activo !== undefined || x.destacado !== undefined, 'Indica activo o destacado').parse(req.body);
    const { rows } = await enTransaccion(
      (db) => db.query('UPDATE productos SET activo = COALESCE($2, activo), destacado = COALESCE($3, destacado) WHERE id = $1 RETURNING id, sku, activo, destacado', [id, d.activo ?? null, d.destacado ?? null]),
      { usuarioId: req.usuario!.id },
    );
    if (!rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Producto no encontrado');
    ok(res, rows[0]);
  }),
);

/** Borrar solo si nunca se movió, vendió, cotizó ni compró. Si tiene historial, se desactiva. */
r.delete(
  '/productos/:id',
  editar,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    await enTransaccion(async (db) => {
      const uso = await db.query(
        `SELECT EXISTS (SELECT 1 FROM movimientos_inventario WHERE producto_id = $1)
             OR EXISTS (SELECT 1 FROM detalle_pedido WHERE producto_id = $1)
             OR EXISTS (SELECT 1 FROM detalle_cotizacion WHERE producto_id = $1)
             OR EXISTS (SELECT 1 FROM detalle_compras WHERE producto_id = $1) AS con_historial`,
        [id],
      );
      if (uso.rows[0].con_historial) throw new AppError(409, 'PRODUCTO_CON_HISTORIAL', 'Este producto tiene movimientos, ventas o compras: desactívalo en lugar de borrarlo');
      const { rowCount } = await db.query('DELETE FROM productos WHERE id = $1', [id]);
      if (!rowCount) throw new AppError(404, 'NO_ENCONTRADO', 'Producto no encontrado');
    }, { usuarioId: req.usuario!.id });
    ok(res, { eliminado: true });
  }),
);

r.get(
  '/productos/:id/precios',
  ver,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const { rows } = await pool.query(
      `SELECT h.precio_anterior, h.precio_nuevo, h.precio_compra_anterior, h.precio_compra_nuevo, h.origen, h.created_at, a.nombre AS asesor
       FROM historial_precios h LEFT JOIN asesores a ON a.id = h.asesor_id WHERE h.producto_id = $1 ORDER BY h.id DESC LIMIT 200`,
      [id],
    );
    ok(res, rows);
  }),
);

/**
 * Actualización masiva de precios de venta por porcentaje o valor fijo, con filtros.
 * `aplicar: false` devuelve la vista previa sin cambiar nada. Los productos sin
 * precio confirmado NO se tocan (no se inventa un precio a partir de nada).
 */
const esquemaMasivo = z
  .object({
    filtros: z
      .object({
        categoria: z.string().max(40).optional(),
        marca_id: z.number().int().positive().optional(),
        proveedor_id: z.number().int().positive().optional(),
        tipo: z.enum(['original', 'generico', 'alternativo']).optional(),
        ids: z.array(z.number().int().positive()).max(5000).optional(),
      })
      .default({}),
    modo: z.enum(['porcentaje', 'valor']),
    valor: z.number().min(-90).max(10_000_000),
    redondeo: z.enum(['ninguno', 'cien', 'mil']).default('cien'),
    aplicar: z.boolean().default(false),
  })
  .refine((d) => d.modo !== 'porcentaje' || (d.valor >= -90 && d.valor <= 300), { message: 'El porcentaje debe estar entre -90 y 300', path: ['valor'] })
  .refine((d) => Object.values(d.filtros).some((v) => v !== undefined), { message: 'Indica al menos un filtro (no se permite cambiar todo el catálogo de un golpe)', path: ['filtros'] });

r.post(
  '/precios/masivo',
  requerirPermiso('precios.masivo'),
  h(async (req, res) => {
    const d = esquemaMasivo.parse(req.body);
    await asegurarCategorias();
    const cat = d.filtros.categoria ? categoriaPorClave(d.filtros.categoria) : undefined;
    if (d.filtros.categoria && !cat) throw new AppError(400, 'CATEGORIA_INVALIDA', 'Esa categoría no existe');
    const cats = cat ? (cat.padre === null ? (await pool.query('SELECT id FROM categorias WHERE padre_id = $1', [cat.id])).rows.map((x) => x.id) : [cat.id]) : null;
    const nuevo =
      d.modo === 'porcentaje' ? `p.precio * (1 + $1::numeric / 100)` : `p.precio + $1::numeric`;
    const paso = { ninguno: 0.01, cien: 100, mil: 1000 }[d.redondeo];
    const calculo = `GREATEST(round((${nuevo}) / ${paso}) * ${paso}, ${paso})`;
    const sql = `
      SELECT p.id, p.sku, p.nombre, p.precio AS precio_actual, ${calculo}::numeric(14,2) AS precio_nuevo
      FROM productos p
      WHERE p.precio IS NOT NULL
        AND ($2::int[] IS NULL OR p.categoria_id = ANY($2)) AND ($3::int IS NULL OR p.marca_id = $3)
        AND ($4::int IS NULL OR p.proveedor_id = $4) AND ($5::text IS NULL OR p.tipo = $5) AND ($6::int[] IS NULL OR p.id = ANY($6))
      ORDER BY p.nombre`;
    const params = [d.valor, cats, d.filtros.marca_id ?? null, d.filtros.proveedor_id ?? null, d.filtros.tipo ?? null, d.filtros.ids ?? null];
    if (!d.aplicar) {
      const { rows } = await pool.query(sql, params);
      return ok(res, { aplicado: false, total: rows.length, productos: rows.slice(0, 200) });
    }
    const filas = await enTransaccion(async (db) => {
      const { rows } = await db.query(`${sql} FOR UPDATE OF p`, params);
      for (const f of rows) await db.query('UPDATE productos SET precio = $2 WHERE id = $1', [f.id, f.precio_nuevo]);
      return rows;
    }, { usuarioId: req.usuario!.id, origen: 'masivo' });
    void registrarEvento('info', 'precios_masivos', `Precios actualizados en ${filas.length} productos`, { asesor_id: req.usuario!.id, modo: d.modo, valor: d.valor });
    ok(res, { aplicado: true, total: filas.length, productos: filas.slice(0, 200) });
  }),
);

// ---- Compatibilidades ----
const esquemaCompat = z
  .object({
    modelo_id: z.number().int().positive(),
    version_id: z.number().int().positive().nullable().optional(),
    anio_desde: z.number().int().min(1950).max(2100),
    anio_hasta: z.number().int().min(1950).max(2100),
    verificada: z.boolean(),
    fuente: z.string().trim().max(200).nullable().optional(),
    notas: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((d) => d.anio_desde <= d.anio_hasta, { message: 'El año inicial no puede ser mayor que el final', path: ['anio_hasta'] })
  .refine((d) => !d.verificada || (d.fuente && d.fuente.length >= 3), { message: 'Una compatibilidad verificada debe indicar la fuente', path: ['fuente'] });

r.post(
  '/productos/:id/compatibilidades',
  editarCompat,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const d = esquemaCompat.parse(req.body);
    try {
      const { rows } = await enTransaccion(
        (db) =>
          db.query(
            'INSERT INTO compatibilidades (producto_id, modelo_id, version_id, anio_desde, anio_hasta, verificada, fuente, notas) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *',
            [id, d.modelo_id, d.version_id ?? null, d.anio_desde, d.anio_hasta, d.verificada, d.fuente ?? null, d.notas ?? null],
          ),
        { usuarioId: req.usuario!.id },
      );
      void registrarEvento('info', 'compatibilidad_creada', 'Compatibilidad registrada', { producto_id: id, modelo_id: d.modelo_id, asesor_id: req.usuario!.id });
      ok(res, rows[0], 201);
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === '23505') throw new AppError(409, 'COMPATIBILIDAD_DUPLICADA', 'Esa compatibilidad ya existe');
      if (code === '23503') throw new AppError(400, 'REFERENCIA_INVALIDA', 'El producto, el modelo o la versión no existe (la versión debe ser de ese modelo)');
      throw e;
    }
  }),
);

r.put(
  '/compatibilidades/:id',
  editarCompat,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const d = esquemaCompat.parse(req.body);
    const { rows } = await enTransaccion(
      (db) =>
        db.query(
          'UPDATE compatibilidades SET modelo_id=$2, version_id=$3, anio_desde=$4, anio_hasta=$5, verificada=$6, fuente=$7, notas=$8 WHERE id=$1 RETURNING *',
          [id, d.modelo_id, d.version_id ?? null, d.anio_desde, d.anio_hasta, d.verificada, d.fuente ?? null, d.notas ?? null],
        ),
      { usuarioId: req.usuario!.id },
    );
    if (!rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Compatibilidad no encontrada');
    ok(res, rows[0]);
  }),
);

r.delete(
  '/compatibilidades/:id',
  editarCompat,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const { rowCount } = await enTransaccion((db) => db.query('DELETE FROM compatibilidades WHERE id = $1', [id]), { usuarioId: req.usuario!.id });
    if (!rowCount) throw new AppError(404, 'NO_ENCONTRADO', 'Compatibilidad no encontrada');
    void registrarEvento('info', 'compatibilidad_eliminada', 'Compatibilidad eliminada', { compatibilidad_id: id, asesor_id: req.usuario!.id });
    ok(res, { eliminada: true });
  }),
);

