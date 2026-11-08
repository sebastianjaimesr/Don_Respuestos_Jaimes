import { Router } from 'express';
import { z } from 'zod';
import { pool, enTransaccion, moverStock } from '../../db';
import { config } from '../../config';
import { AppError } from '../../errores';
import { h, ok, paginacion } from '../../utils/http';
import { requerirPermiso, tienePermiso } from '../../middleware/auth';
import { cambiarEstadoTransferencia } from '../../modulos/escalamiento/servicio';
import { guardarMensaje, listarMensajes, obtenerConversacion } from '../../modulos/conversaciones/servicio';
import { registrarEvento } from '../../modulos/eventos/servicio';
import { enviarFirmado } from '../../utils/firma';

/** Atención humana de conversaciones transferidas. */
export const r = Router();
const ver = requerirPermiso('ventas.ver');
const atender = requerirPermiso('atencion.gestionar');

// =====================================================================
// Atención humana
// =====================================================================
r.get(
  '/transferencias',
  ver,
  h(async (req, res) => {
    const estado = z.enum(['pendiente', 'en_atencion', 'resuelta']).optional().parse(req.query.estado || undefined);
    const { pagina, tamano, offset } = paginacion(req.query);
    const { rows } = await pool.query(
      `SELECT t.*, a.nombre AS asesor, c.canal, cl.nombre AS cliente,
              (SELECT contenido FROM mensajes m WHERE m.conversacion_id = t.conversacion_id AND m.rol = 'cliente' ORDER BY m.id DESC LIMIT 1) AS ultimo_mensaje
       FROM transferencias_atencion t LEFT JOIN asesores a ON a.id = t.asesor_id
       LEFT JOIN conversaciones c ON c.id = t.conversacion_id LEFT JOIN clientes cl ON cl.id = COALESCE(t.cliente_id, c.cliente_id)
       WHERE ($1::text IS NULL OR t.estado = $1)
       ORDER BY (t.estado = 'pendiente') DESC, t.created_at DESC LIMIT $2 OFFSET $3`,
      [estado ?? null, tamano, offset],
    );
    ok(res, { items: rows, pagina, tamano });
  }),
);
r.patch(
  '/transferencias/:id',
  atender,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const { estado } = z.object({ estado: z.enum(['pendiente', 'en_atencion', 'resuelta']) }).parse(req.body);
    ok(res, await cambiarEstadoTransferencia(id, estado, req.usuario!.id));
  }),
);
r.get(
  '/transferencias/:id/mensajes',
  ver,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const t = (await pool.query('SELECT conversacion_id FROM transferencias_atencion WHERE id = $1', [id])).rows[0];
    if (!t) throw new AppError(404, 'NO_ENCONTRADO', 'Solicitud no encontrada');
    if (!t.conversacion_id) return ok(res, { conversacion: null, mensajes: [] });
    const conv = await obtenerConversacion(t.conversacion_id);
    ok(res, { conversacion: conv && { id: conv.id, canal: conv.canal, estado: conv.estado, moto: conv.contexto.moto, carrito: conv.contexto.carrito }, mensajes: await listarMensajes(t.conversacion_id) });
  }),
);
/** El asesor responde al cliente. En web el chat lo recibe consultando; en otros canales se envía por n8n. */
r.post(
  '/transferencias/:id/mensajes',
  atender,
  h(async (req, res) => {
    const id = z.coerce.number().int().parse(req.params.id);
    const { texto } = z.object({ texto: z.string().trim().min(1).max(2000) }).parse(req.body);
    const t = (await pool.query('SELECT conversacion_id, estado FROM transferencias_atencion WHERE id = $1', [id])).rows[0];
    if (!t?.conversacion_id) throw new AppError(404, 'NO_ENCONTRADO', 'La solicitud no tiene una conversación asociada');
    const conv = await obtenerConversacion(t.conversacion_id);
    if (!conv) throw new AppError(404, 'NO_ENCONTRADO', 'Conversación no encontrada');
    if (t.estado === 'pendiente') await cambiarEstadoTransferencia(id, 'en_atencion', req.usuario!.id);
    const m = await guardarMensaje(conv.id, 'asesor', texto, { asesor_id: req.usuario!.id, asesor: req.usuario!.nombre });
    let entregado: 'chat_web' | 'n8n' | 'no_enviado' = 'chat_web';
    if (conv.canal !== 'web') {
      entregado = 'no_enviado';
      if (config.N8N_SALIENTE_URL && config.WEBHOOK_SECRET) {
        try {
          const okEnvio = await enviarFirmado(config.N8N_SALIENTE_URL, config.WEBHOOK_SECRET, { canal: conv.canal, canal_usuario_id: conv.canal_usuario_id, texto });
          if (okEnvio) entregado = 'n8n';
        } catch (e) {
          void registrarEvento('error', 'mensaje_asesor_no_enviado', 'No se pudo enviar el mensaje del asesor por n8n', { error: (e as Error).message });
        }
      }
    }
    ok(res, { mensaje: m, entregado }, 201);
  }),
);

