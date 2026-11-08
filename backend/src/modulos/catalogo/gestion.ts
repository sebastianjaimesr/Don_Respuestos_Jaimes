import { z } from 'zod';
import { enTransaccion, pool } from '../../db';
import { AppError } from '../../errores';
import { invalidarCategorias } from './categorias';

/**
 * Gestión del catálogo desde el panel: fabricantes, versiones, categorías,
 * marcas y proveedores. Toda escritura corre con el asesor en la transacción
 * para que la auditoría registre quién la hizo.
 */

const aSlug = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
const alias = (l: string[]) => [...new Set(l.map((a) => a.trim().toLowerCase()).filter(Boolean))];

/** Traduce errores de PostgreSQL a mensajes claros. */
function traducir(e: unknown, duplicado: string, referencia = 'Un dato relacionado no existe'): never {
  const err = e as { code?: string; constraint?: string; message?: string };
  if (err.code === '23505') throw new AppError(409, 'DUPLICADO', duplicado);
  if (err.code === '23503') throw new AppError(400, 'REFERENCIA_INVALIDA', referencia);
  if (err.code === '23514' && err.constraint?.startsWith('ck_marca')) throw new AppError(409, 'MARCA_CON_PRODUCTOS', err.message ?? 'La marca ya tiene productos');
  throw e;
}

async function escribir<T>(usuarioId: number, fn: (db: { query: typeof pool.query }) => Promise<T>, duplicado: string, referencia?: string): Promise<T> {
  try {
    return await enTransaccion(fn, { usuarioId });
  } catch (e) {
    traducir(e, duplicado, referencia);
  }
}

const noEncontrado = (que: string) => new AppError(404, 'NO_ENCONTRADO', `${que} no encontrado`);

// ---------------- Fabricantes ----------------
export const esquemaFabricante = z.object({
  nombre: z.string().trim().min(2).max(60),
  alias: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
  logo_url: z.string().trim().url().max(600).startsWith('https://').nullable().optional(),
  orden: z.number().int().min(0).max(1000).default(100),
  activo: z.boolean().default(true),
});

export async function crearFabricante(d: z.infer<typeof esquemaFabricante>, usuarioId: number) {
  return escribir(
    usuarioId,
    async (db) =>
      (
        await db.query('INSERT INTO fabricantes_moto (nombre, slug, alias, logo_url, orden, activo) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *', [
          d.nombre,
          aSlug(d.nombre),
          alias(d.alias),
          d.logo_url ?? null,
          d.orden,
          d.activo,
        ])
      ).rows[0],
    'Ya existe un fabricante con ese nombre',
  );
}

export async function actualizarFabricante(id: number, d: z.infer<typeof esquemaFabricante>, usuarioId: number) {
  const r = await escribir(
    usuarioId,
    async (db) =>
      (
        await db.query('UPDATE fabricantes_moto SET nombre=$2, slug=$3, alias=$4, logo_url=$5, orden=$6, activo=$7 WHERE id=$1 RETURNING *', [
          id,
          d.nombre,
          aSlug(d.nombre),
          alias(d.alias),
          d.logo_url ?? null,
          d.orden,
          d.activo,
        ])
      ).rows[0],
    'Ya existe un fabricante con ese nombre',
  );
  if (!r) throw noEncontrado('Fabricante');
  return r;
}

// ---------------- Versiones de un modelo ----------------
export const esquemaVersion = z
  .object({
    modelo_id: z.number().int().positive(),
    nombre: z.string().trim().min(1).max(60),
    cilindraje_cc: z.number().int().positive().max(3000).nullable().optional(),
    anio_desde: z.number().int().min(1950).max(2100).nullable().optional(),
    anio_hasta: z.number().int().min(1950).max(2100).nullable().optional(),
    alias: z.array(z.string().trim().min(1).max(40)).max(20).default([]),
    activo: z.boolean().default(true),
  })
  .refine((v) => !v.anio_desde || !v.anio_hasta || v.anio_desde <= v.anio_hasta, { message: 'El año inicial no puede ser mayor que el final', path: ['anio_hasta'] });

