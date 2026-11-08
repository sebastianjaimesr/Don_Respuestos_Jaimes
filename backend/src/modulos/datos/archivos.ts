import ExcelJS from 'exceljs';
import { AppError } from '../../errores';

/**
 * Lectura y escritura de hojas de cálculo (CSV y Excel).
 * - Los encabezados se normalizan: "Año desde" → "anio_desde", "Precio compra" → "precio_compra".
 * - Una celda numérica de Excel llega como número; el texto llega como texto
 *   (así "1.500" escrito a mano se lee como mil quinientos y no como 1,5).
 */
export type Celda = string | number | boolean | null;
export type FilaArchivo = Record<string, Celda>;
export type Formato = 'csv' | 'xlsx';

export const MAX_BYTES = 10 * 1024 * 1024;
export const MAX_FILAS = 20_000;

export function normalizarEncabezado(t: string): string {
  return t
    .replace(/^﻿/, '')
    .trim()
    .toLowerCase()
    .replace(/ñ/g, 'ni')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

export function formatoDeArchivo(nombre: string, cuerpo: Buffer): Formato {
  // XLSX es un ZIP: empieza por "PK\x03\x04"
  const esZip = cuerpo.length > 4 && cuerpo[0] === 0x50 && cuerpo[1] === 0x4b && cuerpo[2] === 0x03 && cuerpo[3] === 0x04;
  const ext = nombre.toLowerCase().split('.').pop();
  if (ext === 'xlsx') {
    if (!esZip) throw new AppError(400, 'ARCHIVO_INVALIDO', 'El archivo no es un Excel (.xlsx) válido');
    return 'xlsx';
  }
  if (ext === 'csv' || ext === 'txt') {
    if (esZip) throw new AppError(400, 'ARCHIVO_INVALIDO', 'El archivo parece un Excel: guárdalo con extensión .xlsx');
    return 'csv';
  }
  if (ext === 'xls') throw new AppError(400, 'FORMATO_NO_SOPORTADO', 'El formato .xls (Excel 97) no se admite: guarda el archivo como .xlsx o .csv');
  throw new AppError(400, 'FORMATO_NO_SOPORTADO', 'Sube un archivo .csv o .xlsx');
}

// ---------------- CSV ----------------

/** Detecta el separador: Excel en español guarda los CSV con ";". */
function separador(primera: string): string {
  const cuenta = (c: string) => primera.split(c).length - 1;
  return [';', ',', '\t'].sort((a, b) => cuenta(b) - cuenta(a))[0];
}

/** Parser CSV (RFC 4180): comillas, comillas dobladas y saltos de línea dentro de comillas. */
export function leerCsv(texto: string): string[][] {
  texto = texto.replace(/^﻿/, '');
  const fin = texto.search(/\r?\n/);
  const sep = separador(fin === -1 ? texto : texto.slice(0, fin));
  const filas: string[][] = [];
  let fila: string[] = [];
  let campo = '';
  let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') {
        campo += '"';
        i++;
      } else if (c === '"') comillas = false;
      else campo += c;
    } else if (c === '"' && campo === '') comillas = true;
    else if (c === sep) {
      fila.push(campo);
      campo = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && texto[i + 1] === '\n') i++;
      fila.push(campo);
      filas.push(fila);
      fila = [];
      campo = '';
    } else campo += c;
  }
  if (comillas) throw new AppError(400, 'ARCHIVO_INVALIDO', 'El CSV tiene comillas sin cerrar');
  if (campo !== '' || fila.length) {
    fila.push(campo);
    filas.push(fila);
  }
  return filas;
}

/**
 * Un texto que empieza por = + - @ se abre en Excel como FÓRMULA (inyección de
 * fórmulas). Se antepone un apóstrofo para que se muestre como texto.
 */
const seguroParaExcel = (v: string) => (/^[=+\-@\t\r]/.test(v) ? `'${v}` : v);

