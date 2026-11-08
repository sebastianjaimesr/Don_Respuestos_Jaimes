import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { pool, enTransaccion, moverStock } from '../db';
import { config } from '../config';
import { AppError } from '../errores';
import { h, ok, paginacion } from '../utils/http';
import { requerirAuth, requerirRol } from '../middleware/auth';
import { crearAsesor, iniciarSesion } from '../modulos/auth/servicio';
import { asegurarCategorias, categoriaPorClave, categoriasHoja } from '../modulos/catalogo/categorias';
import { obtenerCotizacion } from '../modulos/cotizaciones/servicio';
import { cambiarEstadoPedido, obtenerPedido } from '../modulos/pedidos/servicio';
import { cambiarEstadoTransferencia } from '../modulos/escalamiento/servicio';
import { guardarMensaje, listarMensajes, obtenerConversacion } from '../modulos/conversaciones/servicio';
import { obtenerConfiguracion } from '../modulos/negocio/servicio';
import { registrarEvento } from '../modulos/eventos/servicio';
import { enviarFirmado } from '../utils/firma';

export const rutasAdmin = Router();

// =====================================================================
// Autenticación
// =====================================================================
const limiteLogin = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.RATE_LIMIT_LOGIN_POR_15MIN,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { codigo: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos. Espera 15 minutos.' } },
});

rutasAdmin.post(
  '/auth/login',
  limiteLogin,
  h(async (req, res) => {
    const { email, password } = z.object({ email: z.string().email().max(160), password: z.string().min(1).max(200) }).parse(req.body);
    ok(res, await iniciarSesion(email, password));
  }),
);

rutasAdmin.get('/auth/yo', requerirAuth, (req, res) => ok(res, req.usuario));

// Todo lo que sigue exige sesión iniciada
const admin = Router();
admin.use(requerirAuth);
rutasAdmin.use('/admin', admin);

const soloAdmin = requerirRol('admin');
const operacion = requerirRol('admin', 'vendedor');

