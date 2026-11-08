import express, { Request, Router } from 'express';
import { z } from 'zod';
import { pool } from '../../db';
import { AppError } from '../../errores';
import { h, ok, paginacion } from '../../utils/http';
import { Permiso, requerirPermiso, tienePermiso } from '../../middleware/auth';
import { registrarEvento } from '../../modulos/eventos/servicio';
import { escribirCsv, escribirXlsx, Formato, MAX_BYTES } from '../../modulos/datos/archivos';
import {
  aplicarImportacion,
  crearImportacion,
  descartarImportacion,
  erroresImportacion,
  obtenerImportacion,
  plantilla,
  TipoImportacion,
} from '../../modulos/datos/importacion';
import { exportarInventario } from '../../modulos/datos/exportacion';

/**
 * Importación y exportación de CSV/Excel.
 * El archivo se envía como cuerpo crudo (no multipart):
 *   POST /admin/importaciones?tipo=productos&archivo=inventario.xlsx
 *   Content-Type: application/octet-stream   (o el tipo del archivo)
 */
export const r = Router();
const importar = requerirPermiso('importaciones.aplicar');
const tipoImp = z.enum(['productos', 'precios', 'stock', 'compatibilidades']);
const formato = z.enum(['csv', 'xlsx']);

/** Además de importar, cada tipo exige el permiso de lo que cambia. */
const PERMISOS_TIPO: Record<TipoImportacion, Permiso[]> = {
  productos: ['productos.editar', 'precios.editar'],
  precios: ['precios.editar'],
  stock: ['inventario.mover'],
  compatibilidades: ['compatibilidades.editar'],
};
function exigirPermisosTipo(req: Request, tipo: TipoImportacion) {
  const faltan = PERMISOS_TIPO[tipo].filter((p) => !tienePermiso(req, p));
  if (faltan.length) throw new AppError(403, 'SIN_PERMISOS', `Para importar ${tipo} necesitas: ${faltan.join(', ')}`);
}

function enviarArchivo(res: express.Response, nombre: string, f: Formato, cuerpo: Buffer) {
  res.setHeader('Content-Type', f === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
  res.setHeader('Content-Disposition', `attachment; filename="${nombre}.${f}"`);
  res.setHeader('Cache-Control', 'no-store');
  res.send(cuerpo);
}

r.post(
  '/importaciones',
  importar,
  express.raw({ type: () => true, limit: MAX_BYTES }),
  h(async (req, res) => {
    const q = z.object({ tipo: tipoImp, archivo: z.string().trim().min(5).max(200) }).parse(req.query);
    exigirPermisosTipo(req, q.tipo);
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw new AppError(400, 'ARCHIVO_VACIO', 'Envía el archivo en el cuerpo de la solicitud');
    const id = await crearImportacion(q.tipo, q.archivo, req.body, req.usuario!.id);
    ok(res, await obtenerImportacion(id), 201);
  }),
);

r.get(
  '/importaciones',
  importar,
  h(async (req, res) => {
    const { pagina, tamano, offset } = paginacion(req.query);
    const { rows } = await pool.query(
      `SELECT i.id, i.tipo, i.archivo_nombre, i.formato, i.estado, i.modo, i.filas_total, i.filas_validas, i.filas_error, i.resumen, i.created_at, i.aplicada_at, a.nombre AS asesor
       FROM importaciones i LEFT JOIN asesores a ON a.id = i.asesor_id ORDER BY i.id DESC LIMIT $1 OFFSET $2`,
      [tamano, offset],
    );
    ok(res, { items: rows, pagina, tamano });
  }),
);

r.get('/importaciones/plantillas/:tipo', requerirPermiso('catalogo.ver'), h(async (req, res) => {
  const tipo = tipoImp.parse(req.params.tipo);
  const f = formato.default('xlsx').parse(req.query.formato || undefined);
  const p = plantilla(tipo);
  enviarArchivo(res, `plantilla-${tipo}`, f, f === 'csv' ? escribirCsv(p.encabezados, [p.ejemplo]) : await escribirXlsx(tipo, p.encabezados, [p.ejemplo]));
}));

r.get('/importaciones/:id', importar, h(async (req, res) => ok(res, await obtenerImportacion(z.coerce.number().int().parse(req.params.id)))));

r.get(
  '/importaciones/:id/errores.csv',
  importar,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    await obtenerImportacion(id);
    const filas = await erroresImportacion(id);
    enviarArchivo(res, `errores-importacion-${id}`, 'csv', escribirCsv(['fila', 'columna', 'valor', 'mensaje'], filas.map((f) => [f.fila, f.columna, f.valor, f.mensaje])));
  }),
);

r.post(
  '/importaciones/:id/aplicar',
  importar,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const { modo } = z.object({ modo: z.enum(['solo_validas', 'todo_o_nada']) }).parse(req.body);
    const imp = await obtenerImportacion(id);
    exigirPermisosTipo(req, imp.tipo);
    const r2 = await aplicarImportacion(id, modo, req.usuario!.id);
    void registrarEvento('info', 'importacion_aplicada', `Importación #${id} (${r2.tipo}) aplicada: ${r2.aplicadas} filas`, { importacion_id: id, asesor_id: req.usuario!.id });
    ok(res, { ...(await obtenerImportacion(id)), aplicadas: r2.aplicadas });
  }),
);

r.post(
  '/importaciones/:id/descartar',
  importar,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    await descartarImportacion(id, req.usuario!.id);
    ok(res, await obtenerImportacion(id));
  }),
);

r.get(
  '/exportaciones/inventario',
  requerirPermiso('exportaciones.descargar'),
  h(async (req, res) => {
    const q = z
      .object({ formato: formato.default('xlsx'), activo: z.enum(['true', 'false']).optional(), categoria: z.string().max(40).optional() })
      .parse(req.query);
    const archivo = await exportarInventario(q.formato, { activo: q.activo === undefined ? undefined : q.activo === 'true', categoria: q.categoria });
    void registrarEvento('info', 'inventario_exportado', `Inventario exportado (${q.formato})`, { asesor_id: req.usuario!.id });
    enviarArchivo(res, `inventario-${new Date().toISOString().slice(0, 10)}`, q.formato, archivo);
  }),
);