export function escribirCsv(encabezados: string[], filas: Celda[][]): Buffer {
  const celda = (v: Celda) => {
    if (v === null || v === undefined) return '';
    const t = typeof v === 'string' ? seguroParaExcel(v) : String(v);
    return /[;"\r\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t;
  };
  const lineas = [encabezados, ...filas].map((f) => f.map(celda).join(';'));
  // BOM para que Excel abra bien las tildes; ";" porque Excel en español lo espera
  return Buffer.from('﻿' + lineas.join('\r\n') + '\r\n', 'utf8');
}

// ---------------- XLSX ----------------

function valorExcel(v: ExcelJS.CellValue): Celda {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number' || typeof v === 'boolean' || typeof v === 'string') return v;
  if (v instanceof Date) return v.toISOString().slice(0, 10);
  if (typeof v === 'object') {
    if ('richText' in v) return v.richText.map((t) => t.text).join('');
    if ('result' in v) return valorExcel(v.result as ExcelJS.CellValue); // fórmula: se usa el resultado
    if ('text' in v) return String(v.text); // hipervínculo
    if ('error' in v) return null;
  }
  return String(v);
}

async function leerXlsx(cuerpo: Buffer): Promise<Celda[][]> {
  const libro = new ExcelJS.Workbook();
  try {
    await libro.xlsx.load(cuerpo as unknown as ArrayBuffer);
  } catch {
    throw new AppError(400, 'ARCHIVO_INVALIDO', 'No se pudo leer el Excel. Ábrelo y guárdalo de nuevo como .xlsx');
  }
  const hoja = libro.worksheets[0];
  if (!hoja) throw new AppError(400, 'ARCHIVO_VACIO', 'El Excel no tiene hojas');
  if (hoja.rowCount > MAX_FILAS + 1) throw new AppError(400, 'DEMASIADAS_FILAS', `Máximo ${MAX_FILAS} filas por archivo`);
  const filas: Celda[][] = [];
  hoja.eachRow({ includeEmpty: true }, (row, n) => {
    const valores: Celda[] = [];
    for (let c = 1; c <= hoja.columnCount; c++) valores.push(valorExcel(row.getCell(c).value));
    filas[n - 1] = valores;
  });
  return Array.from(filas, (f) => f ?? []);
}

export async function escribirXlsx(nombreHoja: string, encabezados: string[], filas: Celda[][]): Promise<Buffer> {
  const libro = new ExcelJS.Workbook();
  libro.creator = 'Don Repuestos Jaimes';
  const hoja = libro.addWorksheet(nombreHoja);
  hoja.addRow(encabezados).font = { bold: true };
  hoja.views = [{ state: 'frozen', ySplit: 1 }];
  // ExcelJS escribe los textos como texto (no como fórmula), así que no hay inyección
  for (const f of filas) hoja.addRow(f.map((v) => (v === null ? null : v)));
  hoja.columns.forEach((c, i) => (c.width = Math.min(40, Math.max(10, encabezados[i].length + 2))));
  return Buffer.from(await libro.xlsx.writeBuffer());
}

/**
 * Lee el archivo y devuelve filas con encabezados normalizados.
 * `fila` es el número de fila en el archivo (la 1 es el encabezado), para los mensajes de error.
 */
export async function leerArchivo(nombre: string, cuerpo: Buffer): Promise<{ formato: Formato; encabezados: string[]; filas: { fila: number; datos: FilaArchivo }[] }> {
  if (!cuerpo.length) throw new AppError(400, 'ARCHIVO_VACIO', 'El archivo está vacío');
  if (cuerpo.length > MAX_BYTES) throw new AppError(413, 'ARCHIVO_GRANDE', 'El archivo supera 10 MB');
  const formato = formatoDeArchivo(nombre, cuerpo);
  const crudas: Celda[][] = formato === 'csv' ? leerCsv(cuerpo.toString('utf8')) : await leerXlsx(cuerpo);
  const [cab, ...resto] = crudas;
  if (!cab || !cab.some((c) => c !== null && String(c).trim() !== '')) throw new AppError(400, 'ARCHIVO_VACIO', 'La primera fila debe tener los encabezados');
  const encabezados = cab.map((c) => normalizarEncabezado(String(c ?? '')));
  const repetidos = encabezados.filter((e, i) => e && encabezados.indexOf(e) !== i);
  if (repetidos.length) throw new AppError(400, 'ENCABEZADO_REPETIDO', `Columnas repetidas: ${[...new Set(repetidos)].join(', ')}`);
  const filas: { fila: number; datos: FilaArchivo }[] = [];
  resto.forEach((valores, i) => {
    const datos: FilaArchivo = {};
    let vacia = true;
    encabezados.forEach((e, j) => {
      if (!e) return;
      let v = valores[j] ?? null;
      if (typeof v === 'string') v = v.trim() === '' ? null : v.trim();
      if (v !== null) vacia = false;
      datos[e] = v;
    });
    if (!vacia) filas.push({ fila: i + 2, datos });
  });
  if (!filas.length) throw new AppError(400, 'ARCHIVO_VACIO', 'El archivo no tiene filas con datos');
  if (filas.length > MAX_FILAS) throw new AppError(400, 'DEMASIADAS_FILAS', `Máximo ${MAX_FILAS} filas por archivo`);
  return { formato, encabezados: encabezados.filter(Boolean), filas };
}
