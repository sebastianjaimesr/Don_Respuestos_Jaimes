import { enTransaccion, moverStock, pool } from '../../db';
import { AppError } from '../../errores';
import { Celda, FilaArchivo, leerArchivo } from './archivos';

/**
 * Importación en dos pasos (docs/ARQUITECTURA.md § 9):
 * 1. VALIDAR (en seco): se lee todo el archivo, se valida fila por fila y se guarda
 *    el reporte. No cambia el catálogo.
 * 2. APLICAR: se vuelve a validar contra la base ACTUAL (pudo cambiar desde el paso 1)
 *    y se aplica en UNA transacción: solo las filas válidas, o todo o nada.
 */
export type TipoImportacion = 'productos' | 'precios' | 'stock' | 'compatibilidades';
type Consultor = { query: typeof pool.query };

/** Columnas de cada tipo. La exportación del inventario usa las mismas de "productos". */
export const COLUMNAS: Record<TipoImportacion, { obligatorias: string[]; opcionales: string[] }> = {
  productos: {
    obligatorias: ['sku', 'nombre', 'categoria', 'marca'],
    opcionales: ['tipo', 'precio', 'precio_compra', 'stock_minimo', 'referencia', 'codigo_barras', 'descripcion', 'posicion', 'ubicacion', 'activo'],
  },
  precios: { obligatorias: ['sku'], opcionales: ['precio', 'precio_compra'] },
  stock: { obligatorias: ['sku', 'motivo'], opcionales: ['cantidad', 'diferencia'] },
  compatibilidades: { obligatorias: ['sku', 'fabricante', 'modelo', 'anio_desde', 'anio_hasta'], opcionales: ['version', 'verificada', 'fuente', 'notas'] },
};

/** Sinónimos de encabezados que la gente suele escribir. */
const ALIAS: Record<string, string> = {
  referencia_interna: 'sku',
  codigo: 'sku',
  producto: 'nombre',
  precio_venta: 'precio',
  costo: 'precio_compra',
  precio_costo: 'precio_compra',
  existencias: 'cantidad',
  stock: 'cantidad',
  ano_desde: 'anio_desde',
  ano_hasta: 'anio_hasta',
  desde: 'anio_desde',
  hasta: 'anio_hasta',
  referencia_fabricante: 'referencia',
  codigo_de_barras: 'codigo_barras',
};

export interface ErrorFila {
  fila: number;
  columna: string | null;
  valor: string | null;
  mensaje: string;
}

// ---------------- Lectura de valores ----------------

class ErrorValor extends Error {
  constructor(public columna: string, mensaje: string) {
    super(mensaje);
  }
}

const textoDe = (v: Celda) => (v === null ? null : String(v).trim() || null);

function texto(d: FilaArchivo, col: string, max: number, obligatorio = false): string | null {
  const t = textoDe(d[col] ?? null);
  if (t === null) {
    if (obligatorio) throw new ErrorValor(col, 'Es obligatorio');
    return null;
  }
  if (t.length > max) throw new ErrorValor(col, `Máximo ${max} caracteres`);
  return t;
}

/**
 * Dinero en COP. Acepta números de Excel, "15000", "15000.50", "15.000", "$ 15.000" y
 * "1.234.567,50". Un texto con punto y exactamente tres decimales ("15.000") es
 * separador de miles, como se escribe en Colombia.
 */
export function leerDinero(v: Celda, col: string): number | null {
  if (v === null) return null;
  let n: number;
  if (typeof v === 'number') n = v;
  else {
    const t = String(v).replace(/[$\s]/g, '').replace(/COP$/i, '');
    if (/^\d{1,3}(\.\d{3})+(,\d{1,2})?$/.test(t)) n = Number(t.replace(/\./g, '').replace(',', '.'));
    else if (/^\d{1,3}(,\d{3})+(\.\d{1,2})?$/.test(t)) n = Number(t.replace(/,/g, ''));
    else if (/^\d+([.,]\d{1,2})?$/.test(t)) n = Number(t.replace(',', '.'));
    else throw new ErrorValor(col, 'No es un valor válido (ej. 15000 o 15.000)');
  }
  if (!Number.isFinite(n) || n < 0) throw new ErrorValor(col, 'Debe ser mayor o igual a 0');
  if (n > 99_999_999) throw new ErrorValor(col, 'Valor demasiado alto');
  if (Math.abs(Math.round(n * 100) - n * 100) > 1e-6) throw new ErrorValor(col, 'Máximo dos decimales');
  return Math.round(n * 100) / 100;
}

