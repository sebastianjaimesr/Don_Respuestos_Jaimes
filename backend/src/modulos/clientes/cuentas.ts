import bcrypt from 'bcryptjs';
import { z } from 'zod';
import { pool } from '../../db';
import { AppError } from '../../errores';
import { normalizarTelefono } from '../../utils/texto';
import { validarPassword } from '../auth/servicio';
import { registrarEvento } from '../eventos/servicio';
import { firmarSesion } from '../../middleware/sesion';

const HASH_FALSO = bcrypt.hashSync('cliente-inexistente', 12);

export const esquemaRegistro = z.object({
  nombre: z.string().trim().min(2).max(120),
  email: z.string().trim().email().max(160),
  telefono: z.string().trim().refine((t) => normalizarTelefono(t) !== null, 'Teléfono colombiano inválido'),
  password: z.string().min(10).max(200),
  ciudad: z.string().trim().min(2).max(80).optional().nullable(),
});

/**
 * Crea la cuenta de un cliente. Si el teléfono ya tenía compras por el chat
 * (cliente sin cuenta), la cuenta se abre sobre ese mismo registro, pero el
 * historial solo muestra pedidos desde la apertura (ver migración 011).
 */
export async function registrarCliente(datos: z.infer<typeof esquemaRegistro>) {
  validarPassword(datos.password);
  const telefono = normalizarTelefono(datos.telefono)!;
  const email = datos.email.toLowerCase();
  const hash = await bcrypt.hash(datos.password, 12);
  try {
    const { rows } = await pool.query(
      `INSERT INTO clientes (nombre, telefono, ciudad, email, password_hash, cuenta_creada_at)
       VALUES ($1, $2, $3, $4, $5, now())
       ON CONFLICT (telefono) DO UPDATE SET
         nombre = EXCLUDED.nombre, email = EXCLUDED.email, password_hash = EXCLUDED.password_hash,
         ciudad = COALESCE(EXCLUDED.ciudad, clientes.ciudad), cuenta_creada_at = now()
       WHERE clientes.password_hash IS NULL
       RETURNING id, nombre, email, telefono`,
      [datos.nombre, telefono, datos.ciudad ?? null, email, hash],
    );
    if (!rows[0]) throw new AppError(409, 'CUENTA_EXISTENTE', 'Ya existe una cuenta con ese teléfono. Inicia sesión.');
    void registrarEvento('info', 'cliente_registrado', `Cuenta de cliente #${rows[0].id} creada`, { cliente_id: rows[0].id });
    return { token: firmarSesion('tienda', rows[0].id), cliente: rows[0] };
  } catch (e) {
    if ((e as { code?: string }).code === '23505') throw new AppError(409, 'CUENTA_EXISTENTE', 'Ya existe una cuenta con ese correo. Inicia sesión.');
    throw e;
  }
}

export async function iniciarSesionCliente(email: string, password: string) {
  const { rows } = await pool.query('SELECT id, nombre, email, telefono, password_hash FROM clientes WHERE lower(email) = lower($1) AND password_hash IS NOT NULL', [
    email.trim(),
  ]);
  const c = rows[0];
  const ok = await bcrypt.compare(password, c?.password_hash ?? HASH_FALSO);
  if (!c || !ok) throw new AppError(401, 'CREDENCIALES_INVALIDAS', 'Correo o contraseña incorrectos');
  await pool.query('UPDATE clientes SET ultimo_acceso = now() WHERE id = $1', [c.id]);
  const { password_hash: _h, ...cliente } = c;
  return { token: firmarSesion('tienda', c.id), cliente };
}

export async function pedidosDelCliente(clienteId: number) {
  const { rows } = await pool.query(
    `SELECT pe.codigo, pe.estado, pe.estado_pago, pe.modalidad_entrega, pe.total, pe.envio_confirmado, pe.canal, pe.created_at,
            (SELECT COUNT(*)::int FROM detalle_pedido d WHERE d.pedido_id = pe.id) AS items
     FROM pedidos pe JOIN clientes cl ON cl.id = pe.cliente_id
     WHERE pe.cliente_id = $1 AND pe.created_at >= cl.cuenta_creada_at
     ORDER BY pe.created_at DESC LIMIT 100`,
    [clienteId],
  );
  return rows;
}

/** El pedido debe ser de la cuenta y posterior a su apertura; si no, se responde igual que si no existiera. */
export async function pedidoDelCliente(clienteId: number, codigo: string) {
  const { rows } = await pool.query(
    `SELECT pe.id FROM pedidos pe JOIN clientes cl ON cl.id = pe.cliente_id
     WHERE pe.codigo = $1 AND pe.cliente_id = $2 AND pe.created_at >= cl.cuenta_creada_at`,
    [codigo.trim().toUpperCase(), clienteId],
  );
  if (!rows[0]) throw new AppError(404, 'PEDIDO_NO_ENCONTRADO', 'No existe ese pedido en tu cuenta');
  const p = await pool.query(
    `SELECT codigo, estado, estado_pago, modalidad_entrega, ciudad_entrega, direccion_entrega, metodo_pago,
            subtotal, costo_envio, envio_confirmado, total, created_at, updated_at FROM pedidos WHERE id = $1`,
    [rows[0].id],
  );
  const det = await pool.query('SELECT descripcion, referencia, tipo, cantidad, precio_unitario, subtotal FROM detalle_pedido WHERE pedido_id = $1 ORDER BY id', [rows[0].id]);
  return { ...p.rows[0], lineas: det.rows };
}

export async function listarFavoritos(clienteId: number) {
  const { rows } = await pool.query(
    `SELECT p.id AS producto_id, p.slug, p.sku, p.nombre, p.precio, p.tipo, e.estado AS disponibilidad, f.created_at
     FROM favoritos f JOIN productos p ON p.id = f.producto_id JOIN v_estado_inventario e ON e.producto_id = p.id
     WHERE f.cliente_id = $1 AND p.activo ORDER BY f.created_at DESC`,
    [clienteId],
  );
  return rows;
}

export async function agregarFavorito(clienteId: number, productoId: number) {
  const p = await pool.query('SELECT 1 FROM productos WHERE id = $1 AND activo', [productoId]);
  if (!p.rows[0]) throw new AppError(404, 'PRODUCTO_NO_ENCONTRADO', 'Ese producto no existe');
  await pool.query('INSERT INTO favoritos (cliente_id, producto_id) VALUES ($1, $2) ON CONFLICT DO NOTHING', [clienteId, productoId]);
}

export async function quitarFavorito(clienteId: number, productoId: number) {
  await pool.query('DELETE FROM favoritos WHERE cliente_id = $1 AND producto_id = $2', [clienteId, productoId]);
}
