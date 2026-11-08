import express, { Router } from 'express';
import { AppError } from '../errores';
import { h } from '../utils/http';
import { almacenamientoLocal, CLAVE_VALIDA, MAX_BYTES_IMAGEN } from '../modulos/imagenes/almacenamiento';

/**
 * Solo con ALMACENAMIENTO=local (desarrollo y pruebas): recibe la subida con un
 * token firmado de un solo uso y sirve los archivos. En producción se usa Supabase.
 */
export const rutasAlmacenLocal = Router();

rutasAlmacenLocal.put(
  '/subidas/:token',
  express.raw({ type: () => true, limit: MAX_BYTES_IMAGEN }),
  h(async (req, res) => {
    const local = almacenamientoLocal();
    if (!local) throw new AppError(404, 'RUTA_NO_ENCONTRADA', 'Ruta no encontrada');
    await local.guardar(req.params.token, req.headers['content-type'], Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0));
    res.status(200).json({ ok: true, data: { subida: true } });
  }),
);

rutasAlmacenLocal.get('/archivos/*', (req, res, next) => {
  const local = almacenamientoLocal();
  const clave = (req.params as Record<string, string>)[0];
  if (!local || !CLAVE_VALIDA.test(clave)) return next();
  // Las imágenes se muestran desde otro dominio (el frontend): se permite su uso cruzado
  res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
  res.sendFile(local.ruta(clave), { headers: { 'Cache-Control': 'public, max-age=86400' } }, (e) => e && next());
});