function entero(v: Celda, col: string, min: number, max: number): number | null {
  if (v === null) return null;
  const t = typeof v === 'number' ? v : /^-?\d{1,3}(\.\d{3})+$/.test(String(v).trim()) ? Number(String(v).replace(/\./g, '')) : Number(String(v).trim());
  if (!Number.isInteger(t)) throw new ErrorValor(col, 'Debe ser un número entero');
  if (t < min || t > max) throw new ErrorValor(col, `Debe estar entre ${min} y ${max}`);
  return t;
}

function booleano(v: Celda, col: string): boolean | null {
  if (v === null) return null;
  if (typeof v === 'boolean') return v;
  const t = String(v).trim().toLowerCase();
  if (['si', 'sí', 'true', 'verdadero', '1', 'x', 's'].includes(t)) return true;
  if (['no', 'false', 'falso', '0', 'n'].includes(t)) return false;
  throw new ErrorValor(col, 'Usa "sí" o "no"');
}

const aSku = (t: string) => t.trim().toUpperCase().replace(/\s+/g, '-');
const clave = (t: string) =>
  t
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

// ---------------- Datos de referencia ----------------

interface Referencias {
  categorias: Map<string, { id: number; hoja: boolean; requierePosicion: boolean }>;
  marcas: Map<string, { id: number; original: boolean }>;
  productos: Map<string, { id: number; precio: string | null; precio_compra: string | null; stock: number | null }>;
  modelos: Map<string, number>; // "fabricante|modelo" → id
  versiones: Map<string, number>; // "modeloId|version" → id
}

async function cargarReferencias(db: Consultor, tipo: TipoImportacion): Promise<Referencias> {
  const [cat, mar, pro] = await Promise.all([
    db.query('SELECT c.id, c.slug, c.nombre, c.requiere_posicion, NOT EXISTS (SELECT 1 FROM categorias h WHERE h.padre_id = c.id) AS hoja FROM categorias c WHERE c.activo'),
    db.query('SELECT id, nombre, fabricante_moto_id IS NOT NULL AS original FROM marcas_repuesto'),
    db.query('SELECT p.id, p.sku, p.precio, p.precio_compra, i.cantidad AS stock FROM productos p LEFT JOIN inventario i ON i.producto_id = p.id'),
  ]);
  const categorias = new Map<string, { id: number; hoja: boolean; requierePosicion: boolean }>();
  for (const c of cat.rows) {
    const v = { id: c.id, hoja: c.hoja, requierePosicion: c.requiere_posicion };
    categorias.set(clave(c.slug), v);
    categorias.set(clave(c.nombre), v);
  }
  const ref: Referencias = {
    categorias,
    marcas: new Map(mar.rows.map((m) => [clave(m.nombre), { id: m.id, original: m.original }])),
    productos: new Map(pro.rows.map((p) => [p.sku, { id: p.id, precio: p.precio, precio_compra: p.precio_compra, stock: p.stock }])),
    modelos: new Map(),
    versiones: new Map(),
  };
  if (tipo === 'compatibilidades') {
    const mo = await db.query(
      'SELECT mo.id, mo.nombre, mo.alias, f.nombre AS fabricante, f.slug FROM modelos_motocicleta mo JOIN fabricantes_moto f ON f.id = mo.fabricante_id',
    );
    for (const m of mo.rows) {
      for (const fab of [m.fabricante, m.slug]) for (const n of [m.nombre, ...(m.alias ?? [])]) ref.modelos.set(`${clave(fab)}|${clave(n)}`, m.id);
    }
    const ve = await db.query('SELECT id, modelo_id, nombre FROM versiones_moto');
    for (const v of ve.rows) ref.versiones.set(`${v.modelo_id}|${clave(v.nombre)}`, v.id);
  }
  return ref;
}

// ---------------- Validación por tipo ----------------

type Accion = { tipo: TipoImportacion; [k: string]: unknown };

