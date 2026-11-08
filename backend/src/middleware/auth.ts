import type { NextFunction, Request, Response } from 'express';
import { AppError } from '../errores';
import { pool } from '../db';
import { leerSesion } from './sesion';

/** Roles de sistema. Se pueden crear otros en la tabla `roles`. */
export type Rol = 'admin' | 'vendedor' | 'consulta' | (string & {});

export type Permiso =
  | 'catalogo.ver'
  | 'inventario.ver'
  | 'ventas.ver'
  | 'productos.editar'
  | 'compatibilidades.editar'
  | 'imagenes.editar'
  | 'precios.editar'
  | 'precios.masivo'
  | 'inventario.mover'
  | 'compras.gestionar'
  | 'importaciones.aplicar'
  | 'exportaciones.descargar'
  | 'pedidos.gestionar'
  | 'atencion.gestionar'
  | 'configuracion.editar'
  | 'usuarios.gestionar'
  | 'auditoria.ver';

export interface UsuarioToken {
  id: number;
  nombre: string;
  rol: Rol;
  permisos: Permiso[];
}

export interface ClienteSesion {
  id: number;
  nombre: string;
  email: string;
  telefono: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    usuario?: UsuarioToken;
    cliente?: ClienteSesion;
    rawBody?: Buffer;
  }
}

/** Sesión de asesor (panel): token Bearer o cookie `drj_panel`. */
export function requerirAuth(req: Request, _res: Response, next: NextFunction) {
  let s;
  try {
    s = leerSesion(req, 'panel');
  } catch (e) {
    return next(e);
  }
  if (!s) return next(new AppError(401, 'NO_AUTENTICADO', 'Debes iniciar sesión'));
  // Se consulta el usuario y sus permisos en cada solicitud: si lo desactivan o le
  // cambian el rol, el cambio aplica de inmediato (no hay que esperar a que venza el token).
  pool
    .query(
      `SELECT a.id, a.nombre, a.rol, COALESCE(array_agg(rp.permiso) FILTER (WHERE rp.permiso IS NOT NULL), '{}') AS permisos
       FROM asesores a LEFT JOIN rol_permisos rp ON rp.rol = a.rol
       WHERE a.id = $1 AND a.activo GROUP BY a.id`,
      [s.id],
    )
    .then(({ rows }) => {
      if (!rows[0]) return next(new AppError(401, 'SESION_INVALIDA', 'Tu usuario no está activo. Inicia sesión de nuevo.'));
      req.usuario = { id: rows[0].id, nombre: rows[0].nombre, rol: rows[0].rol, permisos: rows[0].permisos };
      next();
    })
    .catch(next);
}

/**
 * Autorización por permisos, verificada en el SERVIDOR.
 * Ocultar un botón en la interfaz no es seguridad: esto sí.
 */
export function requerirPermiso(...permisos: Permiso[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.usuario) return next(new AppError(401, 'NO_AUTENTICADO', 'Debes iniciar sesión'));
    if (!permisos.every((p) => req.usuario!.permisos.includes(p))) return next(new AppError(403, 'SIN_PERMISOS', 'No tienes permisos para esta acción'));
    next();
  };
}

export const tienePermiso = (req: Request, p: Permiso) => Boolean(req.usuario?.permisos.includes(p));

/** Sesión de cliente de la tienda (cookie `drj_cliente`). Si `obligatoria` es false, solo la lee. */
export function sesionCliente(obligatoria: boolean) {
  return (req: Request, _res: Response, next: NextFunction) => {
    let s;
    try {
      s = leerSesion(req, 'tienda');
    } catch (e) {
      // Sesión vencida en una ruta opcional → se sigue como visitante; un CSRF inválido siempre se rechaza.
      return obligatoria || (e as AppError).codigo === 'CSRF_INVALIDO' ? next(e) : next();
    }
    if (!s) return obligatoria ? next(new AppError(401, 'NO_AUTENTICADO', 'Inicia sesión en tu cuenta')) : next();
    pool
      .query('SELECT id, nombre, email, telefono FROM clientes WHERE id = $1 AND password_hash IS NOT NULL', [s.id])
      .then(({ rows }) => {
        if (!rows[0]) return obligatoria ? next(new AppError(401, 'SESION_INVALIDA', 'Tu cuenta no está disponible. Inicia sesión de nuevo.')) : next();
        req.cliente = rows[0];
        next();
      })
      .catch(next);
  };
}
