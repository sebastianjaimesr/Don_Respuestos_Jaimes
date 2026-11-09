import type { BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { config } from '../../config';
import { pool } from '../../db';
import { ADVERTENCIA_SEGURIDAD, asegurarCategorias } from '../../modulos/catalogo/categorias';
import { registrarEvento } from '../../modulos/eventos/servicio';
import { obtenerProductoVenta } from '../../modulos/catalogo/servicio';
import { formatoCOP } from '../../utils/dinero';
import { pareceTarjeta } from '../extraccion';
import { EntradaMotor, formatoProducto, procesar, SalidaMotor, vendibilidad } from '../motor';
import type { BotonAccion, Contexto, Respuesta } from '../tipos';
import { crearMensajeAnthropic, CrearMensaje, ejecutarAgente, UsoTokens } from './agente';
import { EstadoTurno, nuevoEstadoTurno } from './herramientas';

/**
 * Punto de entrada de Jaimes AI.
 *
 * Devuelve `null` cuando el mensaje lo debe atender el motor de reglas:
 * no hay clave, es un botón, el cliente está dando datos de entrega o
 * confirmando, se superó el tope diario, o la API falló o rechazó.
 * Así el chat nunca se queda sin respuesta por culpa de la IA.
 */

export interface MetadatosIA {
  modelo: string;
  uso: UsoTokens;
  llamadas_api: number;
  herramientas: { nombre: string; ok: boolean }[];
  cifra_no_verificada?: true;
}

export type SalidaIA = SalidaMotor & { ia: MetadatosIA };

let crearPrueba: CrearMensaje | null = null;
/** Solo para pruebas: reemplaza la API por un cliente falso (sin red). `null` lo quita. */
export function _usarClientePrueba(c: CrearMensaje | null) {
  crearPrueba = c;
}

const iaDisponible = () => Boolean(crearPrueba || config.ANTHROPIC_API_KEY);

async function mensajesIAHoy(): Promise<number> {
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM mensajes
     WHERE rol = 'asistente' AND metadata ? 'ia'
       AND created_at >= (date_trunc('day', now() AT TIME ZONE 'America/Bogota') AT TIME ZONE 'America/Bogota')`,
  );
  return rows[0].n;
}

const MAX_HISTORIAL = 16;

/** Historial en texto (cliente ↔ asistente) de esta conversación, sin el mensaje actual. */
async function historialTexto(conversacionId: string): Promise<BetaMessageParam[]> {
  const { rows } = await pool.query(
    `SELECT rol, contenido FROM mensajes WHERE conversacion_id = $1 AND rol IN ('cliente', 'asistente', 'asesor')
     ORDER BY id DESC LIMIT $2`,
    [conversacionId, MAX_HISTORIAL + 1],
  );
  const filas = rows.reverse().slice(0, -1); // el último es el mensaje que estamos atendiendo
  const salida: BetaMessageParam[] = [];
  for (const f of filas) {
    const role = f.rol === 'cliente' ? 'user' : 'assistant';
    const texto = String(f.contenido).slice(0, 1500);
    const ultimo = salida[salida.length - 1];
    if (ultimo && ultimo.role === role) ultimo.content = `${ultimo.content}\n\n${texto}`;
    else salida.push({ role, content: texto });
  }
  while (salida.length && salida[0].role !== 'user') salida.shift(); // la API exige empezar por el usuario
  return salida;
}

/** Lo que el modelo necesita saber del contexto guardado (moto, búsqueda en curso y carrito). */
async function bloqueEstado(ctx: Contexto, t: EstadoTurno): Promise<string> {
  const carrito = [];
  for (const i of ctx.carrito.slice(0, 20)) {
    const p = await obtenerProductoVenta(i.producto_id);
    if (p) carrito.push({ producto_id: i.producto_id, referencia: p.referencia, nombre: p.nombre, cantidad: i.cantidad, precio_unitario: p.precio });
  }
  const estado = {
    moto: ctx.moto.modelo_id ? { modelo_id: ctx.moto.modelo_id, nombre: ctx.moto.modelo, anio: ctx.moto.anio ?? null } : null,
    repuesto_en_curso: ctx.consulta.categoria ?? null,
    productos_mostrados: ctx.ultimos_resultados,
    carrito,
    subtotal_carrito: carrito.reduce((a, c) => a + (c.precio_unitario ? Number(c.precio_unitario) * c.cantidad : 0), 0),
  };
  // Las cifras del carrito también son citables.
  for (const c of carrito) if (c.precio_unitario) t.cifras.add(Math.round(Number(c.precio_unitario)));
  t.cifras.add(Math.round(estado.subtotal_carrito));
  return `<estado>${JSON.stringify(estado)}</estado>`;
}

/** Montos en pesos que aparecen en el texto: "$68.000", "68.000 pesos", "68 mil". */
export function montosEnTexto(texto: string): number[] {
  const montos: number[] = [];
  const aNumero = (s: string) => Number(s.replace(/\./g, ''));
  for (const m of texto.matchAll(/\$\s?(\d{1,3}(?:\.\d{3})+|\d+)(?:,\d{1,2})?/g)) montos.push(aNumero(m[1]));
  for (const m of texto.matchAll(/(?<![$\d.])(\d{1,3}(?:\.\d{3})+|\d{4,})\s*(?:pesos|cop)\b/gi)) montos.push(aNumero(m[1]));
  for (const m of texto.matchAll(/(?<![$\d.])(\d{1,4})\s*mil\b(?!\s*(?:km|kil|kms)\b)/gi)) montos.push(Number(m[1]) * 1000);
  return montos;
}

/** Tarjetas armadas con datos de la BD (nunca con el texto del modelo). Mismo formato que el motor. */
function tarjetas(t: EstadoTurno): Respuesta | null {
  if (!t.busqueda?.productos.length) return null;
  const { productos, modelo, anio } = t.busqueda;
  const varios = productos.length > 1;
  const notas: string[] = [];
  if (productos.some((p) => p.advertencia_seguridad)) notas.push(ADVERTENCIA_SEGURIDAD);
  if (productos.some((p) => p.es_demo)) notas.push('ℹ️ Estos son datos de demostración ficticios, no inventario real.');
  const vendibles = productos.filter((p) => vendibilidad(p).vendible);
  const acciones: BotonAccion[] = vendibles.map((p) => ({
    etiqueta: varios ? `Agregar opción ${productos.indexOf(p) + 1}` : 'Agregar al pedido',
    accion: { tipo: 'agregar', producto_id: p.producto_id, cantidad: 1 },
  }));
  if (vendibles.length < productos.length) acciones.push({ etiqueta: 'Hablar con un asesor', accion: { tipo: 'escalar' } });
  return {
    tipo: 'productos',
    texto: [...productos.map((p, i) => formatoProducto(p, varios ? i + 1 : null)), ...notas].join('\n\n'),
    datos: { modelo, anio, productos: productos.map((p) => ({ ...p, ...vendibilidad(p) })) },
    acciones,
  };
}

export async function intentarIA(entrada: EntradaMotor): Promise<SalidaIA | null> {
  if (!iaDisponible()) return null;
  if (entrada.accion || entrada.texto === undefined || !entrada.texto.trim()) return null;
  if (entrada.contexto.etapa !== 'consulta') return null; // datos de entrega y confirmación: flujo determinista
  if (pareceTarjeta(entrada.texto)) return null; // el motor responde con el aviso de seguridad
  if ((await mensajesIAHoy()) >= config.IA_LIMITE_DIARIO_MENSAJES) {
    void registrarEvento('aviso', 'ia_limite_diario', 'Se alcanzó el tope diario de mensajes con IA; responde el motor de reglas', {
      limite: config.IA_LIMITE_DIARIO_MENSAJES,
    });
    return null;
  }

  const ctx: Contexto = structuredClone(entrada.contexto);
  const turno = nuevoEstadoTurno(ctx);
  try {
    await asegurarCategorias();
    const historial = await historialTexto(entrada.conversacionId);
    historial.push({ role: 'user', content: `${await bloqueEstado(ctx, turno)}\n\nMensaje del cliente: ${entrada.texto.slice(0, 2000)}` });
    if (historial.length >= 2 && historial[historial.length - 2].role === 'user') {
      // Dos turnos seguidos del usuario (por ejemplo, el asistente no respondió por un asesor): se unen.
      const actual = historial.pop()!;
      const previo = historial[historial.length - 1];
      previo.content = `${previo.content}\n\n${actual.content}`;
    }

    const r = await ejecutarAgente(historial, turno, {
      modelo: config.IA_MODELO,
      esfuerzo: config.IA_ESFUERZO,
      maxHerramientas: config.IA_MAX_HERRAMIENTAS,
      crear: crearPrueba ?? crearMensajeAnthropic(config.ANTHROPIC_API_KEY!),
    });
    const ia: MetadatosIA = { modelo: r.modelo, uso: r.uso, llamadas_api: r.llamadas_api, herramientas: turno.llamadas };

    if (r.tipo !== 'texto') {
      void registrarEvento('aviso', r.tipo === 'rechazo' ? 'ia_rechazo' : 'ia_incompleta', 'La IA no completó la respuesta; responde el motor de reglas', {
        conversacion_id: entrada.conversacionId,
        detalle: r.detalle,
        modelo: r.modelo,
      });
      return null;
    }

    const respuestas: Respuesta[] = [];
    const tarjeta = tarjetas(turno);
    let texto = r.texto;
    const noVerificados = montosEnTexto(texto).filter((m) => !turno.cifras.has(m));
    if (noVerificados.length) {
      ia.cifra_no_verificada = true;
      void registrarEvento('aviso', 'ia_cifra_no_verificada', 'La IA escribió un monto que no salió de las herramientas; se reemplazó el texto', {
        conversacion_id: entrada.conversacionId,
        montos: noVerificados.map((m) => formatoCOP(m)),
      });
      texto = tarjeta
        ? 'Te comparto las opciones con el precio confirmado en nuestro inventario:'
        : 'Ese valor no lo tengo confirmado en el sistema. Si quieres, un asesor te lo confirma.';
      if (!tarjeta) {
        respuestas.push({ tipo: 'texto', texto, acciones: [{ etiqueta: 'Hablar con un asesor', accion: { tipo: 'escalar' } }] });
        texto = '';
      }
    }
    if (texto) respuestas.push({ tipo: 'texto', texto });
    if (tarjeta) respuestas.push(tarjeta);

    // Acciones acotadas: las ejecuta el motor con sus validaciones de siempre.
    let ctxFinal = ctx;
    let clienteId: number | null | undefined = null;
    for (const accion of turno.acciones) {
      const m = await procesar({ ...entrada, contexto: ctxFinal, texto: undefined, accion });
      respuestas.push(...m.respuestas);
      ctxFinal = m.contexto;
      clienteId = m.clienteId ?? clienteId;
    }
    if (!respuestas.length) return null;
    ctxFinal.no_entendidos = 0;
    ctxFinal.saludado = true;
    return { respuestas, contexto: ctxFinal, clienteId, ia };
  } catch (e) {
    void registrarEvento('error', 'ia_error', 'Falló la llamada a la IA; responde el motor de reglas', {
      conversacion_id: entrada.conversacionId,
      error: (e as Error).message?.slice(0, 300),
      clase: (e as Error).constructor?.name,
    });
    return null;
  }
}