function validarFila(tipo: TipoImportacion, d: FilaArchivo, ref: Referencias): Accion {
  const sku = aSku(texto(d, 'sku', 60, true)!);
  if (!/^[A-Z0-9][A-Z0-9._-]*$/.test(sku)) throw new ErrorValor('sku', 'Solo letras, números, punto y guion');
  const existente = ref.productos.get(sku);

  if (tipo === 'productos') {
    const nombre = texto(d, 'nombre', 160, true)!;
    const catTxt = texto(d, 'categoria', 80, true)!;
    const cat = ref.categorias.get(clave(catTxt));
    if (!cat) throw new ErrorValor('categoria', 'Esa categoría no existe');
    if (!cat.hoja) throw new ErrorValor('categoria', 'Es un grupo: usa una categoría concreta (ej. "pastillas_freno" en vez de "frenos")');
    const marcaTxt = texto(d, 'marca', 120, true)!;
    const marca = ref.marcas.get(clave(marcaTxt));
    if (!marca) throw new ErrorValor('marca', 'Esa marca no existe: créala primero en el panel');
    const tipoTxt = texto(d, 'tipo', 20);
    const tipoProd = tipoTxt ? clave(tipoTxt).replace(/ /g, '') : null;
    if (tipoProd && !['original', 'generico', 'alternativo'].includes(tipoProd)) throw new ErrorValor('tipo', 'Usa original, genérico o alternativo');
    if (marca.original && tipoProd && tipoProd !== 'original') throw new ErrorValor('tipo', `${marcaTxt} es la marca del fabricante: el producto es original`);
    if (!marca.original && tipoProd === 'original') throw new ErrorValor('tipo', 'Solo es "original" un repuesto de la marca del fabricante de la moto');
    const posTxt = texto(d, 'posicion', 20);
    const posicion = posTxt ? clave(posTxt) : null;
    if (posicion && !['delantero', 'trasero'].includes(posicion)) throw new ErrorValor('posicion', 'Usa delantero o trasero');
    const codigo = texto(d, 'codigo_barras', 40);
    if (codigo && !/^[0-9A-Za-z-]{4,40}$/.test(codigo)) throw new ErrorValor('codigo_barras', 'Código de barras inválido');
    const precio = leerDinero(d.precio ?? null, 'precio');
    if (precio === 0) throw new ErrorValor('precio', 'El precio debe ser mayor que 0 (déjalo vacío si no está confirmado)');
    return {
      tipo,
      accion: existente ? 'actualizar' : 'crear',
      producto_id: existente?.id ?? null,
      sku,
      nombre,
      categoria_id: cat.id,
      marca_id: marca.id,
      tipo_producto: marca.original ? 'original' : (tipoProd ?? 'generico'),
      precio,
      precio_compra: leerDinero(d.precio_compra ?? null, 'precio_compra'),
      stock_minimo: entero(d.stock_minimo ?? null, 'stock_minimo', 0, 100000),
      referencia: texto(d, 'referencia', 60),
      codigo_barras: codigo,
      descripcion: texto(d, 'descripcion', 2000),
      posicion,
      ubicacion: texto(d, 'ubicacion', 60),
      activo: booleano(d.activo ?? null, 'activo'),
      // Columnas que vienen en el archivo: lo que no viene, no se toca al actualizar
      presentes: Object.keys(d),
    };
  }

  if (!existente) throw new ErrorValor('sku', 'No existe un producto con ese SKU');

  if (tipo === 'precios') {
    const precio = leerDinero(d.precio ?? null, 'precio');
    const compra = leerDinero(d.precio_compra ?? null, 'precio_compra');
    if (precio === null && compra === null) throw new ErrorValor('precio', 'Indica el precio, el precio de compra o ambos');
    if (precio === 0) throw new ErrorValor('precio', 'El precio debe ser mayor que 0');
    return { tipo, producto_id: existente.id, sku, precio, precio_compra: compra };
  }

  if (tipo === 'stock') {
    const cantidad = entero(d.cantidad ?? null, 'cantidad', 0, 1_000_000);
    const diferencia = entero(d.diferencia ?? null, 'diferencia', -1_000_000, 1_000_000);
    if ((cantidad === null) === (diferencia === null)) throw new ErrorValor('cantidad', 'Indica la cantidad contada O la diferencia, no ambas');
    if (diferencia === 0) throw new ErrorValor('diferencia', 'Una diferencia de 0 no cambia nada');
    const motivo = texto(d, 'motivo', 200, true)!;
    if (motivo.length < 3) throw new ErrorValor('motivo', 'Escribe un motivo de al menos 3 letras');
    return { tipo, producto_id: existente.id, sku, cantidad, diferencia, motivo };
  }

  // compatibilidades
  const fab = texto(d, 'fabricante', 80, true)!;
  const mod = texto(d, 'modelo', 120, true)!;
  const modeloId = ref.modelos.get(`${clave(fab)}|${clave(mod)}`);
  if (!modeloId) throw new ErrorValor('modelo', `No existe el modelo "${mod}" de ${fab}: créalo primero en el panel`);
  const verTxt = texto(d, 'version', 120);
  const versionId = verTxt ? ref.versiones.get(`${modeloId}|${clave(verTxt)}`) : null;
  if (verTxt && !versionId) throw new ErrorValor('version', 'Esa versión no existe para el modelo');
  const desde = entero(d.anio_desde ?? null, 'anio_desde', 1950, 2100)!;
  const hasta = entero(d.anio_hasta ?? null, 'anio_hasta', 1950, 2100)!;
  if (desde === null) throw new ErrorValor('anio_desde', 'Es obligatorio');
  if (hasta === null) throw new ErrorValor('anio_hasta', 'Es obligatorio');
  if (desde > hasta) throw new ErrorValor('anio_hasta', 'El año final no puede ser menor que el inicial');
  const verificada = booleano(d.verificada ?? null, 'verificada') ?? false;
  const fuente = texto(d, 'fuente', 200);
  if (verificada && (!fuente || fuente.length < 3)) throw new ErrorValor('fuente', 'Una compatibilidad verificada debe indicar la fuente (catálogo, proveedor…)');
  return { tipo, producto_id: existente.id, sku, modelo_id: modeloId, version_id: versionId ?? null, anio_desde: desde, anio_hasta: hasta, verificada, fuente, notas: texto(d, 'notas', 1000) };
}

