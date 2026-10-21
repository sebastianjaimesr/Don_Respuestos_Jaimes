import { z } from 'zod';
import { pool } from '../../db';
import { config } from '../../config';
import { AppError } from '../../errores';
import { enviarFirmado } from '../../utils/firma';
import { registrarEvento } from '../eventos/servicio';

export const MOTIVOS_ESCALAMIENTO = [
  'solicitud_cliente',
  'cliente_molesto',
  'compatibilidad_dudosa',
  'datos_faltantes',
  'precio_no_confirmado',
  'producto_agotado',
  'error_sistema',
  'otro',
] as const;
export type MotivoEscalamiento = (typeof MOTIVOS_ESCALAMIENTO)[number];

export const esquemaEscalar = z.object({
  motivo: z.enum(MOTIVOS_ESCALAMIENTO),
  detalle: z.string().trim().max(1000).optional().nullable(),
  conversacion_id: z.string().uuid().optional().nullable(),
  cliente_id: z.number().int().positive().optional().nullable(),
});

/**
 * HERRAMIENTA escalar_a_humano(motivo)
 * Siempre registra la solicitud. Solo notifica si hay un canal configurado
 * (N8N_NOTIFICACION_URL + WEBHOOK_SECRET); si no, queda pendiente en el panel.
 */
export async function escalarAHumano(entradaCruda: unknown) {
  const e = esquemaEscalar.parse(entradaCruda);

  // Evita duplicar: si la conversación ya tiene una solicitud abierta, se reutiliza.
  if (e.conversacion_id) {
    const abierta = await pool.query(
      `SELECT id, estado, notificado FROM transferencias_atencion WHERE conversacion_id = $1 AND estado <> 'resuelta' ORDER BY id DESC LIMIT 1`,
      [e.conversacion_id],
    );
    if (abierta.rows[0]) return { ...abierta.rows[0], ya_existia: true, canal_configurado: canalConfigurado() };
  }

  const { rows } = await pool.query(
    `INSERT INTO transferencias_atencion (conversacion_id, cliente_id, motivo, detalle) VALUES ($1, $2, $3, $4) RETURNING id, estado, notificado, created_at`,
    [e.conversacion_id ?? null, e.cliente_id ?? null, e.motivo, e.detalle ?? null],
  );
  const t = rows[0];
  if (e.conversacion_id) {
    await pool.query(`UPDATE conversaciones SET estado = 'escalada' WHERE id = $1 AND estado = 'activa'`, [e.conversacion_id]);
  }

  let notificado = false;
  if (canalConfigurado()) {
    try {
      notificado = await enviarFirmado(config.N8N_NOTIFICACION_URL!, config.WEBHOOK_SECRET!, {
        evento: 'escalamiento_creado',
        transferencia_id: t.id,
        motivo: e.motivo,
        detalle: e.detalle ?? null,
        conversacion_id: e.conversacion_id ?? null,
        creado: t.created_at,
      });
      if (notificado) {
        await pool.query(`UPDATE transferencias_atencion SET notificado = true, canal_notificacion = 'n8n' WHERE id = $1`, [t.id]);
      }
    } catch (err) {
      void registrarEvento('error', 'notificacion_fallida', 'No se pudo notificar el escalamiento a n8n', { transferencia_id: t.id, error: (err as Error).message });
    }
  }
  void registrarEvento('info', 'escalamiento_creado', `Solicitud de atención humana #${t.id}`, { motivo: e.motivo, notificado });
  return { id: t.id, estado: t.estado, notificado, ya_existia: false, canal_configurado: canalConfigurado() };
}

export function canalConfigurado(): boolean {
  return Boolean(config.N8N_NOTIFICACION_URL && config.WEBHOOK_SECRET);
}

export async function cambiarEstadoTransferencia(id: number, estado: 'pendiente' | 'en_atencion' | 'resuelta', asesorId: number) {
  const { rows } = await pool.query(
    `UPDATE transferencias_atencion SET estado = $2::text, asesor_id = $3,
       atendida_at = CASE WHEN $2::text = 'en_atencion' AND atendida_at IS NULL THEN now() ELSE atendida_at END,
       resuelta_at = CASE WHEN $2::text = 'resuelta' THEN now() ELSE NULL END
     WHERE id = $1 RETURNING id, estado, conversacion_id`,
    [id, estado, asesorId],
  );
  if (!rows[0]) throw new AppError(404, 'NO_ENCONTRADO', 'No existe esa solicitud');
  // Al resolver, la conversación vuelve a quedar activa para el asistente.
  if (estado === 'resuelta' && rows[0].conversacion_id) {
    await pool.query(`UPDATE conversaciones SET estado = 'activa' WHERE id = $1 AND estado = 'escalada'`, [rows[0].conversacion_id]);
  }
  return rows[0];
}
