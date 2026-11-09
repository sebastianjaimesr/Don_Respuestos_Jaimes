import Anthropic from '@anthropic-ai/sdk';
import type { BetaMessage, BetaMessageParam, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { DEFINICIONES, ejecutarHerramienta, ErrorHerramienta, EstadoTurno } from './herramientas';

/**
 * Bucle de Jaimes AI con la API de Claude (docs/ARQUITECTURA.md § 6).
 * Este archivo solo habla con la API y ejecuta herramientas; las decisiones
 * de negocio (qué se muestra, qué se agrega al carrito) viven en ./index.ts.
 */

export type CrearMensaje = (params: MessageCreateParamsNonStreaming) => Promise<BetaMessage>;

export interface OpcionesAgente {
  modelo: string;
  esfuerzo: 'low' | 'medium' | 'high';
  maxHerramientas: number;
  crear: CrearMensaje;
}

export interface UsoTokens {
  entrada: number;
  salida: number;
  cache_lectura: number;
  cache_escritura: number;
}

export type ResultadoAgente =
  | { tipo: 'texto'; texto: string; modelo: string; uso: UsoTokens; llamadas_api: number }
  | { tipo: 'rechazo' | 'incompleto'; modelo: string; uso: UsoTokens; llamadas_api: number; detalle: string };

export const SISTEMA = `Eres Jaimes AI, el asesor de ventas por chat de Don Repuestos Jaimes, una tienda colombiana de repuestos para motos de varias marcas (Yamaha, Honda, Suzuki, Bajaj, AKT, TVS, Hero, Kawasaki, KTM, BMW, Kymco, Royal Enfield, Victory, entre otras).

Cómo hablas:
- Español de Colombia, tono cercano y respetuoso, respuestas cortas (2 a 4 frases). Tutea al cliente.
- Sin markdown: nada de asteriscos, títulos ni tablas. El mensaje puede llegar por WhatsApp.

Reglas de datos (no negociables):
- Precios, stock, referencias, compatibilidades, descuentos, marcas y especificaciones salen SOLO de resultados de herramientas de este turno. Nunca los inventes, redondees ni estimes. Si no hay dato, dilo y ofrece un asesor.
- Antes de recomendar un repuesto necesitas el modelo y el año de la moto. Si faltan, pregúntalos (uno o dos datos a la vez). No vuelvas a pedir lo que ya está en el bloque <estado>.
- Usa identificar_moto para pasar del nombre de la moto a su modelo_id, y luego buscar_productos con modelo_id y anio. Si identificar_moto devuelve varios candidatos, pregunta cuál es.
- Una búsqueda sin moto no confirma compatibilidad: dilo así y pide modelo y año.
- Cuando buscar_productos con moto devuelve productos, el cliente los verá como tarjetas con nombre, referencia, precio y stock. No repitas la lista completa: resume en una frase (por ejemplo, cuántas opciones hay y la diferencia entre original y genérico) y pregunta cuál quiere.
- Si un producto tiene vendible=false, explica la razón (compatibilidad sin verificar, precio sin confirmar o agotado) y ofrece un asesor.
- Si el producto es de frenos, dirección o llantas (advertencia_seguridad=true), recuerda que debe tener la compatibilidad confirmada antes de instalarlo.
- Si un producto tiene es_demo=true, aclara que son datos de demostración.
- No des intervalos de mantenimiento en kilómetros: el negocio no los ha registrado.

Lo que no puedes hacer:
- No confirmes pedidos, no marques pagos, no cambies precios ni inventario. Para hacer el pedido, el cliente usa el botón "Hacer pedido" o escribe "hacer pedido".
- No pidas ni aceptes números de tarjeta, claves ni códigos.
- Solo usa agregar_al_carrito cuando el cliente pida agregar un producto que salió con vendible=true.
- Usa solicitar_asesor si el cliente lo pide, está molesto, o hace falta confirmar algo que no está en las herramientas.
- Si te preguntan algo que no tiene que ver con repuestos de motos o con la tienda, dilo con amabilidad y vuelve al tema.`;

const usoVacio = (): UsoTokens => ({ entrada: 0, salida: 0, cache_lectura: 0, cache_escritura: 0 });

let clienteAnthropic: Anthropic | null = null;
/** Cliente real, creado solo cuando hace falta. La clave vive en el backend y nunca se envía al navegador. */
export function crearMensajeAnthropic(apiKey: string): CrearMensaje {
  return (params) => {
    clienteAnthropic ??= new Anthropic({ apiKey, maxRetries: 2, timeout: 45_000 });
    return clienteAnthropic.beta.messages.create(params);
  };
}

export async function ejecutarAgente(
  historial: BetaMessageParam[],
  turno: EstadoTurno,
  op: OpcionesAgente,
): Promise<ResultadoAgente> {
  const mensajes: BetaMessageParam[] = [...historial];
  const uso = usoVacio();
  let modelo = op.modelo;
  let herramientasUsadas = 0;
  // Margen: una llamada más que herramientas para que el modelo cierre con texto.
  const maxLlamadas = op.maxHerramientas + 2;

  for (let llamada = 1; llamada <= maxLlamadas; llamada++) {
    const r = await op.crear({
      model: op.modelo,
      max_tokens: 2048,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      thinking: { type: 'adaptive' },
      output_config: { effort: op.esfuerzo },
      // Caché automática: sistema y herramientas (estables) + el historial que ya se envió.
      cache_control: { type: 'ephemeral' },
      system: SISTEMA,
      tools: DEFINICIONES as unknown as MessageCreateParamsNonStreaming['tools'],
      tool_choice: { type: 'auto' },
      messages: mensajes,
    });
    modelo = r.model ?? modelo;
    uso.entrada += r.usage?.input_tokens ?? 0;
    uso.salida += r.usage?.output_tokens ?? 0;
    uso.cache_lectura += r.usage?.cache_read_input_tokens ?? 0;
    uso.cache_escritura += r.usage?.cache_creation_input_tokens ?? 0;

    if (r.stop_reason === 'refusal') return { tipo: 'rechazo', modelo, uso, llamadas_api: llamada, detalle: 'refusal' };

    if (r.stop_reason === 'tool_use') {
      // El turno del asistente va completo (incluidos los bloques de razonamiento).
      mensajes.push({ role: 'assistant', content: r.content } as unknown as BetaMessageParam);
      const resultados = [];
      for (const b of r.content) {
        if (b.type !== 'tool_use') continue;
        herramientasUsadas += 1;
        if (herramientasUsadas > op.maxHerramientas) {
          turno.llamadas.push({ nombre: b.name, ok: false });
          resultados.push({ type: 'tool_result' as const, tool_use_id: b.id, is_error: true, content: 'Límite de consultas de este mensaje alcanzado. Responde con lo que ya tienes u ofrece un asesor.' });
          continue;
        }
        try {
          const salida = await ejecutarHerramienta(b.name, b.input, turno);
          turno.llamadas.push({ nombre: b.name, ok: true });
          resultados.push({ type: 'tool_result' as const, tool_use_id: b.id, content: JSON.stringify(salida) });
        } catch (e) {
          turno.llamadas.push({ nombre: b.name, ok: false });
          const msg = e instanceof ErrorHerramienta ? e.message : 'Error consultando la base de datos. No inventes el dato: ofrece un asesor.';
          resultados.push({ type: 'tool_result' as const, tool_use_id: b.id, is_error: true, content: msg });
        }
      }
      // Todos los resultados van juntos en un solo mensaje del usuario.
      mensajes.push({ role: 'user', content: resultados });
      continue;
    }

    if (r.stop_reason === 'end_turn' || r.stop_reason === 'stop_sequence') {
      const texto = r.content
        .filter((b) => b.type === 'text')
        .map((b) => (b as { text: string }).text)
        .join('\n')
        .trim();
      return { tipo: 'texto', texto, modelo, uso, llamadas_api: llamada };
    }

    return { tipo: 'incompleto', modelo, uso, llamadas_api: llamada, detalle: String(r.stop_reason) };
  }
  return { tipo: 'incompleto', modelo, uso, llamadas_api: maxLlamadas, detalle: 'demasiadas_llamadas' };
}
