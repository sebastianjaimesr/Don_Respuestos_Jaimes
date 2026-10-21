import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AppError } from '../errores';
import { pool } from '../db';

export type Rol = 'admin' | 'vendedor' | 'consulta';

export interface UsuarioToken {
  id: number;
  nombre: string;
  rol: Rol;
}

declare module 'express-serve-static-core' {
  interface Request {
    usuario?: UsuarioToken;
    rawBody?: Buffer;
  }
}

/** Verifica el token JWT del encabezado Authorization: Bearer <token>. */
export function requerirAuth(req: Request, _res: Response, next: NextFunction) {
  const h = req.headers.authorization ?? '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) return next(new AppError(401, 'NO_AUTENTICADO', 'Debes iniciar sesión'));
  let id: number;
  try {
    const p = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'] }) as jwt.JwtPayload;
    id = Number(p.sub);
  } catch {
    return next(new AppError(401, 'SESION_INVALIDA', 'Tu sesión expiró o no es válida. Inicia sesión de nuevo.'));
  }
  // Se consulta el usuario en cada solicitud: si lo desactivan o le cambian el rol,
  // el cambio aplica de inmediato (no hay que esperar a que venza el token).
  pool
    .query('SELECT id, nombre, rol FROM asesores WHERE id = $1 AND activo', [id])
    .then(({ rows }) => {
      if (!rows[0]) return next(new AppError(401, 'SESION_INVALIDA', 'Tu usuario no está activo. Inicia sesión de nuevo.'));
      req.usuario = { id: rows[0].id, nombre: rows[0].nombre, rol: rows[0].rol };
      next();
    })
    .catch(next);
}

/**
 * Autorización por roles, verificada en el SERVIDOR.
 * Ocultar un botón en la interfaz no es seguridad: esto sí.
 */
export function requerirRol(...roles: Rol[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.usuario) return next(new AppError(401, 'NO_AUTENTICADO', 'Debes iniciar sesión'));
    if (!roles.includes(req.usuario.rol)) return next(new AppError(403, 'SIN_PERMISOS', 'No tienes permisos para esta acción'));
    next();
  };
}
