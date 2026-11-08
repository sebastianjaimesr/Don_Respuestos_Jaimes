import { Router } from 'express';
import { z } from 'zod';
import { pool, enTransaccion, moverStock } from '../../db';
import { config } from '../../config';
import { AppError } from '../../errores';
import { h, ok, paginacion } from '../../utils/http';
import { requerirPermiso, tienePermiso } from '../../middleware/auth';
import { crearAsesor } from '../../modulos/auth/servicio';
import { obtenerConfiguracion } from '../../modulos/negocio/servicio';
import { registrarEvento } from '../../modulos/eventos/servicio';

/** Configuración, usuarios, roles, eventos y auditoría. */
export const r = Router();
const usuarios = requerirPermiso('usuarios.gestionar');
const claveRol = z.string().trim().regex(/^[a-z_]+$/, 'Rol inválido').max(20);
async function exigirRol(clave: string) {
  if (!(await pool.query('SELECT 1 FROM roles WHERE clave = $1', [clave])).rows[0]) throw new AppError(400, 'ROL_INVALIDO', 'Ese rol no existe');
}

// =====================================================================
// Configuración del negocio, eventos y usuarios
// =====================================================================
r.get('/configuracion', h(async (_req, res) => ok(res, Object.values(await obtenerConfiguracion()))));
r.put(
  '/configuracion/:clave',
  requerirPermiso('configuracion.editar'),
  h(async (req, res) => {
    const d = z.object({ valor: z.unknown(), confirmado: z.boolean() }).parse(req.body);
    if (d.confirmado && (d.valor === null || d.valor === undefined || d.valor === '')) {
      throw new AppError(400, 'VALOR_REQUERIDO', 'No puedes marcar como confirmado un dato vacío');
    }
    const { rows } = await enTransaccion(
      (db) =>
        db.query('UPDATE configuracion_negocio SET valor = $2, confirmado = $3, updated_at = now() WHERE clave = $1 RETURNING clave, valor, descripcion, confirmado', [
          req.params.clave,
          d.valor === undefined ? null : JSON.stringify(d.valor),
          d.confirmado,
        ]),
      { usuarioId: req.usuario!.id },
    );
    if (!rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Clave de configuración no encontrada');
    void registrarEvento('info', 'configuracion_actualizada', `Configuración "${req.params.clave}" actualizada`, { asesor_id: req.usuario!.id });
    ok(res, rows[0]);
  }),
);

r.get(
  '/eventos',
  requerirPermiso('auditoria.ver'),
  h(async (req, res) => {
    const { pagina, tamano, offset } = paginacion(req.query);
    const nivel = z.enum(['info', 'aviso', 'error']).optional().parse(req.query.nivel || undefined);
    const { rows } = await pool.query(
      'SELECT * FROM registros_eventos WHERE ($1::text IS NULL OR nivel = $1) ORDER BY id DESC LIMIT $2 OFFSET $3',
      [nivel ?? null, tamano, offset],
    );
    ok(res, { items: rows, pagina, tamano });
  }),
);

r.get('/asesores', usuarios, h(async (_req, res) => ok(res, (await pool.query('SELECT id, nombre, email, rol, activo, created_at, ultimo_acceso FROM asesores ORDER BY nombre')).rows)));
r.post(
  '/asesores',
  usuarios,
  h(async (req, res) => {
    const d = z
      .object({ nombre: z.string().trim().min(2).max(120), email: z.string().email().max(160), password: z.string().min(10).max(200), rol: claveRol })
      .parse(req.body);
    await exigirRol(d.rol);
    ok(res, await crearAsesor(d), 201);
  }),
);
r.patch(
  '/asesores/:id',
  usuarios,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const d = z.object({ activo: z.boolean().optional(), rol: claveRol.optional() }).parse(req.body);
    if (d.rol) await exigirRol(d.rol);
    if (id === req.usuario!.id && (d.activo === false || (d.rol && d.rol !== 'admin'))) {
      throw new AppError(400, 'OPERACION_NO_PERMITIDA', 'No puedes desactivarte ni quitarte el rol de administrador a ti mismo');
    }
    const { rows } = await enTransaccion(
      (db) =>
        db.query('UPDATE asesores SET activo = COALESCE($2, activo), rol = COALESCE($3, rol) WHERE id = $1 RETURNING id, nombre, email, rol, activo', [
          id,
          d.activo ?? null,
          d.rol ?? null,
        ]),
      { usuarioId: req.usuario!.id },
    );
    if (!rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'Usuario no encontrado');
    ok(res, rows[0]);
  }),
);