export async function listarVersiones(modeloId?: number) {
  const { rows } = await pool.query(
    `SELECT v.*, mo.nombre AS modelo FROM versiones_moto v JOIN modelos_motocicleta mo ON mo.id = v.modelo_id
     WHERE ($1::int IS NULL OR v.modelo_id = $1) ORDER BY mo.nombre, v.anio_desde NULLS FIRST, v.nombre`,
    [modeloId ?? null],
  );
  return rows;
}

export async function guardarVersion(id: number | null, d: z.infer<typeof esquemaVersion>, usuarioId: number) {
  const valores = [d.modelo_id, d.nombre, d.cilindraje_cc ?? null, d.anio_desde ?? null, d.anio_hasta ?? null, alias(d.alias), d.activo];
  const r = await escribir(
    usuarioId,
    async (db) =>
      id
        ? (await db.query('UPDATE versiones_moto SET modelo_id=$2, nombre=$3, cilindraje_cc=$4, anio_desde=$5, anio_hasta=$6, alias=$7, activo=$8 WHERE id=$1 RETURNING *', [id, ...valores])).rows[0]
        : (await db.query('INSERT INTO versiones_moto (modelo_id, nombre, cilindraje_cc, anio_desde, anio_hasta, alias, activo) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', valores)).rows[0],
    'Ese modelo ya tiene una versión con ese nombre',
    'El modelo no existe, o la versión ya se usa en compatibilidades de otro modelo',
  );
  if (!r) throw noEncontrado('Versión');
  return r;
}

// ---------------- Categorías ----------------
export const esquemaCategoria = z.object({
  nombre: z.string().trim().min(2).max(80),
  slug: z
    .string()
    .trim()
    .regex(/^[a-z0-9_]+$/, 'Solo minúsculas, números y guion bajo')
    .max(40)
    .optional(),
  padre: z.string().trim().max(40).nullable().optional(), // slug del grupo; null = es un grupo
  descripcion: z.string().trim().max(500).nullable().optional(),
  sinonimos: z.array(z.string().trim().min(2).max(60)).max(40).default([]),
  requiere_posicion: z.boolean().default(false),
  es_seguridad: z.boolean().default(false),
  es_mantenimiento: z.boolean().default(false),
  icono: z.string().trim().max(40).nullable().optional(),
  orden: z.number().int().min(0).max(1000).default(100),
  activo: z.boolean().default(true),
});

export async function listarCategoriasAdmin() {
  const { rows } = await pool.query(
    `SELECT c.*, g.slug AS padre, (SELECT COUNT(*)::int FROM productos p WHERE p.categoria_id = c.id) AS productos
     FROM categorias c LEFT JOIN categorias g ON g.id = c.padre_id ORDER BY COALESCE(g.orden, c.orden), g.id NULLS FIRST, c.orden, c.nombre`,
  );
  return rows;
}

const normalizarSinonimo = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();

