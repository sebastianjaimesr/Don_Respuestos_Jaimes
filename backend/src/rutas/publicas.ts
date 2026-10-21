import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { config } from '../config';
import { h, ok } from '../utils/http';
import { esquemaMensajeEntrante } from '../asistente/esquemas';
import { atenderMensaje, saludar } from '../modulos/conversaciones/atencion';
import { listarMensajes, obtenerConversacion, obtenerOCrear } from '../modulos/conversaciones/servicio';
import { buscarRepuesto, compatibilidadesPorReferencia, compatiblesConModelo, disponibilidadPorReferencia, listarModelos } from '../modulos/catalogo/servicio';
import { CATEGORIAS } from '../modulos/catalogo/categorias';
import { informacionPublica } from '../modulos/negocio/servicio';
import { obtenerCotizacion } from '../modulos/cotizaciones/servicio';
import { seguimientoPedido } from '../modulos/pedidos/servicio';
import { AppError } from '../errores';

export const rutasPublicas = Router();

const limiteChat = rateLimit({
  windowMs: 60_000,
  limit: config.RATE_LIMIT_CHAT_POR_MINUTO,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  message: { ok: false, error: { codigo: 'DEMASIADAS_SOLICITUDES', mensaje: 'Estás enviando mensajes muy rápido. Espera un momento.' } },
});
const limiteSeguimiento = rateLimit({ windowMs: 15 * 60_000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });

// ---------------- Chat web ----------------
rutasPublicas.post(
  '/chat/conversaciones',
  limiteChat,
  h(async (_req, res) => {
    const conv = await obtenerOCrear({ canal: 'web' });
    const saludo = await saludar(conv);
    ok(res, { conversacion_id: conv.id, estado: conv.estado, respuestas: [saludo] }, 201);
  }),
);

rutasPublicas.post(
  '/chat/conversaciones/:id/mensajes',
  limiteChat,
  h(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const cuerpo = esquemaMensajeEntrante.parse(req.body);
    const conv = await obtenerOCrear({ id, canal: 'web' });
    if (conv.estado === 'cerrada') throw new AppError(409, 'CONVERSACION_CERRADA', 'Esta conversación está cerrada; inicia una nueva.');
    ok(res, await atenderMensaje(conv, { texto: cuerpo.texto, accion: cuerpo.accion, etiquetaAccion: cuerpo.etiqueta_accion }));
  }),
);

// Mensajes nuevos (el chat web consulta periódicamente cuando un asesor está atendiendo)
rutasPublicas.get(
  '/chat/conversaciones/:id/mensajes',
  h(async (req, res) => {
    const id = z.string().uuid().parse(req.params.id);
    const despues = z.coerce.number().int().min(0).default(0).parse(req.query.despues);
    const conv = await obtenerConversacion(id);
    if (!conv || conv.canal !== 'web') throw new AppError(404, 'CONVERSACION_NO_ENCONTRADA', 'La conversación no existe');
    const mensajes = await listarMensajes(id, despues);
    ok(res, { estado: conv.estado, mensajes });
  }),
);

// ---------------- Catálogo (herramienta buscar_repuesto) ----------------
rutasPublicas.get(
  '/repuestos/buscar',
  h(async (req, res) => {
    const q = z
      .object({
        modelo: z.string().trim().min(1).max(60),
        anio: z.coerce.number().int(),
        repuesto: z.string().trim().min(2).max(80),
        posicion: z.enum(['delantero', 'trasero']).optional(),
        tipo: z.enum(['original', 'generico']).optional(),
      })
      .parse(req.query);
    ok(res, await buscarRepuesto(q));
  }),
);

rutasPublicas.get(
  '/compatibilidades',
  h(async (req, res) => {
    const q = z
      .object({ referencia: z.string().max(60).optional(), modelo_id: z.coerce.number().int().positive().optional(), anio: z.coerce.number().int().optional() })
      .refine((d) => d.referencia || (d.modelo_id && d.anio), 'Envía referencia, o modelo_id y anio')
      .parse(req.query);
    ok(res, q.referencia ? await compatibilidadesPorReferencia(q.referencia) : await compatiblesConModelo(q.modelo_id!, q.anio!));
  }),
);

rutasPublicas.get(
  '/disponibilidad/:referencia',
  h(async (req, res) => ok(res, await disponibilidadPorReferencia(z.string().max(60).parse(req.params.referencia)))),
);

rutasPublicas.get('/modelos', h(async (_req, res) => ok(res, (await listarModelos()).map(({ id, nombre }) => ({ id, nombre })))));
rutasPublicas.get('/categorias', h(async (_req, res) => ok(res, CATEGORIAS.map(({ clave, etiqueta, requierePosicion, seguridad }) => ({ clave, etiqueta, requierePosicion, seguridad })))));
rutasPublicas.get('/negocio', h(async (_req, res) => ok(res, await informacionPublica())));

rutasPublicas.get(
  '/cotizaciones/:codigo',
  h(async (req, res) => {
    const c = await obtenerCotizacion(z.string().max(20).parse(req.params.codigo));
    const { conversacion_id: _omit, id: _id, ...publica } = c;
    ok(res, publica);
  }),
);

rutasPublicas.get(
  '/pedidos/seguimiento',
  limiteSeguimiento,
  h(async (req, res) => {
    const q = z.object({ codigo: z.string().min(5).max(20), telefono: z.string().min(7).max(20) }).parse(req.query);
    ok(res, await seguimientoPedido(q.codigo, q.telefono));
  }),
);