/** Clave que no puede repetirse dentro del mismo archivo. */
function claveUnica(a: Accion): string {
  if (a.tipo === 'compatibilidades') return `${a.sku}|${a.modelo_id}|${a.version_id ?? 0}|${a.anio_desde}|${a.anio_hasta}`;
  return String(a.sku);
}

export function normalizarFila(d: FilaArchivo): FilaArchivo {
  const r: FilaArchivo = {};
  for (const [k, v] of Object.entries(d)) r[ALIAS[k] ?? k] = v;
  return r;
}

export async function validarFilas(db: Consultor, tipo: TipoImportacion, filas: { fila: number; datos: FilaArchivo }[]) {
  const ref = await cargarReferencias(db, tipo);
  const vistos = new Map<string, number>();
  const errores: ErrorFila[] = [];
  const validas: { fila: number; accion: Accion }[] = [];
  for (const f of filas) {
    try {
      const a = validarFila(tipo, f.datos, ref);
      const k = claveUnica(a);
      if (vistos.has(k)) throw new ErrorValor('sku', `Repetido: ya aparece en la fila ${vistos.get(k)}`);
      vistos.set(k, f.fila);
      validas.push({ fila: f.fila, accion: a });
    } catch (e) {
      if (!(e instanceof ErrorValor)) throw e;
      const v = f.datos[e.columna];
      errores.push({ fila: f.fila, columna: e.columna, valor: v === null || v === undefined ? null : String(v).slice(0, 200), mensaje: e.message });
    }
  }
  return { validas, errores };
}

function resumir(tipo: TipoImportacion, validas: { accion: Accion }[]) {
  if (tipo === 'productos') {
    const crear = validas.filter((v) => v.accion.accion === 'crear').length;
    return { crear, actualizar: validas.length - crear };
  }
  return { filas_a_aplicar: validas.length };
}

// ---------------- Paso 1: validar ----------------