// ---- Roles y permisos ----
r.get(
  '/roles',
  usuarios,
  h(async (_req, res) => {
    const { rows } = await pool.query(
      `SELECT r.clave, r.nombre, r.descripcion, r.es_sistema,
              COALESCE(array_agg(rp.permiso ORDER BY rp.permiso) FILTER (WHERE rp.permiso IS NOT NULL), '{}') AS permisos,
              (SELECT COUNT(*)::int FROM asesores a WHERE a.rol = r.clave) AS usuarios
       FROM roles r LEFT JOIN rol_permisos rp ON rp.rol = r.clave GROUP BY r.clave ORDER BY r.es_sistema DESC, r.nombre`,
    );
    ok(res, { roles: rows, permisos: (await pool.query('SELECT clave, descripcion FROM permisos ORDER BY clave')).rows });
  }),
);
r.post(
  '/roles',
  usuarios,
  h(async (req, res) => {
    const d = z.object({ clave: claveRol, nombre: z.string().trim().min(2).max(60), descripcion: z.string().trim().max(200).nullable().optional() }).parse(req.body);
    try {
      const { rows } = await enTransaccion((db) => db.query('INSERT INTO roles (clave, nombre, descripcion) VALUES ($1, $2, $3) RETURNING *', [d.clave, d.nombre, d.descripcion ?? null]), {
        usuarioId: req.usuario!.id,
      });
      ok(res, rows[0], 201);
    } catch (e) {
      if ((e as { code?: string }).code === '23505') throw new AppError(409, 'ROL_DUPLICADO', 'Ya existe un rol con esa clave');
      throw e;
    }
  }),
);
/** Reemplaza los permisos de un rol. El rol admin siempre conserva todos (para no quedarse sin acceso). */
r.put(
  '/roles/:clave/permisos',
  usuarios,
  h(async (req, res) => {
    const clave = claveRol.parse(req.params.clave);
    if (clave === 'admin') throw new AppError(400, 'OPERACION_NO_PERMITIDA', 'El rol de administrador siempre tiene todos los permisos');
    const { permisos } = z.object({ permisos: z.array(z.string().max(40)).max(50) }).parse(req.body);
    await enTransaccion(async (db) => {
      await exigirRol(clave);
      const validos = (await db.query('SELECT clave FROM permisos WHERE clave = ANY($1::text[])', [permisos])).rows.map((x) => x.clave);
      const invalidos = permisos.filter((p) => !validos.includes(p));
      if (invalidos.length) throw new AppError(400, 'PERMISO_INVALIDO', `Permisos que no existen: ${invalidos.join(', ')}`);
      await db.query('DELETE FROM rol_permisos WHERE rol = $1 AND NOT (permiso = ANY($2::text[]))', [clave, permisos]);
      await db.query('INSERT INTO rol_permisos (rol, permiso) SELECT $1, unnest($2::text[]) ON CONFLICT DO NOTHING', [clave, permisos]);
    }, { usuarioId: req.usuario!.id });
    ok(res, { rol: clave, permisos: [...new Set(permisos)].sort() });
  }),
);

// ---- Auditoría ----
r.get(
  '/auditoria',
  requerirPermiso('auditoria.ver'),
  h(async (req, res) => {
    const { pagina, tamano, offset } = paginacion(req.query);
    const f = z
      .object({ tabla: z.string().max(60).optional(), registro_id: z.string().max(60).optional(), asesor_id: z.coerce.number().int().positive().optional() })
      .parse(req.query);
    const { rows } = await pool.query(
      `SELECT au.id, au.tabla, au.registro_id, au.accion, au.cambios, au.created_at, a.nombre AS asesor
       FROM auditoria au LEFT JOIN asesores a ON a.id = au.asesor_id
       WHERE ($1::text IS NULL OR au.tabla = $1) AND ($2::text IS NULL OR au.registro_id = $2) AND ($3::int IS NULL OR au.asesor_id = $3)
       ORDER BY au.id DESC LIMIT $4 OFFSET $5`,
      [f.tabla ?? null, f.registro_id ?? null, f.asesor_id ?? null, tamano, offset],
    );
    ok(res, { items: rows, pagina, tamano });
  }),
);
