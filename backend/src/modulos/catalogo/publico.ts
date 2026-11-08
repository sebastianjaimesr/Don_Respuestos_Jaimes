import { z } from 'zod';
import { pool } from '../../db';
import { AppError } from '../../errores';
import { asegurarCategorias, categoriaPorClave, esCategoriaDeSeguridad, hijasDe } from './categorias';

/**
 * Catálogo público de la tienda. Solo productos activos. Todo lo que no está
 * confirmado se marca así (precio null = "por confirmar"); nada se inventa.
 * La compatibilidad con una moto solo cuenta si está VERIFICADA.
 */

export const esquemaFiltros = z.object({
  q: z.string().trim().max(80).optional(),
  categoria: z.string().trim().max(40).optional(), // categoría hoja o grupo
  fabricante: z.coerce.number().int().positive().optional(),
  modelo: z.coerce.number().int().positive().optional(),
  version: z.coerce.number().int().positive().optional(),
  anio: z.coerce.number().int().min(1950).max(2100).optional(),
  cilindraje: z.coerce.number().int().positive().max(3000).optional(),
  marca: z.coerce.number().int().positive().optional(),
  tipo: z.enum(['original', 'generico', 'alternativo']).optional(),
  precio_min: z.coerce.number().min(0).optional(),
  precio_max: z.coerce.number().min(0).optional(),
  disponible: z.enum(['true', 'false']).optional(),
  destacado: z.enum(['true', 'false']).optional(),
  orden: z.enum(['relevancia', 'precio_asc', 'precio_desc', 'nombre', 'recientes']).default('relevancia'),
  pagina: z.coerce.number().int().min(1).default(1),
  tamano: z.coerce.number().int().min(1).max(60).default(24),
});
export type FiltrosCatalogo = z.infer<typeof esquemaFiltros>;

// Columnas comunes de una tarjeta de producto
const TARJETA = `
  p.id, p.slug, p.sku, p.referencia, p.nombre, p.tipo, vp.precio, vp.precio_lista, vp.promocion, vp.promocion_termina_at, p.destacado, p.es_demo, p.posicion,
  cat.slug AS categoria, cat.nombre AS categoria_nombre, ma.nombre AS marca,
  e.estado AS disponibilidad,
  (SELECT url FROM producto_imagenes im WHERE im.producto_id = p.id ORDER BY im.es_principal DESC, im.orden, im.id LIMIT 1) AS imagen`;
const DESDE = `
  FROM productos p
  JOIN categorias cat ON cat.id = p.categoria_id
  JOIN marcas_repuesto ma ON ma.id = p.marca_id
  JOIN v_estado_inventario e ON e.producto_id = p.id
  JOIN v_precio_vigente vp ON vp.producto_id = p.id`;

const aTarjeta = (f: Record<string, any>) => ({
  id: f.id,
  slug: f.slug,
  sku: f.sku,
  referencia: f.referencia,
  nombre: f.nombre,
  tipo: f.tipo,
  marca: f.marca,
  categoria: { clave: f.categoria, etiqueta: f.categoria_nombre },
  posicion: f.posicion,
  precio: f.precio as string | null,
  precio_confirmado: f.precio !== null,
  promocion: f.promocion
    ? { nombre: f.promocion as string, precio_antes: f.precio_lista as string, termina_at: new Date(f.promocion_termina_at).toISOString() }
    : null,
  disponibilidad: f.disponibilidad as 'disponible' | 'stock_bajo' | 'agotado' | 'sin_registro',
  imagen: f.imagen as string | null,
  destacado: f.destacado,
  es_demo: f.es_demo,
});

class Params {
  valores: unknown[] = [];
  add(v: unknown) {
    this.valores.push(v);
    return `$${this.valores.length}`;
  }
}

