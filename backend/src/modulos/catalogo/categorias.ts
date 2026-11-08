import { pool } from '../../db';
import { normalizar } from '../../utils/texto';

/**
 * Categorías de repuestos. Viven en la tabla `categorias` (árbol de dos
 * niveles: grupo › categoría) y se administran desde el panel.
 *
 * Aquí se guardan en memoria para que el asistente pueda detectarlas sin
 * consultar la base de datos en cada palabra. La caché se refresca sola
 * cada minuto y se invalida cuando el panel cambia una categoría.
 *
 * Los productos siempre se asignan a una categoría hoja. Si el cliente
 * nombra un grupo ("los frenos", "algo que haga que la moto frene"), el
 * asistente pregunta cuál de sus categorías necesita.
 */
export interface Categoria {
  id: number;
  clave: string; // slug
  etiqueta: string;
  sinonimos: string[]; // normalizados (minúsculas, sin tildes)
  requierePosicion: boolean; // ¿hay que preguntar delantero/trasero?
  seguridad: boolean; // frenos, dirección, llantas → advertencia obligatoria
  mantenimiento: boolean;
  padre: string | null; // clave del grupo; null si es un grupo
  orden: number;
}

export interface FilaCategoria {
  id: number;
  slug: string;
  nombre: string;
  sinonimos: string[];
  requiere_posicion: boolean;
  es_seguridad: boolean;
  es_mantenimiento: boolean;
  padre_slug: string | null;
  orden: number;
}

const VIGENCIA_MS = 60_000;
let cache: Categoria[] = [];
let cargadaEn = 0;
let cargando: Promise<void> | null = null;

/** Reemplaza la caché (lo usa la carga desde la BD y las pruebas unitarias). */
export function establecerCategorias(filas: FilaCategoria[]) {
  cache = filas
    .map((f) => ({
      id: f.id,
      clave: f.slug,
      etiqueta: f.nombre,
      sinonimos: (f.sinonimos ?? []).map(normalizar).filter(Boolean),
      requierePosicion: f.requiere_posicion,
      seguridad: f.es_seguridad,
      mantenimiento: f.es_mantenimiento,
      padre: f.padre_slug,
      orden: f.orden,
    }))
    .sort((a, b) => a.orden - b.orden || a.etiqueta.localeCompare(b.etiqueta));
  cargadaEn = Date.now();
}

async function cargar() {
  const { rows } = await pool.query<FilaCategoria>(
    `SELECT c.id, c.slug, c.nombre, c.sinonimos, c.requiere_posicion, c.es_seguridad, c.es_mantenimiento, c.orden, g.slug AS padre_slug
     FROM categorias c LEFT JOIN categorias g ON g.id = c.padre_id
     WHERE c.activo AND (g.id IS NULL OR g.activo)`,
  );
  establecerCategorias(rows);
}

/** Garantiza que la caché esté cargada y vigente. */
export async function asegurarCategorias(): Promise<void> {
  if (cache.length && Date.now() - cargadaEn < VIGENCIA_MS) return;
  cargando ??= cargar().finally(() => {
    cargando = null;
  });
  await cargando;
}

/** Llamar después de crear, editar o desactivar una categoría. */
export function invalidarCategorias() {
  cargadaEn = 0;
}

export const todasLasCategorias = () => cache;
/** Categorías hoja: las que se asignan a productos. */
export const categoriasHoja = () => cache.filter((c) => c.padre !== null);
export const gruposDeCategorias = () => cache.filter((c) => c.padre === null);
export const hijasDe = (grupo: string) => cache.filter((c) => c.padre === grupo);
export const categoriaPorClave = (clave: string) => cache.find((c) => c.clave === clave);
export const esCategoriaDeSeguridad = (clave: string) => categoriaPorClave(clave)?.seguridad ?? false;

/** Forma pública: grupos con sus categorías. */
export function arbolDeCategorias() {
  return gruposDeCategorias().map((g) => ({
    clave: g.clave,
    etiqueta: g.etiqueta,
    categorias: hijasDe(g.clave).map(({ clave, etiqueta, requierePosicion, seguridad, mantenimiento }) => ({
      clave,
      etiqueta,
      requierePosicion,
      seguridad,
      mantenimiento,
    })),
  }));
}

export const ADVERTENCIA_SEGURIDAD =
  '⚠️ Por tu seguridad, este repuesto (frenos, dirección o llantas) debe tener la compatibilidad confirmada antes de instalarlo. Si tienes dudas, que lo revise un mecánico.';
