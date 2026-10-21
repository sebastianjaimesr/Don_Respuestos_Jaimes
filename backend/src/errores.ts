import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { registrarEvento } from './modulos/eventos/servicio';

/** Error de negocio con un código estable que el frontend y n8n pueden interpretar. */
export class AppError extends Error {
  constructor(
    public readonly status: number,
    public readonly codigo: string,
    mensaje: string,
    public readonly detalles?: unknown,
  ) {
    super(mensaje);
  }
}

export const noEncontrado = (mensaje: string) => new AppError(404, 'NO_ENCONTRADO', mensaje);

export function manejadorErrores(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ ok: false, error: { codigo: err.codigo, mensaje: err.message, detalles: err.detalles } });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: {
        codigo: 'VALIDACION',
        mensaje: 'Datos inválidos',
        detalles: err.issues.map((i) => ({ campo: i.path.join('.'), mensaje: i.message })),
      },
    });
  }
  if (typeof err === 'object' && err && (err as { type?: string }).type === 'entity.parse.failed') {
    return res.status(400).json({ ok: false, error: { codigo: 'JSON_INVALIDO', mensaje: 'El cuerpo no es JSON válido' } });
  }
  // Error inesperado: se registra (sin datos sensibles) y se responde genérico.
  const e = err as { message?: string; code?: string };
  void registrarEvento('error', 'error_no_controlado', e?.message ?? 'Error desconocido', {
    ruta: `${req.method} ${req.path}`,
    codigo_pg: e?.code,
  });
  return res.status(500).json({ ok: false, error: { codigo: 'ERROR_INTERNO', mensaje: 'Ocurrió un error interno. Intenta de nuevo en un momento.' } });
}
