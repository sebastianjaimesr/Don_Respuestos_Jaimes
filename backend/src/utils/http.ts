import type { NextFunction, Request, Response } from 'express';

/** Express 4 no captura errores de funciones async: este envoltorio los pasa al manejador. */
export const h =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>) =>
  (req: Request, res: Response, next: NextFunction) =>
    fn(req, res, next).catch(next);

/** Respuesta exitosa con formato consistente: { ok: true, data } */
export const ok = (res: Response, data: unknown, status = 200) => res.status(status).json({ ok: true, data });

export function paginacion(q: Record<string, unknown>) {
  const pagina = Math.max(1, parseInt(String(q.pagina ?? '1'), 10) || 1);
  const tamano = Math.min(100, Math.max(1, parseInt(String(q.tamano ?? '20'), 10) || 20));
  return { pagina, tamano, offset: (pagina - 1) * tamano };
}
