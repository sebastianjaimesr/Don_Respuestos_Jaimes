import { pool } from '../../db';
import { AppError } from '../../errores';
import type { Contexto } from '../../asistente/tipos';
import { contextoInicial } from '../../asistente/tipos';

export interface Conversacion {
  id: string;
  canal: 'web' | 'whatsapp' | 'telegram' | 'otro';
  canal_usuario_id: string | null;
  cliente_id: number | null;
  estado: 'activa' | 'escalada' | 'cerrada';
  contexto: Contexto;
}

const COLUMNAS = 'id, canal, canal_usuario_id, cliente_id, estado, contexto';

export async function obtenerConversacion(id: string): Promise<Conversacion | null> {
  const { rows } = await pool.query(`SELECT ${COLUMNAS} FROM conversaciones WHERE id = $1`, [id]);
  return rows[0] ? normalizarFila(rows[0]) : null;
}

/**
 * Recupera la conversación activa de un usuario de un canal externo
 * (ej. número de WhatsApp) o crea una nueva.
 */
export async function obtenerOCrear(opts: { id?: string | null; canal: Conversacion['canal']; canal_usuario_id?: string | null }): Promise<Conversacion> {
  if (opts.id) {
    const c = await obtenerConversacion(opts.id);
    if (!c) throw new AppError(404, 'CONVERSACION_NO_ENCONTRADA', 'La conversación no existe');
    if (c.canal !== opts.canal) throw new AppError(403, 'CANAL_INCORRECTO', 'La conversación pertenece a otro canal');
    return c;
  }
  if (opts.canal_usuario_id) {
    const { rows } = await pool.query(
      `SELECT ${COLUMNAS} FROM conversaciones WHERE canal = $1 AND canal_usuario_id = $2 AND estado <> 'cerrada' ORDER BY created_at DESC LIMIT 1`,
      [opts.canal, opts.canal_usuario_id],
    );
    if (rows[0]) return normalizarFila(rows[0]);
  }
  const { rows } = await pool.query(
    `INSERT INTO conversaciones (canal, canal_usuario_id, contexto) VALUES ($1, $2, $3) RETURNING ${COLUMNAS}`,
    [opts.canal, opts.canal_usuario_id ?? null, JSON.stringify(contextoInicial())],
  );
  return normalizarFila(rows[0]);
}

function normalizarFila(f: Conversacion): Conversacion {
  return { ...f, contexto: { ...contextoInicial(), ...(f.contexto ?? {}) } };
}

export async function guardarContexto(id: string, contexto: Contexto, clienteId?: number | null) {
  await pool.query('UPDATE conversaciones SET contexto = $2, cliente_id = COALESCE($3, cliente_id) WHERE id = $1', [id, JSON.stringify(contexto), clienteId ?? null]);
}

export async function guardarMensaje(conversacionId: string, rol: 'cliente' | 'asistente' | 'asesor' | 'sistema', contenido: string, metadata: Record<string, unknown> = {}) {
  const { rows } = await pool.query(
    'INSERT INTO mensajes (conversacion_id, rol, contenido, metadata) VALUES ($1, $2, $3, $4) RETURNING id, rol, contenido, metadata, created_at',
    [conversacionId, rol, contenido.slice(0, 4000), JSON.stringify(metadata)],
  );
  return rows[0];
}

export async function listarMensajes(conversacionId: string, despuesDe = 0, limite = 200) {
  const { rows } = await pool.query(
    'SELECT id, rol, contenido, metadata, created_at FROM mensajes WHERE conversacion_id = $1 AND id > $2 ORDER BY id LIMIT $3',
    [conversacionId, despuesDe, limite],
  );
  return rows;
}

/** ¿Hay un asesor atendiendo esta conversación ahora mismo? */
export async function asesorAtendiendo(conversacionId: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM transferencias_atencion WHERE conversacion_id = $1 AND estado = 'en_atencion' LIMIT 1`, [conversacionId]);
  return rows.length > 0;
}
