import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { config } from '../../config';
import { pool } from '../../db';
import { AppError } from '../../errores';
import { h, ok } from '../../utils/http';
import { requerirAuth } from '../../middleware/auth';
import { abrirSesion, cerrarSesion, COOKIE, leerCookie, tokenCsrf } from '../../middleware/sesion';
import { iniciarSesion, validarPassword } from '../../modulos/auth/servicio';
import { r as metricas } from './metricas';
import { r as catalogo } from './catalogo';
import { r as productos } from './productos';
import { r as inventario } from './inventario';
import { r as compras } from './compras';
import { r as ventas } from './ventas';
import { r as atencion } from './atencion';
import { r as sistema } from './sistema';
import { r as comercial } from './comercial';
import { r as datos } from './datos';
import { r as imagenes } from './imagenes';

/**
 * Rutas del panel. Cada ruta exige un PERMISO (tabla rol_permisos), no un rol
 * fijo. Las escrituras corren con el asesor en `drj.usuario_id`, así que la
 * auditoría de la base de datos sabe quién hizo cada cambio.
 */
export const rutasAdmin = Router();

const limiteLogin = rateLimit({
  windowMs: 15 * 60_000,
  limit: config.RATE_LIMIT_LOGIN_POR_15MIN,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { codigo: 'DEMASIADOS_INTENTOS', mensaje: 'Demasiados intentos. Espera 15 minutos.' } },
});

// ---------------- Sesión ----------------
rutasAdmin.post(
  '/auth/login',
  limiteLogin,
  h(async (req, res) => {
    const { email, password } = z.object({ email: z.string().email().max(160), password: z.string().min(1).max(200) }).parse(req.body);
    const r = await iniciarSesion(email, password);
    // Cookie HttpOnly + token CSRF. El token en el cuerpo se mantiene mientras el panel
    // actual (que usa Authorization: Bearer) se migra a cookies en la fase 5.
    const csrf = abrirSesion(res, 'panel', r.token);
    ok(res, { ...r, csrf });
  }),
);
rutasAdmin.post('/auth/logout', (_req, res) => {
  cerrarSesion(res, 'panel');
  ok(res, { sesion: 'cerrada' });
});
rutasAdmin.get('/auth/yo', requerirAuth, (req, res) => {
  const t = leerCookie(req, COOKIE.panel);
  ok(res, { ...req.usuario, csrf: t ? tokenCsrf(t) : null });
});
rutasAdmin.put(
  '/auth/password',
  limiteLogin,
  requerirAuth,
  h(async (req, res) => {
    const d = z.object({ actual: z.string().min(1).max(200), nueva: z.string().min(10).max(200) }).parse(req.body);
    validarPassword(d.nueva);
    const { rows } = await pool.query('SELECT password_hash FROM asesores WHERE id = $1', [req.usuario!.id]);
    if (!(await bcrypt.compare(d.actual, rows[0].password_hash))) throw new AppError(400, 'PASSWORD_INCORRECTA', 'La contraseña actual no es correcta');
    await pool.query('UPDATE asesores SET password_hash = $2 WHERE id = $1', [req.usuario!.id, await bcrypt.hash(d.nueva, 12)]);
    ok(res, { actualizada: true });
  }),
);

// ---------------- Todo lo que sigue exige sesión ----------------
const admin = Router();
admin.use(requerirAuth);
rutasAdmin.use('/admin', admin);

// Los sub-routers no usan `r.use(...)`: un middleware a nivel de router correría
// para TODAS las rutas del panel. Cada ruta declara su permiso.
for (const area of [metricas, catalogo, productos, imagenes, inventario, compras, ventas, comercial, datos, atencion, sistema]) admin.use(area);