export async function listarProductos(f: FiltrosCatalogo) {
  await asegurarCategorias();
  const pr = new Params();
  const where: string[] = ['p.activo'];
  let relevancia = '0';

  if (f.q) {
    const q = pr.add(f.q);
    // 1) SKU, referencia o código de barras exactos; 2) texto completo en español
    // (sin tildes, con raíces: "frenos" ≈ "freno"); 3) trigramas para errores de digitación.
    where.push(`(
      p.sku = upper(regexp_replace(btrim(${q}), '\\s+', '-', 'g')) OR upper(btrim(p.referencia)) = upper(btrim(${q}))
      OR p.codigo_barras = btrim(${q})
      OR p.busqueda @@ plainto_tsquery('spanish', f_normalizar(${q}))
      OR word_similarity(f_normalizar(${q}), f_normalizar(p.nombre)) > 0.45
      OR f_coincide_aprox(${q}, p.nombre)
    )`);
    relevancia = `(CASE WHEN p.sku = upper(regexp_replace(btrim(${q}), '\\s+', '-', 'g')) OR upper(btrim(p.referencia)) = upper(btrim(${q})) OR p.codigo_barras = btrim(${q}) THEN 10 ELSE 0 END
      + ts_rank(p.busqueda, plainto_tsquery('spanish', f_normalizar(${q})))
      + word_similarity(f_normalizar(${q}), f_normalizar(p.nombre)))`;
  }
  if (f.categoria) {
    const c = categoriaPorClave(f.categoria);
    if (!c) throw new AppError(400, 'CATEGORIA_INVALIDA', 'Esa categoría no existe');
    const claves = c.padre === null ? hijasDe(c.clave).map((h) => h.clave) : [c.clave];
    where.push(`cat.slug = ANY(${pr.add(claves)}::text[])`);
  }
  if (f.marca) where.push(`p.marca_id = ${pr.add(f.marca)}`);
  if (f.tipo) where.push(`p.tipo = ${pr.add(f.tipo)}`);
  if (f.precio_min !== undefined) where.push(`vp.precio >= ${pr.add(f.precio_min)}`);
  if (f.precio_max !== undefined) where.push(`vp.precio <= ${pr.add(f.precio_max)}`);
  if (f.disponible === 'true') where.push(`e.estado IN ('disponible', 'stock_bajo')`);
  if (f.destacado === 'true') where.push('p.destacado');

  // Filtro por moto: solo compatibilidades verificadas
  if (f.fabricante || f.modelo || f.version || f.anio || f.cilindraje) {
    const cond: string[] = ['c.producto_id = p.id', 'c.verificada'];
    if (f.fabricante) cond.push(`mo.fabricante_id = ${pr.add(f.fabricante)}`);
    if (f.modelo) cond.push(`c.modelo_id = ${pr.add(f.modelo)}`);
    if (f.version) cond.push(`(c.version_id IS NULL OR c.version_id = ${pr.add(f.version)})`);
    if (f.anio) {
      const a = pr.add(f.anio);
      cond.push(`${a} BETWEEN c.anio_desde AND c.anio_hasta`);
    }
    if (f.cilindraje) cond.push(`mo.cilindraje_cc = ${pr.add(f.cilindraje)}`);
    where.push(`EXISTS (SELECT 1 FROM compatibilidades c JOIN modelos_motocicleta mo ON mo.id = c.modelo_id WHERE ${cond.join(' AND ')})`);
  }

  const orden = {
    relevancia: f.q ? `${relevancia} DESC, p.destacado DESC, p.nombre` : 'p.destacado DESC, (vp.precio IS NULL), p.nombre, p.id',
    precio_asc: 'vp.precio ASC NULLS LAST, p.nombre',
    precio_desc: 'vp.precio DESC NULLS LAST, p.nombre',
    nombre: 'p.nombre, p.id',
    recientes: 'p.created_at DESC, p.id DESC',
  }[f.orden];

  const sqlWhere = `WHERE ${where.join(' AND ')}`;
  const offset = (f.pagina - 1) * f.tamano;
  const [lista, total] = await Promise.all([
    pool.query(`SELECT ${TARJETA} ${DESDE} ${sqlWhere} ORDER BY ${orden} LIMIT ${f.tamano} OFFSET ${offset}`, pr.valores),
    pool.query(`SELECT COUNT(*)::int AS n ${DESDE} ${sqlWhere}`, pr.valores),
  ]);
  return { items: lista.rows.map(aTarjeta), total: total.rows[0].n as number, pagina: f.pagina, tamano: f.tamano };
}

export async function detalleProducto(slug: string) {
  await asegurarCategorias();
  const { rows } = await pool.query(
    `SELECT ${TARJETA}, p.descripcion, p.especificaciones, e.cantidad, e.tiempo_abastecimiento_dias, g.slug AS grupo, g.nombre AS grupo_nombre
     ${DESDE} LEFT JOIN categorias g ON g.id = cat.padre_id
     WHERE p.slug = $1 AND p.activo`,
    [slug],
  );
  const f = rows[0];
  if (!f) throw new AppError(404, 'PRODUCTO_NO_ENCONTRADO', 'Ese producto no existe o ya no está disponible');
  const [imgs, compat] = await Promise.all([
    pool.query('SELECT url, alt, es_principal FROM producto_imagenes WHERE producto_id = $1 ORDER BY es_principal DESC, orden, id', [f.id]),
    pool.query(
      `SELECT fa.nombre AS fabricante, mo.id AS modelo_id, mo.nombre AS modelo, v.nombre AS version, c.anio_desde, c.anio_hasta, c.verificada, c.notas
       FROM compatibilidades c JOIN modelos_motocicleta mo ON mo.id = c.modelo_id JOIN fabricantes_moto fa ON fa.id = mo.fabricante_id
       LEFT JOIN versiones_moto v ON v.id = c.version_id
       WHERE c.producto_id = $1 ORDER BY c.verificada DESC, fa.nombre, mo.nombre, c.anio_desde`,
      [f.id],
    ),
  ]);
  return {
    ...aTarjeta(f),
    descripcion: f.descripcion,
    especificaciones: f.especificaciones,
    grupo: f.grupo ? { clave: f.grupo, etiqueta: f.grupo_nombre } : null,
    // La cantidad exacta se muestra (como en el chat); el abastecimiento solo si el proveedor lo confirmó.
    stock: { cantidad: f.cantidad, tiempo_abastecimiento_dias: f.tiempo_abastecimiento_dias },
    imagenes: imgs.rows,
    compatibilidades: compat.rows,
    advertencia_seguridad: esCategoriaDeSeguridad(f.categoria),
  };
}

