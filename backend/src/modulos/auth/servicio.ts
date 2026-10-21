import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { pool } from '../../db';
import { config } from '../../config';
import { AppError } from '../../errores';
import type { Rol } from '../../middleware/auth';
import { registrarEvento } from '../eventos/servicio';

// Hash ficticio para comparar aunque el usuario no exista (mismo tiempo de respuesta)
const HASH_FALSO = bcrypt.hashSync('usuario-inexistente', 12);

export async function iniciarSesion(email: string, password: string) {
  const { rows } = await pool.query('SELECT id, nombre, email, password_hash, rol, activo FROM asesores WHERE lower(email) = lower($1)', [email.trim()]);
  const u = rows[0];
  const ok = await bcrypt.compare(password, u?.password_hash ?? HASH_FALSO);
  if (!u || !ok || !u.activo) {
    void registrarEvento('aviso', 'login_fallido', 'Intento de inicio de sesión fallido', {});
    throw new AppError(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos');
  }
  await pool.query('UPDATE asesores SET ultimo_acceso = now() WHERE id = $1', [u.id]);
  const token = jwt.sign({ nombre: u.nombre, rol: u.rol }, config.JWT_SECRET, {
    subject: String(u.id),
    expiresIn: config.JWT_EXPIRA_EN as jwt.SignOptions['expiresIn'],
    algorithm: 'HS256',
  });
  void registrarEvento('info', 'login', `Inicio de sesión de asesor #${u.id}`, { asesor_id: u.id });
  return { token, usuario: { id: u.id, nombre: u.nombre, email: u.email, rol: u.rol as Rol } };
}

export function validarPassword(password: string) {
  if (password.length < 10 || !/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    throw new AppError(400, 'PASSWORD_DEBIL', 'La contraseña debe tener al menos 10 caracteres, con letras y números');
  }
}

export async function crearAsesor(datos: { nombre: string; email: string; password: string; rol: Rol }) {
  validarPassword(datos.password);
  const hash = await bcrypt.hash(datos.password, 12);
  try {
    const { rows } = await pool.query(
      'INSERT INTO asesores (nombre, email, password_hash, rol) VALUES ($1, $2, $3, $4) RETURNING id, nombre, email, rol, activo, created_at',
      [datos.nombre.trim(), datos.email.trim().toLowerCase(), hash, datos.rol],
    );
    return rows[0];
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new AppError(409, 'EMAIL_DUPLICADO', 'Ya existe un usuario con ese correo');
    throw e;
  }
}
