import { pool, Consultor } from '../../db';
import { AppError } from '../../errores';
import { detectarCategoria, detectarModelo, ModeloCatalogo } from '../../asistente/extraccion';
import { categoriaPorClave, esCategoriaDeSeguridad } from './categorias';

export interface ResultadoProducto {
  producto_id: number;
  referencia: string;
  nombre: string;
  categoria: string;
  posicion: 'delantero' | 'trasero' | null;
  tipo: 'original' | 'generico';
  marca: string;
  precio: string | null; // NUMERIC como texto; null = precio NO confirmado
  precio_confirmado: boolean;
  disponibilidad: {
    cantidad: number | null;
    estado: 'disponible' | 'stock_bajo' | 'agotado' | 'sin_registro';
    tiempo_abastecimiento_dias: number | null;
  };
  compatibilidad: {
    modelo: string;
    anio_desde: number;
    anio_hasta: number;
    verificada: boolean;
    fuente: string | null;
    notas: string | null;
  };
  advertencia_seguridad: boolean;
  es_demo: boolean;
}

export type EstadoBusqueda =
  | 'ok'
  | 'modelo_no_encontrado'
  | 'modelo_ambiguo'
  | 'repuesto_no_reconocido'
  | 'repuesto_ambiguo'
  | 'anio_no_compatible'
  | 'sin_resultados';

export interface ResultadoBusqueda {
  estado: EstadoBusqueda;
  modelo: { id: number; nombre: string } | null;
  candidatos_modelo?: { id: number; nombre: string }[];
  anio: number;
  categoria: string | null;
  opciones_categoria?: string[];
  resultados: ResultadoProducto[];
  /** Productos que sí son del modelo pero NO del año pedido (no se deben ofrecer como compatibles) */
  fuera_de_rango: ResultadoProducto[];
}

export async function listarModelos(db: Consultor = pool): Promise<ModeloCatalogo[]> {
  const { rows } = await db.query<ModeloCatalogo>('SELECT id, nombre, alias FROM modelos_motocicleta WHERE activo ORDER BY nombre');
  return rows;
}

const SELECT_PRODUCTO = `
  SELECT p.id AS producto_id, p.referencia, p.nombre, p.categoria, p.posicion, p.tipo, ma.nombre AS marca,
         p.precio, p.es_demo, e.cantidad, e.estado, e.tiempo_abastecimiento_dias,
         mo.nombre AS modelo, c.anio_desde, c.anio_hasta, c.verificada, c.fuente, c.notas
  FROM productos p
  JOIN marcas ma ON ma.id = p.marca_id
  JOIN v_estado_inventario e ON e.producto_id = p.id
  JOIN compatibilidades c ON c.producto_id = p.id
  JOIN modelos_motocicleta mo ON mo.id = c.modelo_id`;

type FilaProducto = Record<string, any>;

function aResultado(f: FilaProducto): ResultadoProducto {
  return {
    producto_id: f.producto_id,
    referencia: f.referencia,
    nombre: f.nombre,
    categoria: f.categoria,
    posicion: f.posicion,
    tipo: f.tipo,
    marca: f.marca,
    precio: f.precio,
    precio_confirmado: f.precio !== null,
    disponibilidad: { cantidad: f.cantidad, estado: f.estado, tiempo_abastecimiento_dias: f.tiempo_abastecimiento_dias },
    compatibilidad: {
      modelo: f.modelo,
      anio_desde: f.anio_desde,
      anio_hasta: f.anio_hasta,
      verificada: f.verificada,
      fuente: f.fuente,
      notas: f.notas,
    },
    advertencia_seguridad: esCategoriaDeSeguridad(f.categoria),
    es_demo: f.es_demo,
  };
}

/**
 * HERRAMIENTA buscar_repuesto(modelo, año, repuesto)
 * Consulta exclusivamente la base de datos. Si algo no está, lo dice; nunca lo inventa.
 */
