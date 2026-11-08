import crypto from 'node:crypto';
import type { CookieOptions, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';
import { AppError } from '../errores';

/**
 * Sesiones con cookie HttpOnly (JavaScript no puede leer el token, así que un
 * XSS no puede robarlo) + protección CSRF.
 *
 * El frontend (GitHub Pages) y el backend (Render) viven en dominios distintos,
 * así que el frontend no puede leer una cookie del backend para el clásico
 * "doble envío". Por eso el token CSRF es un HMAC del token de sesión: el
 * backend lo entrega en el cuerpo del login y de /yo, el frontend lo guarda en
 * memoria y lo manda en el encabezado X-CSRF-Token en cada escritura.
 */
export type Audiencia = 'panel' | 'tienda';

export const COOKIE = { panel: 'drj_panel', tienda: 'drj_cliente' } as const;
const DURACION = { panel: config.JWT_EXPIRA_EN, tienda: '30d' } as const;
const MAX_AGE_MS = { panel: 8 * 3600_000, tienda: 30 * 24 * 3600_000 } as const;

const produccion = config.NODE_ENV === 'production';
const opcionesCookie = (aud: Audiencia): CookieOptions => ({
  httpOnly: true,
  // Dominios distintos en producción → SameSite=None, que exige Secure (HTTPS).
  secure: produccion,
  sameSite: produccion ? 'none' : 'lax',
  path: '/api',
  maxAge: MAX_AGE_MS[aud],
});

export function firmarSesion(aud: Audiencia, sub: number, extra: Record<string, unknown> = {}) {
  return jwt.sign({ ...extra }, config.JWT_SECRET, {
    subject: String(sub),
    audience: aud,
    expiresIn: DURACION[aud] as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
}

export const tokenCsrf = (token: string) => crypto.createHmac('sha256', config.JWT_SECRET).update(`csrf:${token}`).digest('base64url');

/** Pone la cookie de sesión y devuelve el token CSRF para el cuerpo de la respuesta. */
export function abrirSesion(res: Response, aud: Audiencia, token: string) {
  res.cookie(COOKIE[aud], token, opcionesCookie(aud));
  return tokenCsrf(token);
}

export function cerrarSesion(res: Response, aud: Audiencia) {
  const { maxAge: _m, ...op } = opcionesCookie(aud);
  res.clearCookie(COOKIE[aud], op);
}

export function leerCookie(req: Request, nombre: string): string | null {
  const cab = req.headers.cookie;
  if (!cab) return null;
  for (const parte of cab.split(';')) {
    const i = parte.indexOf('=');
    if (i < 0) continue;
    if (parte.slice(0, i).trim() === nombre) {
      try {
        return decodeURIComponent(parte.slice(i + 1).trim());
      } catch {
        return null;
      }
    }
  }
  return null;
}

const METODOS_SEGUROS = new Set(['GET', 'HEAD', 'OPTIONS']);

function iguales(a: string, b: string) {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

/**
 * Lee la sesión de la audiencia pedida. Acepta `Authorization: Bearer` (n8n,
 * scripts y el panel actual) o la cookie. Con cookie, toda escritura exige el
 * token CSRF. Devuelve el id del usuario o null si no hay sesión.
 */
export function leerSesion(req: Request, aud: Audiencia): { id: number; token: string; porCookie: boolean } | null {
  const h = req.headers.authorization ?? '';
  const bearer = h.startsWith('Bearer ') ? h.slice(7) : null;
  const cookie = bearer ? null : leerCookie(req, COOKIE[aud]);
  const token = bearer ?? cookie;
  if (!token) return null;
  let id: number;
  try {
    const p = jwt.verify(token, config.JWT_SECRET, { algorithms: ['HS256'], audience: aud }) as jwt.JwtPayload;
    id = Number(p.sub);
  } catch {
    throw new AppError(401, 'SESION_INVALIDA', 'Tu sesión expiró o no es válida. Inicia sesión de nuevo.');
  }
  if (cookie && !METODOS_SEGUROS.has(req.method)) {
    const enviado = String(req.headers['x-csrf-token'] ?? '');
    if (!enviado || !iguales(enviado, tokenCsrf(token))) {
      throw new AppError(403, 'CSRF_INVALIDO', 'Falta o no coincide el token de seguridad. Recarga la página.');
    }
  }
  return { id, token, porCookie: Boolean(cookie) };
}
