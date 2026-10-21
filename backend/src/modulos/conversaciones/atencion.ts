import { pool } from '../../db';
import { procesar, SALUDO } from '../../asistente/motor';
import type { AccionEntrada, Respuesta } from '../../asistente/tipos';
import { pareceTarjeta } from '../../asistente/extraccion';
import { asesorAtendiendo, Conversacion, guardarContexto, guardarMensaje, obtenerConversacion } from './servicio';

export interface ResultadoAtencion {
  conversacion_id: string;
  estado: Conversacion['estado'];
  asesor_atendiendo: boolean;
  respuestas: (Respuesta & { mensaje_id: number })[];
  /** Todas las respuestas unidas en texto plano (para WhatsApp/Telegram) */
  texto_respuesta: string;
}

/**
 * Atiende un mensaje entrante (de cualquier canal):
 * guarda el mensaje, ejecuta el motor y guarda las respuestas.
 * Un candado por conversación (advisory lock) evita que dos mensajes
 * simultáneos del mismo cliente pisen el contexto.
 */
export async function atenderMensaje(conv: Conversacion, entrada: { texto?: string; accion?: AccionEntrada; etiquetaAccion?: string }): Promise<ResultadoAtencion> {
  const candado = await pool.connect();
  try {
    await candado.query('SELECT pg_advisory_lock(hashtext($1))', [conv.id]);
    const actual = (await obtenerConversacion(conv.id)) ?? conv;

    if (entrada.texto !== undefined) {
      // Nunca guardamos algo que parezca un número de tarjeta
      const contenido = pareceTarjeta(entrada.texto) ? '[mensaje oculto: posible dato de tarjeta]' : entrada.texto;
      await guardarMensaje(actual.id, 'cliente', contenido);
    } else if (entrada.accion) {
      await guardarMensaje(actual.id, 'cliente', entrada.etiquetaAccion ?? `[${entrada.accion.tipo}]`, { accion: entrada.accion });
    }

    // Si un asesor tomó la conversación, el asistente no responde.
    if (actual.estado === 'escalada' && (await asesorAtendiendo(actual.id))) {
      return { conversacion_id: actual.id, estado: actual.estado, asesor_atendiendo: true, respuestas: [], texto_respuesta: '' };
    }

    const r = await procesar({
      conversacionId: actual.id,
      estadoConversacion: actual.estado,
      contexto: actual.contexto,
      texto: entrada.texto,
      accion: entrada.accion,
    });
    const guardadas = [];
    for (const resp of r.respuestas) {
      const m = await guardarMensaje(actual.id, 'asistente', resp.texto, { tipo: resp.tipo, datos: resp.datos ?? null, acciones: resp.acciones ?? [] });
      guardadas.push({ ...resp, mensaje_id: m.id as number });
    }
    await guardarContexto(actual.id, r.contexto, r.clienteId);
    const final = await obtenerConversacion(actual.id);
    return {
      conversacion_id: actual.id,
      estado: final?.estado ?? actual.estado,
      asesor_atendiendo: false,
      respuestas: guardadas,
      texto_respuesta: guardadas.map((g) => g.texto).join('\n\n'),
    };
  } finally {
    await candado.query('SELECT pg_advisory_unlock(hashtext($1))', [conv.id]).catch(() => undefined);
    candado.release();
  }
}

/** Mensaje de bienvenida al abrir una conversación nueva. */
export async function saludar(conv: Conversacion) {
  const m = await guardarMensaje(conv.id, 'asistente', SALUDO, { tipo: 'texto' });
  await guardarContexto(conv.id, { ...conv.contexto, saludado: true });
  return { tipo: 'texto' as const, texto: SALUDO, mensaje_id: m.id as number };
}