export async function crearImportacion(tipo: TipoImportacion, nombre: string, cuerpo: Buffer, asesorId: number) {
  const archivo = await leerArchivo(nombre, cuerpo);
  const encabezados = archivo.encabezados.map((e) => ALIAS[e] ?? e);
  const faltan = COLUMNAS[tipo].obligatorias.filter((c) => !encabezados.includes(c));
  if (tipo === 'stock' && !encabezados.includes('cantidad') && !encabezados.includes('diferencia')) faltan.push('cantidad o diferencia');
  if (faltan.length) throw new AppError(400, 'COLUMNAS_FALTANTES', `Faltan columnas: ${faltan.join(', ')}. Descarga la plantilla para ver el formato.`, { faltan });
  const conocidas = new Set([...COLUMNAS[tipo].obligatorias, ...COLUMNAS[tipo].opcionales]);
  const ignoradas = encabezados.filter((e) => !conocidas.has(e));
  const filas = archivo.filas.map((f) => ({ fila: f.fila, datos: normalizarFila(f.datos) }));
  const { validas, errores } = await validarFilas(pool, tipo, filas);
  const conError = new Set(errores.map((e) => e.fila));

  return enTransaccion(async (db) => {
    const imp = (
      await db.query(
        `INSERT INTO importaciones (tipo, archivo_nombre, formato, estado, filas_total, filas_validas, filas_error, resumen, asesor_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
        [
          tipo,
          nombre.slice(0, 200),
          archivo.formato,
          errores.length ? 'con_errores' : 'validada',
          filas.length,
          validas.length,
          conError.size,
          JSON.stringify({ ...resumir(tipo, validas), columnas_ignoradas: ignoradas }),
          asesorId,
        ],
      )
    ).rows[0].id as number;
    // Se guardan las filas tal como venían: al aplicar se validan otra vez contra la base actual
    for (let i = 0; i < filas.length; i += 500) {
      const lote = filas.slice(i, i + 500);
      await db.query(
        `INSERT INTO importacion_filas (importacion_id, fila, datos, valida)
         SELECT $1, x.fila, x.datos, x.valida FROM jsonb_to_recordset($2::jsonb) AS x(fila int, datos jsonb, valida boolean)`,
        [imp, JSON.stringify(lote.map((f) => ({ fila: f.fila, datos: f.datos, valida: !conError.has(f.fila) })))],
      );
    }
    for (let i = 0; i < errores.length; i += 500) {
      await db.query(
        `INSERT INTO importacion_errores (importacion_id, fila, columna, valor, mensaje)
         SELECT $1, x.fila, x.columna, x.valor, x.mensaje FROM jsonb_to_recordset($2::jsonb) AS x(fila int, columna text, valor text, mensaje text)`,
        [imp, JSON.stringify(errores.slice(i, i + 500))],
      );
    }
    return imp;
  }, { usuarioId: asesorId });
}

export async function obtenerImportacion(id: number) {
  const { rows } = await pool.query(
    `SELECT i.*, a.nombre AS asesor FROM importaciones i LEFT JOIN asesores a ON a.id = i.asesor_id WHERE i.id = $1`,
    [id],
  );
  if (!rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Importación no encontrada');
  const err = await pool.query('SELECT fila, columna, valor, mensaje FROM importacion_errores WHERE importacion_id = $1 ORDER BY fila, id LIMIT 200', [id]);
  return { ...rows[0], errores: err.rows, errores_mostrados: err.rows.length };
}

export async function erroresImportacion(id: number) {
  return (await pool.query('SELECT fila, columna, valor, mensaje FROM importacion_errores WHERE importacion_id = $1 ORDER BY fila, id', [id])).rows;
}

// ---------------- Paso 2: aplicar ----------------

async function aplicarAccion(db: Consultor, a: Accion, importacionId: number, asesorId: number) {
  if (a.tipo === 'productos') {
    const presentes = new Set(a.presentes as string[]);
    // Al actualizar, solo se cambian las columnas que vienen en el archivo
    const campos: [string, unknown][] = [
      ['nombre', a.nombre],
      ['categoria_id', a.categoria_id],
      ['marca_id', a.marca_id],
      ['tipo', a.tipo_producto],
    ];
    const opcional = (col: string, valor: unknown, columnaArchivo = col) => {
      if (a.accion === 'crear' || presentes.has(columnaArchivo)) campos.push([col, valor]);
    };
    opcional('precio', a.precio);
    opcional('precio_compra', a.precio_compra);
    opcional('referencia', a.referencia ?? a.sku);
    opcional('codigo_barras', a.codigo_barras);
    opcional('descripcion', a.descripcion);
    opcional('posicion', a.posicion);
    if (a.activo !== null) campos.push(['activo', a.activo]);
    let id = a.producto_id as number | null;
    if (a.accion === 'crear') {
      campos.push(['sku', a.sku]);
      const r = await db.query(
        `INSERT INTO productos (${campos.map((c) => c[0]).join(', ')}) VALUES (${campos.map((_, i) => `$${i + 1}`).join(', ')}) RETURNING id`,
        campos.map((c) => c[1]),
      );
      id = r.rows[0].id;
      await db.query('INSERT INTO inventario (producto_id, cantidad, stock_minimo, ubicacion) VALUES ($1, 0, COALESCE($2, 2), $3)', [id, a.stock_minimo, a.ubicacion]);
    } else {
      await db.query(`UPDATE productos SET ${campos.map((c, i) => `${c[0]} = $${i + 2}`).join(', ')} WHERE id = $1`, [id, ...campos.map((c) => c[1])]);
      if (presentes.has('stock_minimo') && a.stock_minimo !== null) await db.query('UPDATE inventario SET stock_minimo = $2 WHERE producto_id = $1', [id, a.stock_minimo]);
      if (presentes.has('ubicacion')) await db.query('UPDATE inventario SET ubicacion = $2 WHERE producto_id = $1', [id, a.ubicacion]);
    }
    return;
  }
  if (a.tipo === 'precios') {
    await db.query('UPDATE productos SET precio = COALESCE($2, precio), precio_compra = COALESCE($3, precio_compra) WHERE id = $1', [a.producto_id, a.precio, a.precio_compra]);
    return;
  }
  if (a.tipo === 'stock') {
    await db.query('INSERT INTO inventario (producto_id, cantidad) VALUES ($1, 0) ON CONFLICT (producto_id) DO NOTHING', [a.producto_id]);
    const actual = (await db.query('SELECT cantidad FROM inventario WHERE producto_id = $1 FOR UPDATE', [a.producto_id])).rows[0].cantidad as number;
    const delta = a.cantidad !== null ? (a.cantidad as number) - actual : (a.diferencia as number);
    if (delta === 0) return; // el conteo coincide con el sistema
    if (actual + delta < 0) throw new ErrorValor('diferencia', `Dejaría el inventario en negativo (hay ${actual})`);
    await moverStock(db, { productoId: a.producto_id as number, tipo: 'ajuste', delta, motivo: `Importación #${importacionId}: ${a.motivo}`, asesorId });
    return;
  }
  await db.query(
    `INSERT INTO compatibilidades (producto_id, modelo_id, version_id, anio_desde, anio_hasta, verificada, fuente, notas)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
     ON CONFLICT (producto_id, modelo_id, COALESCE(version_id, 0), anio_desde, anio_hasta)
     DO UPDATE SET verificada = EXCLUDED.verificada, fuente = EXCLUDED.fuente, notas = COALESCE(EXCLUDED.notas, compatibilidades.notas)`,
    [a.producto_id, a.modelo_id, a.version_id, a.anio_desde, a.anio_hasta, a.verificada, a.fuente, a.notas],
  );
}

export async function aplicarImportacion(id: number, modo: 'solo_validas' | 'todo_o_nada', asesorId: number) {
  const resultado = await enTransaccion(async (db) => {
    const imp = (await db.query('SELECT id, tipo, estado FROM importaciones WHERE id = $1 FOR UPDATE', [id])).rows[0];
    if (!imp) throw new AppError(404, 'NO_ENCONTRADO', 'Importación no encontrada');
    if (!['validada', 'con_errores'].includes(imp.estado)) throw new AppError(409, 'IMPORTACION_CERRADA', `La importación ya está ${imp.estado}`);
    const tipo = imp.tipo as TipoImportacion;
    const filas = (await db.query('SELECT fila, datos FROM importacion_filas WHERE importacion_id = $1 ORDER BY fila', [id])).rows as { fila: number; datos: FilaArchivo }[];
    // Se valida otra vez: el catálogo pudo cambiar desde la validación
    const { validas, errores } = await validarFilas(db, tipo, filas);
    if (modo === 'todo_o_nada' && errores.length) {
      throw new AppError(409, 'IMPORTACION_CON_ERRORES', `Hay ${new Set(errores.map((e) => e.fila)).size} filas con errores: corrige el archivo o aplica solo las válidas`, {
        errores: errores.slice(0, 50),
      });
    }
    const fallidas: ErrorFila[] = [...errores];
    let aplicadas = 0;
    for (const v of validas) {
      // Cada fila en su propio SAVEPOINT: si una falla, las demás siguen (o se aborta todo)
      await db.query('SAVEPOINT fila');
      try {
        await aplicarAccion(db, v.accion, id, asesorId);
        await db.query('RELEASE SAVEPOINT fila');
        aplicadas++;
      } catch (e) {
        await db.query('ROLLBACK TO SAVEPOINT fila');
        const err = e as { code?: string; message?: string; columna?: string };
        const mensaje =
          e instanceof ErrorValor
            ? e.message
            : err.code === '23505'
              ? 'Valor duplicado (SKU o código de barras ya usado por otro producto)'
              : err.code === '23514' || err.code === 'P0001'
                ? (err.message ?? 'Dato rechazado por la base de datos')
                : null;
        if (mensaje === null) throw e;
        if (modo === 'todo_o_nada') throw new AppError(409, 'IMPORTACION_CON_ERRORES', `Fila ${v.fila}: ${mensaje}. No se aplicó nada.`);
        fallidas.push({ fila: v.fila, columna: e instanceof ErrorValor ? e.columna : null, valor: null, mensaje });
      }
    }
    await db.query('DELETE FROM importacion_errores WHERE importacion_id = $1', [id]);
    if (fallidas.length) {
      await db.query(
        `INSERT INTO importacion_errores (importacion_id, fila, columna, valor, mensaje)
         SELECT $1, x.fila, x.columna, x.valor, x.mensaje FROM jsonb_to_recordset($2::jsonb) AS x(fila int, columna text, valor text, mensaje text)`,
        [id, JSON.stringify(fallidas)],
      );
    }
    await db.query(
      `UPDATE importaciones SET estado = 'aplicada', modo = $2, aplicada_at = now(), filas_validas = $3, filas_error = $4,
              resumen = resumen || jsonb_build_object('aplicadas', $3::int) WHERE id = $1`,
      [id, modo, aplicadas, new Set(fallidas.map((f) => f.fila)).size],
    );
    return { tipo, aplicadas, con_error: new Set(fallidas.map((f) => f.fila)).size };
  }, { usuarioId: asesorId, origen: 'importacion' });
  return resultado;
}

export async function descartarImportacion(id: number, asesorId: number) {
  const { rowCount } = await enTransaccion(
    (db) => db.query(`UPDATE importaciones SET estado = 'descartada' WHERE id = $1 AND estado IN ('validada', 'con_errores')`, [id]),
    { usuarioId: asesorId },
  );
  if (!rowCount) throw new AppError(409, 'IMPORTACION_CERRADA', 'Solo se puede descartar una importación sin aplicar');
}

/** Encabezados y una fila de ejemplo (marcada como ejemplo) para cada plantilla. */
export function plantilla(tipo: TipoImportacion): { encabezados: string[]; ejemplo: Celda[] } {
  const ejemplos: Record<TipoImportacion, Record<string, Celda>> = {
    productos: {
      sku: 'EJEMPLO-001',
      nombre: 'Pastillas de freno delanteras (EJEMPLO, bórrame)',
      categoria: 'pastillas_freno',
      marca: 'Nombre exacto de la marca',
      tipo: 'generico',
      precio: 32000,
      precio_compra: 19000,
      stock_minimo: 2,
      referencia: 'Número de parte del fabricante',
      codigo_barras: null,
      descripcion: null,
      posicion: 'delantero',
      ubicacion: 'Estante A1',
      activo: 'sí',
    },
    precios: { sku: 'EJEMPLO-001', precio: 32000, precio_compra: 19000 },
    stock: { sku: 'EJEMPLO-001', cantidad: 10, diferencia: null, motivo: 'Conteo físico' },
    compatibilidades: {
      sku: 'EJEMPLO-001',
      fabricante: 'Yamaha',
      modelo: 'Nombre exacto del modelo',
      anio_desde: 2018,
      anio_hasta: 2023,
      version: null,
      verificada: 'no',
      fuente: 'Catálogo del fabricante (obligatorio si verificada = sí)',
      notas: null,
    },
  };
  const encabezados = [...COLUMNAS[tipo].obligatorias, ...COLUMNAS[tipo].opcionales];
  return { encabezados, ejemplo: encabezados.map((e) => ejemplos[tipo][e] ?? null) };
}