export async function guardarCategoria(id: number | null, d: z.infer<typeof esquemaCategoria>, usuarioId: number) {
  const r = await escribir(
    usuarioId,
    async (db) => {
      let padreId: number | null = null;
      if (d.padre) {
        const g = await db.query('SELECT id, padre_id FROM categorias WHERE slug = $1', [d.padre]);
        if (!g.rows[0] || g.rows[0].padre_id !== null) throw new AppError(400, 'GRUPO_INVALIDO', 'El grupo indicado no existe (solo hay dos niveles: grupo › categoría)');
        padreId = g.rows[0].id;
      }
      if (id) {
        // Un grupo con categorías no puede volverse categoría hoja (se perdería el árbol)
        if (padreId && (await db.query('SELECT 1 FROM categorias WHERE padre_id = $1 LIMIT 1', [id])).rows[0]) {
          throw new AppError(409, 'GRUPO_CON_HIJAS', 'Este grupo tiene categorías: no se puede mover dentro de otro grupo');
        }
        if (!padreId && (await db.query('SELECT 1 FROM productos WHERE categoria_id = $1 LIMIT 1', [id])).rows[0]) {
          throw new AppError(409, 'CATEGORIA_CON_PRODUCTOS', 'Esta categoría tiene productos: debe seguir dentro de un grupo');
        }
      }
      const valores = [
        padreId,
        d.nombre,
        d.descripcion ?? null,
        [...new Set(d.sinonimos.map(normalizarSinonimo))],
        d.requiere_posicion,
        d.es_seguridad,
        d.es_mantenimiento,
        d.icono ?? null,
        d.orden,
        d.activo,
      ];
      if (id) {
        return (
          await db.query(
            `UPDATE categorias SET padre_id=$2, nombre=$3, descripcion=$4, sinonimos=$5, requiere_posicion=$6, es_seguridad=$7, es_mantenimiento=$8, icono=$9, orden=$10, activo=$11
             WHERE id=$1 RETURNING *`,
            [id, ...valores],
          )
        ).rows[0];
      }
      const slug = d.slug ?? aSlug(d.nombre).replace(/-/g, '_');
      return (
        await db.query(
          `INSERT INTO categorias (slug, padre_id, nombre, descripcion, sinonimos, requiere_posicion, es_seguridad, es_mantenimiento, icono, orden, activo)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [slug, ...valores],
        )
      ).rows[0];
    },
    'Ya existe una categoría con esa clave',
  );
  if (!r) throw noEncontrado('Categoría');
  invalidarCategorias();
  return r;
}

// ---------------- Marcas de repuesto ----------------
export const esquemaMarca = z.object({
  nombre: z.string().trim().min(2).max(80),
  fabricante_moto_id: z.number().int().positive().nullable().optional(),
  activo: z.boolean().default(true),
});

export async function actualizarMarca(id: number, d: z.infer<typeof esquemaMarca>, usuarioId: number) {
  const r = await escribir(
    usuarioId,
    async (db) => (await db.query('UPDATE marcas_repuesto SET nombre=$2, fabricante_moto_id=$3, activo=$4 WHERE id=$1 RETURNING *', [id, d.nombre, d.fabricante_moto_id ?? null, d.activo])).rows[0],
    'Ya existe una marca con ese nombre o para ese fabricante',
    'El fabricante no existe',
  );
  if (!r) throw noEncontrado('Marca');
  return { ...r, tipo: r.fabricante_moto_id ? 'original' : 'generico' };
}

// ---------------- Proveedores ----------------
export const esquemaProveedor = z.object({
  nombre: z.string().trim().min(2).max(120),
  nit: z
    .string()
    .trim()
    .regex(/^[0-9-]{5,20}$/, 'NIT inválido')
    .nullable()
    .optional(),
  contacto: z.string().trim().max(120).nullable().optional(),
  telefono: z.string().trim().max(20).nullable().optional(),
  email: z.string().trim().email().max(160).nullable().optional(),
  ciudad: z.string().trim().max(80).nullable().optional(),
  notas: z.string().trim().max(1000).nullable().optional(),
  activo: z.boolean().default(true),
});

export async function listarProveedores() {
  const { rows } = await pool.query(
    `SELECT pr.*, (SELECT COUNT(*)::int FROM productos p WHERE p.proveedor_id = pr.id) AS productos FROM proveedores pr ORDER BY pr.activo DESC, pr.nombre`,
  );
  return rows;
}

export async function guardarProveedor(id: number | null, d: z.infer<typeof esquemaProveedor>, usuarioId: number) {
  const valores = [d.nombre, d.nit ?? null, d.contacto ?? null, d.telefono ?? null, d.email ?? null, d.ciudad ?? null, d.notas ?? null, d.activo];
  const r = await escribir(
    usuarioId,
    async (db) =>
      id
        ? (await db.query('UPDATE proveedores SET nombre=$2, nit=$3, contacto=$4, telefono=$5, email=$6, ciudad=$7, notas=$8, activo=$9 WHERE id=$1 RETURNING *', [id, ...valores])).rows[0]
        : (await db.query('INSERT INTO proveedores (nombre, nit, contacto, telefono, email, ciudad, notas, activo) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *', valores)).rows[0],
    'Ya existe un proveedor con ese nombre o NIT',
  );
  if (!r) throw noEncontrado('Proveedor');
  return r;
}