/** Misma categoría o que sirven para la misma moto (compatibilidad verificada). */
export async function relacionados(slug: string) {
  const base = await pool.query('SELECT id, categoria_id FROM productos WHERE slug = $1 AND activo', [slug]);
  if (!base.rows[0]) throw new AppError(404, 'PRODUCTO_NO_ENCONTRADO', 'Ese producto no existe o ya no está disponible');
  const { id, categoria_id } = base.rows[0];
  const { rows } = await pool.query(
    `SELECT ${TARJETA} ${DESDE}
     WHERE p.activo AND p.id <> $1 AND (
       p.categoria_id = $2 OR EXISTS (
         SELECT 1 FROM compatibilidades a JOIN compatibilidades b ON b.modelo_id = a.modelo_id
         WHERE a.producto_id = $1 AND a.verificada AND b.producto_id = p.id AND b.verificada
           AND a.anio_desde <= b.anio_hasta AND b.anio_desde <= a.anio_hasta))
     ORDER BY (p.categoria_id = $2) DESC, (vp.precio IS NULL), p.destacado DESC, p.nombre LIMIT 8`,
    [id, categoria_id],
  );
  return rows.map(aTarjeta);
}

export async function destacados() {
  const { rows } = await pool.query(`SELECT ${TARJETA} ${DESDE} WHERE p.activo AND p.destacado AND vp.precio IS NOT NULL ORDER BY p.nombre LIMIT 12`);
  return rows.map(aTarjeta);
}

/** Autocompletar del buscador: productos, categorías y motos. */
export async function sugerencias(q: string) {
  await asegurarCategorias();
  const t = q.trim();
  if (t.length < 2) return { productos: [], categorias: [], motos: [] };
  const [prods, motos, cats] = await Promise.all([
    pool.query(
      `SELECT p.slug, p.nombre, p.sku FROM productos p
       WHERE p.activo AND (p.busqueda @@ plainto_tsquery('spanish', f_normalizar($1)) OR word_similarity(f_normalizar($1), f_normalizar(p.nombre)) > 0.45 OR f_coincide_aprox($1, p.nombre)
                           OR p.sku ILIKE upper(regexp_replace(btrim($1), '\\s+', '-', 'g')) || '%')
       ORDER BY ts_rank(p.busqueda, plainto_tsquery('spanish', f_normalizar($1))) DESC, p.nombre LIMIT 6`,
      [t],
    ),
    pool.query(
      `SELECT mo.id, mo.nombre, f.id AS fabricante_id, f.nombre AS fabricante FROM modelos_motocicleta mo JOIN fabricantes_moto f ON f.id = mo.fabricante_id
       WHERE mo.activo AND (f_normalizar(f.nombre || ' ' || mo.nombre) LIKE '%' || f_normalizar($1) || '%'
                            OR EXISTS (SELECT 1 FROM unnest(mo.alias) a WHERE f_normalizar(a) LIKE f_normalizar($1) || '%'))
       ORDER BY f.orden, mo.nombre LIMIT 6`,
      [t],
    ),
    pool.query(
      `SELECT c.slug AS clave, c.nombre AS etiqueta FROM categorias c
       WHERE c.activo AND (f_normalizar(c.nombre) LIKE '%' || f_normalizar($1) || '%'
                           OR EXISTS (SELECT 1 FROM unnest(c.sinonimos) s WHERE s LIKE f_normalizar($1) || '%'))
       ORDER BY c.padre_id NULLS FIRST, c.orden LIMIT 6`,
      [t],
    ),
  ]);
  return { productos: prods.rows, categorias: cats.rows, motos: motos.rows };
}

export async function fabricantesActivos() {
  const { rows } = await pool.query(
    `SELECT f.id, f.nombre, f.slug, f.logo_url, (SELECT COUNT(*)::int FROM modelos_motocicleta mo WHERE mo.fabricante_id = f.id AND mo.activo) AS modelos
     FROM fabricantes_moto f WHERE f.activo ORDER BY f.orden, f.nombre`,
  );
  return rows;
}

export async function modelosDeFabricante(fabricanteId: number) {
  const { rows } = await pool.query(
    `SELECT id, nombre, cilindraje_cc, anio_inicio, anio_fin, tipo_moto FROM modelos_motocicleta WHERE fabricante_id = $1 AND activo ORDER BY nombre`,
    [fabricanteId],
  );
  return rows;
}

export async function versionesDeModelo(modeloId: number) {
  const { rows } = await pool.query(
    'SELECT id, nombre, cilindraje_cc, anio_desde, anio_hasta FROM versiones_moto WHERE modelo_id = $1 AND activo ORDER BY anio_desde NULLS FIRST, nombre',
    [modeloId],
  );
  return rows;
}

export async function tarifasEnvio() {
  const { rows } = await pool.query('SELECT ciudad, departamento, costo, dias_estimados FROM tarifas_envio WHERE activo ORDER BY ciudad');
  return rows;
}