export async function buscarRepuesto(entrada: {
  modelo: string | number;
  anio: number;
  repuesto: string;
  posicion?: 'delantero' | 'trasero' | null;
  tipo?: 'original' | 'generico' | null;
}): Promise<ResultadoBusqueda> {
  const base = { anio: entrada.anio, resultados: [], fuera_de_rango: [] } as const;
  if (!Number.isInteger(entrada.anio) || entrada.anio < 1980 || entrada.anio > new Date().getFullYear() + 1) {
    throw new AppError(400, 'ANIO_INVALIDO', 'El año de la moto no es válido');
  }

  // 1. Resolver modelo
  const modelos = await listarModelos();
  let modelo: ModeloCatalogo | undefined;
  if (typeof entrada.modelo === 'number' || /^\d+$/.test(String(entrada.modelo))) {
    modelo = modelos.find((m) => m.id === Number(entrada.modelo));
  } else {
    const r = detectarModelo(String(entrada.modelo), modelos);
    if (r.tipo === 'ambiguo') {
      return { ...base, resultados: [], fuera_de_rango: [], estado: 'modelo_ambiguo', modelo: null, categoria: null, candidatos_modelo: r.candidatos.map(({ id, nombre }) => ({ id, nombre })) };
    }
    if (r.tipo === 'encontrado') modelo = r.modelo;
  }
  if (!modelo) return { ...base, resultados: [], fuera_de_rango: [], estado: 'modelo_no_encontrado', modelo: null, categoria: null };
  const modeloInfo = { id: modelo.id, nombre: modelo.nombre };

  // 2. Resolver categoría
  const cat = detectarCategoria(entrada.repuesto);
  if (cat.tipo === 'ambigua') {
    return { ...base, resultados: [], fuera_de_rango: [], estado: 'repuesto_ambiguo', modelo: modeloInfo, categoria: null, opciones_categoria: cat.opciones };
  }
  if (cat.tipo === 'ninguna') {
    return { ...base, resultados: [], fuera_de_rango: [], estado: 'repuesto_no_reconocido', modelo: modeloInfo, categoria: null };
  }
  const requierePos = categoriaPorClave(cat.clave)?.requierePosicion;

  // 3. Consulta parametrizada (nunca concatenamos texto del cliente en SQL)
  const { rows } = await pool.query(
    `${SELECT_PRODUCTO}
     WHERE p.activo AND c.modelo_id = $1 AND p.categoria = $2
       AND ($3::text IS NULL OR p.posicion = $3)
       AND ($4::text IS NULL OR p.tipo = $4)
     ORDER BY (p.tipo = 'original') DESC, p.precio NULLS LAST, p.id`,
    [modelo.id, cat.clave, requierePos ? entrada.posicion ?? null : null, entrada.tipo ?? null],
  );

  const resultados: ResultadoProducto[] = [];
  const fuera: ResultadoProducto[] = [];
  for (const f of rows) {
    const r = aResultado(f);
    if (entrada.anio >= f.anio_desde && entrada.anio <= f.anio_hasta) resultados.push(r);
    else fuera.push(r);
  }
  const estado: EstadoBusqueda = resultados.length ? 'ok' : fuera.length ? 'anio_no_compatible' : 'sin_resultados';
  return { estado, modelo: modeloInfo, anio: entrada.anio, categoria: cat.clave, resultados, fuera_de_rango: fuera };
}

/** Producto por id con su inventario (para carrito, cotización y pedido). */
export async function obtenerProductoVenta(productoId: number, db: Consultor = pool) {
  const { rows } = await db.query(
    `SELECT p.id, p.referencia, p.nombre, p.categoria, p.posicion, p.tipo, p.precio, p.activo, p.es_demo, ma.nombre AS marca,
            e.cantidad, e.estado, e.tiempo_abastecimiento_dias
     FROM productos p JOIN marcas ma ON ma.id = p.marca_id JOIN v_estado_inventario e ON e.producto_id = p.id
     WHERE p.id = $1`,
    [productoId],
  );
  return rows[0] ?? null;
}

export async function compatibilidadesPorReferencia(referencia: string) {
  const { rows } = await pool.query(
    `SELECT p.referencia, p.nombre, p.tipo, mo.nombre AS modelo, c.anio_desde, c.anio_hasta, c.verificada, c.fuente, c.notas
     FROM productos p JOIN compatibilidades c ON c.producto_id = p.id JOIN modelos_motocicleta mo ON mo.id = c.modelo_id
     WHERE upper(btrim(p.referencia)) = upper(btrim($1)) AND p.activo
     ORDER BY mo.nombre, c.anio_desde`,
    [referencia],
  );
  return rows;
}

export async function compatiblesConModelo(modeloId: number, anio: number) {
  const { rows } = await pool.query(
    `${SELECT_PRODUCTO} WHERE p.activo AND c.modelo_id = $1 AND $2 BETWEEN c.anio_desde AND c.anio_hasta ORDER BY p.categoria, p.tipo`,
    [modeloId, anio],
  );
  return rows.map(aResultado);
}

export async function disponibilidadPorReferencia(referencia: string) {
  const { rows } = await pool.query(
    `SELECT p.referencia, p.nombre, p.tipo, p.precio, p.es_demo, e.cantidad, e.estado, e.tiempo_abastecimiento_dias
     FROM productos p JOIN v_estado_inventario e ON e.producto_id = p.id
     WHERE upper(btrim(p.referencia)) = upper(btrim($1)) AND p.activo`,
    [referencia],
  );
  if (!rows[0]) throw new AppError(404, 'PRODUCTO_NO_ENCONTRADO', 'No existe un producto activo con esa referencia');
  const r = rows[0];
  return { ...r, precio_confirmado: r.precio !== null };
}
