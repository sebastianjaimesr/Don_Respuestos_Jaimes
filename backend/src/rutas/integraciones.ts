import { Router, type NextFunction, type Request, type Response } from 'express';
import { z } from 'zod';
import { h, ok } from '../utils/http';
import { requerirFirma } from '../middleware/firmaWebhook';
import { requerirAuth, requerirRol } from '../middleware/auth';
import { esquemaMensajeEntrante } from '../asistente/esquemas';
import { atenderMensaje } from '../modulos/conversaciones/atencion';
import { obtenerOCrear } from '../modulos/conversaciones/servicio';
import { crearCotizacion } from '../modulos/cotizaciones/servicio';
import { registrarPedido } from '../modulos/pedidos/servicio';
import { escalarAHumano } from '../modulos/escalamiento/servicio';
import { registrarEvento } from '../modulos/eventos/servicio';

export const rutasIntegraciones = Router();

/**
 * Operaciones que escriben datos (cotizar, pedir, escalar) NO son públicas:
 * las puede llamar n8n con firma HMAC, o un asesor autenticado.
 * El chat web no las necesita porque usa el motor internamente.
 */
function firmaOStaff(req: Request, res: Response, next: NextFunction) {
  if (req.headers.authorization) {
    return requerirAuth(req, res, (err?: unknown) => (err ? next(err) : requerirRol('admin', 'vendedor')(req, res, next)));
  }
  return requerirFirma(req, res, next);
}

// ---- Mensaje entrante desde un canal externo (WhatsApp, Telegram…) vía n8n ----
rutasIntegraciones.post(
  '/integraciones/mensaje',
  requerirFirma,
  h(async (req, res) => {
    const base = z.object({
      canal: z.enum(['whatsapp', 'telegram', 'otro']),
      canal_usuario_id: z.string().trim().min(1).max(120),
    });
    const { canal, canal_usuario_id } = base.parse(req.body);
    const cuerpo = esquemaMensajeEntrante.parse(req.body);
    const conv = await obtenerOCrear({ canal, canal_usuario_id });
    ok(res, await atenderMensaje(conv, { texto: cuerpo.texto, accion: cuerpo.accion }));
  }),
);

// ---- Errores reportados por los flujos de n8n ----
rutasIntegraciones.post(
  '/integraciones/eventos',
  requerirFirma,
  h(async (req, res) => {
    const e = z
      .object({
        nivel: z.enum(['info', 'aviso', 'error']),
        tipo: z.string().max(60),
        mensaje: z.string().max(2000),
        datos: z.record(z.unknown()).optional(),
      })
      .parse(req.body);
    await registrarEvento(e.nivel, `n8n:${e.tipo}`.slice(0, 60), e.mensaje, e.datos ?? {});
    ok(res, { registrado: true }, 201);
  }),
);

// ---- Herramientas del asistente expuestas como API ----
const esquemaCotizacion = z.object({
  items: z.array(z.object({ producto_id: z.number().int().positive(), cantidad: z.number().int().positive().max(100) })).min(1).max(30),
  modalidad_entrega: z.enum(['recogida_tienda', 'envio']).optional().nullable(),
  ciudad: z.string().max(80).optional().nullable(),
  conversacion_id: z.string().uuid().optional().nullable(),
});

rutasIntegraciones.post(
  '/cotizaciones',
  firmaOStaff,
  h(async (req, res) => ok(res, await crearCotizacion(esquemaCotizacion.parse(req.body)), 201)),
);

// registrar_pedido(cliente, items, entrega). Acepta la clave en el encabezado Idempotency-Key.
rutasIntegraciones.post(
  '/pedidos',
  firmaOStaff,
  h(async (req, res) => {
    const clave = req.headers['idempotency-key'];
    const cuerpo = { ...req.body, clave_idempotencia: req.body?.clave_idempotencia ?? (typeof clave === 'string' ? clave : undefined) };
    const pedido = await registrarPedido(cuerpo);
    ok(res, pedido, pedido.idempotente ? 200 : 201);
  }),
);

// escalar_a_humano(motivo)
rutasIntegraciones.post(
  '/escalamientos',
  firmaOStaff,
  h(async (req, res) => ok(res, await escalarAHumano(req.body), 201)),
);