// =====================================================================
// Métricas
// =====================================================================
admin.get(
  '/metricas',
  h(async (_req, res) => {
    const [ventas, inventario, atencion, top, porDia] = await Promise.all([
      pool.query(`
        SELECT
          COUNT(*) FILTER (WHERE created_at >= date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota') AS pedidos_hoy,
          COUNT(*) FILTER (WHERE created_at >= date_trunc('month', now())) AS pedidos_mes,
          COALESCE(SUM(total) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS ventas_mes,
          COUNT(*) FILTER (WHERE estado = 'registrado') AS pendientes_confirmar
        FROM pedidos WHERE estado <> 'cancelado'`),
      pool.query(`
        SELECT COUNT(*) FILTER (WHERE p.activo) AS productos_activos,
               COUNT(*) FILTER (WHERE p.activo AND e.estado = 'stock_bajo') AS stock_bajo,
               COUNT(*) FILTER (WHERE p.activo AND e.estado = 'agotado') AS agotados,
               COUNT(*) FILTER (WHERE p.activo AND p.precio IS NULL) AS sin_precio,
               COALESCE(SUM(e.cantidad * p.precio) FILTER (WHERE p.activo), 0) AS valor_inventario
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
    ]);
    ok(res, { ventas: ventas.rows[0], inventario: inventario.rows[0], atencion: atencion.rows[0], top_productos: top.rows, ventas_por_dia: porDia.rows });
  }),
);

// =====================================================================
// Marcas y modelos
// =====================================================================
// Una marca es "original" cuando es la del fabricante de una moto (fabricante_moto_id).
// Se devuelve `tipo` calculado para que el panel actual siga funcionando.
admin.get(
  '/marcas',
  h(async (_req, res) =>
    ok(
      res,
      (
        await pool.query(
          `SELECT m.id, m.nombre, CASE WHEN m.fabricante_moto_id IS NULL THEN 'generico' ELSE 'original' END AS tipo,
                  m.fabricante_moto_id, f.nombre AS fabricante_moto, m.activo, m.es_demo
           FROM marcas_repuesto m LEFT JOIN fabricantes_moto f ON f.id = m.fabricante_moto_id
           ORDER BY (m.fabricante_moto_id IS NOT NULL) DESC, m.nombre`,
        )
      ).rows,
    ),
  ),
);
admin.post(
  '/marcas',
  soloAdmin,
  h(async (req, res) => {
    const d = z
      .object({
        nombre: z.string().trim().min(2).max(80),
        tipo: z.enum(['original', 'generico']).default('generico'),
        fabricante_moto_id: z.number().int().positive().nullable().optional(),
      })
      .parse(req.body);
    let fabricanteId = d.fabricante_moto_id ?? null;
    if (d.tipo === 'original' && !fabricanteId) {
      const f = await pool.query('SELECT id FROM fabricantes_moto WHERE lower(nombre) = lower($1)', [d.nombre]);
      fabricanteId = f.rows[0]?.id ?? null;
      if (!fabricanteId) {
        throw new AppError(400, 'FABRICANTE_REQUERIDO', 'Una marca original debe ser la de un fabricante de motos registrado (Yamaha, Honda, Bajaj…)');
      }
    }
    try {
      await enTransaccion(async (db) => {
        const { rows } = await db.query('INSERT INTO marcas_repuesto (nombre, fabricante_moto_id) VALUES ($1, $2) RETURNING *', [d.nombre, fabricanteId]);
        ok(res, { ...rows[0], tipo: fabricanteId ? 'original' : 'generico' }, 201);
      }, { usuarioId: req.usuario!.id });
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError(409, 'MARCA_DUPLICADA', 'Ya existe una marca con ese nombre o para ese fabricante');
      throw e;
    }
  }),
);

admin.get(
  '/categorias',
  h(async (_req, res) => {
    await asegurarCategorias();
    ok(res, categoriasHoja().map(({ clave, etiqueta, requierePosicion, seguridad, padre }) => ({ clave, etiqueta, requierePosicion, seguridad, grupo: padre })));
  }),
);

admin.get(
  '/fabricantes',
  h(async (_req, res) => ok(res, (await pool.query('SELECT id, nombre, slug, activo, orden FROM fabricantes_moto ORDER BY orden, nombre')).rows)),
);

admin.get(
  '/modelos',
  h(async (_req, res) =>
    ok(
      res,
      (
        await pool.query(
          `SELECT mo.*, f.nombre AS fabricante FROM modelos_motocicleta mo JOIN fabricantes_moto f ON f.id = mo.fabricante_id ORDER BY f.nombre, mo.nombre`,
        )
      ).rows,
    ),
  ),
);
const esquemaModelo = z.object({
  fabricante_id: z.number().int().positive(),
  nombre: z.string().trim().min(1).max(80),
  cilindraje_cc: z.number().int().positive().nullable().optional(),
  anio_inicio: z.number().int().min(1950).max(2100).nullable().optional(),
  anio_fin: z.number().int().min(1950).max(2100).nullable().optional(),
  alias: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  activo: z.boolean().default(true),
});
function erroresModelo(e: unknown): never {
  const code = (e as { code?: string }).code;
  if (code === '23505') throw new AppError(409, 'MODELO_DUPLICADO', 'Ese fabricante ya tiene un modelo con ese nombre');
  if (code === '23503') throw new AppError(400, 'FABRICANTE_INVALIDO', 'El fabricante no existe');
  throw e;
}
admin.post(
  '/modelos',
  soloAdmin,
  h(async (req, res) => {
    const d = esquemaModelo.parse(req.body);
    const alias = [...new Set(d.alias.map((a) => a.toLowerCase()))];
    try {
      const { rows } = await enTransaccion(
        (db) =>
          db.query(
            'INSERT INTO modelos_motocicleta (fabricante_id, nombre, cilindraje_cc, anio_inicio, anio_fin, alias, activo) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *',
            [d.fabricante_id, d.nombre, d.cilindraje_cc ?? null, d.anio_inicio ?? null, d.anio_fin ?? null, alias, d.activo],
          ),
        { usuarioId: req.usuario!.id },
      );
      ok(res, rows[0], 201);
    } catch (e) {
      erroresModelo(e);
    }
  }),
);
admin.put(
  '/modelos/:id',
  soloAdmin,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const d = esquemaModelo.parse(req.body);
    let rows;
    try {
      ({ rows } = await enTransaccion(
        (db) =>
          db.query(
            'UPDATE modelos_motocicleta SET fabricante_id=$2, nombre=$3, cilindraje_cc=$4, anio_inicio=$5, anio_fin=$6, alias=$7, activo=$8 WHERE id=$1 RETURNING *',
            [id, d.fabricante_id, d.nombre, d.cilindraje_cc ?? null, d.anio_inicio ?? null, d.anio_fin ?? null, [...new Set(d.alias.map((a) => a.toLowerCase()))], d.activo],
          ),
        { usuarioId: req.usuario!.id },
      ));
    } catch (e) {
      erroresModelo(e);
    }
    if (!rows?.[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Modelo no encontrado');
    ok(res, rows[0]);
  }),
);

// =====================================================================
// Productos
// =====================================================================
admin.get(
  '/productos',
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

admin.get(
  '/productos/:id',
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const { rows } = await pool.query(
      `SELECT p.*, cat.slug AS categoria, ma.nombre AS marca, i.cantidad, i.stock_minimo, i.ubicacion, i.tiempo_abastecimiento_dias, e.estado AS estado_stock
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
  nombre: z.string().trim().min(2).max(160),
  descripcion: z.string().trim().max(2000).nullable().optional(),
  categoria: z.string().trim().min(2).max(40),
  posicion: z.enum(['delantero', 'trasero']).nullable().optional(),
  marca_id: z.number().int().positive(),
  /** Solo para marcas que no son de un fabricante de motos. */
  tipo: z.enum(['generico', 'alternativo']).optional(),
  precio: z.number().positive().max(99_999_999).multipleOf(0.01).nullable(),
  activo: z.boolean().default(true),
  stock_minimo: z.number().int().min(0).max(100000).default(2),
  ubicacion: z.string().trim().max(60).nullable().optional(),
  tiempo_abastecimiento_dias: z.number().int().positive().max(365).nullable().optional(),
});

const aSku = (ref: string) => ref.trim().toUpperCase().replace(/\s+/g, '-');

/** Resuelve la categoría (debe ser una categoría hoja activa) y el tipo según la marca. */
async function resolverProducto(db: { query: typeof pool.query }, d: z.infer<typeof esquemaProducto>) {
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
  if (err.code === '23505') throw new AppError(409, 'REFERENCIA_DUPLICADA', 'Ya existe un producto con esa referencia');
  if (err.code === '23514' && err.constraint === 'ck_producto_original_oem') throw new AppError(400, 'TIPO_INVALIDO', (e as Error).message);
  throw e;
}

admin.post(
  '/productos',
  soloAdmin,
  h(async (req, res) => {
    const d = esquemaProducto.parse(req.body);
    try {
      const prod = await enTransaccion(async (db) => {
        const { categoriaId, tipo } = await resolverProducto(db, d);
        const { rows } = await db.query(
          `INSERT INTO productos (sku, referencia, nombre, descripcion, categoria_id, posicion, marca_id, tipo, precio, activo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *, $11::text AS categoria`,
          [aSku(d.referencia), d.referencia.trim().toUpperCase(), d.nombre, d.descripcion ?? null, categoriaId, d.posicion ?? null, d.marca_id, tipo, d.precio, d.activo, d.categoria],
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

admin.put(
  '/productos/:id',
  soloAdmin,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const d = esquemaProducto.parse(req.body);
    try {
      const r = await enTransaccion(async (db) => {
        const antes = (await db.query('SELECT precio FROM productos WHERE id = $1 FOR UPDATE', [id])).rows[0];
        if (!antes) throw new AppError(404, 'NO_ENCONTRADO', 'Producto no encontrado');
        const { categoriaId, tipo } = await resolverProducto(db, d);
        const { rows } = await db.query(
          `UPDATE productos SET sku=$2, referencia=$3, nombre=$4, descripcion=$5, categoria_id=$6, posicion=$7, marca_id=$8, tipo=$9, precio=$10, activo=$11
           WHERE id=$1 RETURNING *, $12::text AS categoria`,
          [id, aSku(d.referencia), d.referencia.trim().toUpperCase(), d.nombre, d.descripcion ?? null, categoriaId, d.posicion ?? null, d.marca_id, tipo, d.precio, d.activo, d.categoria],
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

admin.post(
  '/productos/:id/compatibilidades',
  soloAdmin,
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

admin.put(
  '/compatibilidades/:id',
  soloAdmin,
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

admin.delete(
  '/compatibilidades/:id',
  soloAdmin,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const { rowCount } = await enTransaccion((db) => db.query('DELETE FROM compatibilidades WHERE id = $1', [id]), { usuarioId: req.usuario!.id });
    if (!rowCount) throw new AppError(404, 'NO_ENCONTRADO', 'Compatibilidad no encontrada');
    void registrarEvento('info', 'compatibilidad_eliminada', 'Compatibilidad eliminada', { compatibilidad_id: id, asesor_id: req.usuario!.id });
    ok(res, { eliminada: true });
  }),
);

// =====================================================================
// Inventario
// =====================================================================
admin.get(
  '/inventario/alertas',
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
admin.post(
  '/inventario/:productoId/movimientos',
  operacion,
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

admin.get(
  '/inventario/:productoId/movimientos',
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

// =====================================================================
// Cotizaciones y pedidos
// =====================================================================
admin.get(
  '/cotizaciones',
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
admin.get('/cotizaciones/:codigo', h(async (req, res) => ok(res, await obtenerCotizacion(String(req.params.codigo)))));
admin.patch(
  '/cotizaciones/:codigo',
  operacion,
  h(async (req, res) => {
    const { estado } = z.object({ estado: z.enum(['anulada', 'vencida']) }).parse(req.body);
    const { rows } = await pool.query(`UPDATE cotizaciones SET estado = $2 WHERE codigo = $1 AND estado = 'emitida' RETURNING codigo, estado`, [req.params.codigo, estado]);
    if (!rows[0]) throw new AppError(409, 'TRANSICION_INVALIDA', 'Solo se pueden anular o vencer cotizaciones emitidas');
    ok(res, rows[0]);
  }),
);

admin.get(
  '/pedidos',
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
admin.get('/pedidos/:codigo', h(async (req, res) => ok(res, await obtenerPedido(String(req.params.codigo)))));
admin.patch(
  '/pedidos/:codigo',
  operacion,
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

// =====================================================================
// Atención humana
// =====================================================================
admin.get(
  '/transferencias',
  h(async (req, res) => {
    const estado = z.enum(['pendiente', 'en_atencion', 'resuelta']).optional().parse(req.query.estado || undefined);
    const { pagina, tamano, offset } = paginacion(req.query);
    const { rows } = await pool.query(
      `SELECT t.*, a.nombre AS asesor, c.canal, cl.nombre AS cliente,
              (SELECT contenido FROM mensajes m WHERE m.conversacion_id = t.conversacion_id AND m.rol = 'cliente' ORDER BY m.id DESC LIMIT 1) AS ultimo_mensaje
       FROM transferencias_atencion t LEFT JOIN asesores a ON a.id = t.asesor_id
       LEFT JOIN conversaciones c ON c.id = t.conversacion_id LEFT JOIN clientes cl ON cl.id = COALESCE(t.cliente_id, c.cliente_id)
       WHERE ($1::text IS NULL OR t.estado = $1)
       ORDER BY (t.estado = 'pendiente') DESC, t.created_at DESC LIMIT $2 OFFSET $3`,
      [estado ?? null, tamano, offset],
    );
    ok(res, { items: rows, pagina, tamano });
  }),
);
admin.patch(
  '/transferencias/:id',
  operacion,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const { estado } = z.object({ estado: z.enum(['pendiente', 'en_atencion', 'resuelta']) }).parse(req.body);
    ok(res, await cambiarEstadoTransferencia(id, estado, req.usuario!.id));
  }),
);
admin.get(
  '/transferencias/:id/mensajes',
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const t = (await pool.query('SELECT conversacion_id FROM transferencias_atencion WHERE id = $1', [id])).rows[0];
    if (!t) throw new AppError(404, 'NO_ENCONTRADO', 'Solicitud no encontrada');
    if (!t.conversacion_id) return ok(res, { conversacion: null, mensajes: [] });
    const conv = await obtenerConversacion(t.conversacion_id);
    ok(res, { conversacion: conv && { id: conv.id, canal: conv.canal, estado: conv.estado, moto: conv.contexto.moto, carrito: conv.contexto.carrito }, mensajes: await listarMensajes(t.conversacion_id) });
  }),
);
/** El asesor responde al cliente. En web el chat lo recibe consultando; en otros canales se envía por n8n. */
admin.post(
  '/transferencias/:id/mensajes',
  operacion,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const { texto } = z.object({ texto: z.string().trim().min(1).max(2000) }).parse(req.body);
    const t = (await pool.query('SELECT conversacion_id, estado FROM transferencias_atencion WHERE id = $1', [id])).rows[0];
    if (!t?.conversacion_id) throw new AppError(404, 'NO_ENCONTRADO', 'La solicitud no tiene una conversación asociada');
    const conv = await obtenerConversacion(t.conversacion_id);
    if (!conv) throw new AppError(404, 'NO_ENCONTRADO', 'Conversación no encontrada');
    if (t.estado === 'pendiente') await cambiarEstadoTransferencia(id, 'en_atencion', req.usuario!.id);
    const m = await guardarMensaje(conv.id, 'asesor', texto, { asesor_id: req.usuario!.id, asesor: req.usuario!.nombre });
    let entregado: 'chat_web' | 'n8n' | 'no_enviado' = 'chat_web';
    if (conv.canal !== 'web') {
      entregado = 'no_enviado';
      if (config.N8N_SALIENTE_URL && config.WEBHOOK_SECRET) {
        try {
          const okEnvio = await enviarFirmado(config.N8N_SALIENTE_URL, config.WEBHOOK_SECRET, { canal: conv.canal, canal_usuario_id: conv.canal_usuario_id, texto });
          if (okEnvio) entregado = 'n8n';
        } catch (e) {
          void registrarEvento('error', 'mensaje_asesor_no_enviado', 'No se pudo enviar el mensaje del asesor por n8n', { error: (e as Error).message });
        }
      }
    }
    ok(res, { mensaje: m, entregado }, 201);
  }),
);

// =====================================================================
// Configuración del negocio, eventos y usuarios
// =====================================================================
admin.get('/configuracion', h(async (_req, res) => ok(res, Object.values(await obtenerConfiguracion()))));
admin.put(
  '/configuracion/:clave',
  soloAdmin,
  h(async (req, res) => {
    const d = z.object({ valor: z.unknown(), confirmado: z.boolean() }).parse(req.body);
    if (d.confirmado && (d.valor === null || d.valor === undefined || d.valor === '')) {
      throw new AppError(400, 'VALOR_REQUERIDO', 'No puedes marcar como confirmado un dato vacío');
    }
    const { rows } = await pool.query(
      'UPDATE configuracion_negocio SET valor = $2, confirmado = $3, updated_at = now() WHERE clave = $1 RETURNING clave, valor, descripcion, confirmado',
      [req.params.clave, d.valor === undefined ? null : JSON.stringify(d.valor), d.confirmado],
    );
    if (!rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Clave de configuración no encontrada');
    void registrarEvento('info', 'configuracion_actualizada', `Configuración "${req.params.clave}" actualizada`, { asesor_id: req.usuario!.id });
    ok(res, rows[0]);
  }),
);

admin.get(
  '/eventos',
  soloAdmin,
  h(async (req, res) => {
    const { pagina, tamano, offset } = paginacion(req.query);
    const nivel = z.enum(['info', 'aviso', 'error']).optional().parse(req.query.nivel || undefined);
    const { rows } = await pool.query(
      'SELECT * FROM registros_eventos WHERE ($1::text IS NULL OR nivel = $1) ORDER BY id DESC LIMIT $2 OFFSET $3',
      [nivel ?? null, tamano, offset],
    );
    ok(res, { items: rows, pagina, tamano });
  }),
);

admin.get('/asesores', soloAdmin, h(async (_req, res) => ok(res, (await pool.query('SELECT id, nombre, email, rol, activo, created_at, ultimo_acceso FROM asesores ORDER BY nombre')).rows)));
admin.post(
  '/asesores',
  soloAdmin,
  h(async (req, res) => {
    const d = z
      .object({ nombre: z.string().trim().min(2).max(120), email: z.string().email().max(160), password: z.string().min(10).max(200), rol: z.enum(['admin', 'vendedor', 'consulta']) })
      .parse(req.body);
    ok(res, await crearAsesor(d), 201);
  }),
);
admin.patch(
  '/asesores/:id',
  soloAdmin,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const d = z.object({ activo: z.boolean().optional(), rol: z.enum(['admin', 'vendedor', 'consulta']).optional() }).parse(req.body);
    if (id === req.usuario!.id && (d.activo === false || (d.rol && d.rol !== 'admin'))) {
      throw new AppError(400, 'OPERACION_NO_PERMITIDA', 'No puedes desactivarte ni quitarte el rol de administrador a ti mismo');
    }
    const { rows } = await pool.query(
      'UPDATE asesores SET activo = COALESCE($2, activo), rol = COALESCE($3, rol) WHERE id = $1 RETURNING id, nombre, email, rol, activo',
      [id, d.activo ?? null, d.rol ?? null],
    );
    if (!rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Usuario no encontrado');
    ok(res, rows[0]);
  }),
);
