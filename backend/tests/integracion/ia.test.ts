import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BetaMessage, MessageCreateParamsNonStreaming } from '@anthropic-ai/sdk/resources/beta/messages/messages';
import { pool } from '../../src/db';
import { config } from '../../src/config';
import { _usarClientePrueba, montosEnTexto } from '../../src/asistente/ia';
import { nuevoChat, reiniciarDatos } from '../helpers';

/**
 * Jaimes AI con un cliente FALSO de la API (sin red ni clave):
 * cada paso del guion recibe la solicitud y devuelve la respuesta del "modelo".
 */
type Paso = (p: MessageCreateParamsNonStreaming) => Partial<BetaMessage>;
let solicitudes: MessageCreateParamsNonStreaming[] = [];

function guion(...pasos: Paso[]) {
  solicitudes = [];
  let i = 0;
  _usarClientePrueba(async (params) => {
    solicitudes.push(structuredClone(params));
    const paso = pasos[i++];
    if (!paso) throw new Error('El guion no tiene más pasos');
    return {
      id: `msg_${i}`,
      type: 'message',
      role: 'assistant',
      model: 'claude-opus-5-5',
      stop_reason: 'end_turn',
      usage: { input_tokens: 1000, output_tokens: 50, cache_read_input_tokens: 800, cache_creation_input_tokens: 0 },
      content: [],
      ...paso(params),
    } as unknown as BetaMessage;
  });
}

const usar = (id: string, name: string, input: Record<string, unknown>) => ({ type: 'tool_use', id, name, input });
const texto = (t: string): Paso => () => ({ content: [{ type: 'text', text: t }] as never, stop_reason: 'end_turn' });
const herramienta = (...bloques: ReturnType<typeof usar>[]): Paso => () => ({ content: bloques as never, stop_reason: 'tool_use' });

/** Último resultado de herramienta que recibió el "modelo" (ya parseado). */
function ultimoResultado(p: MessageCreateParamsNonStreaming) {
  const m = p.messages[p.messages.length - 1];
  const bloques = m.content as { type: string; content: string; is_error?: boolean }[];
  const b = bloques.find((x) => x.type === 'tool_result')!;
  return { error: b.is_error === true, valor: b.is_error ? b.content : JSON.parse(b.content) };
}

const textos = (r: { respuestas: { texto: string }[] }) => r.respuestas.map((x) => x.texto).join('\n');

/** Guion típico: identifica la FZ 2.0 y busca pastillas delanteras 2018. */
const buscarPastillasFz = (): Paso[] => [
  herramienta(usar('t1', 'identificar_moto', { texto: 'fz 2.0' })),
  (p) => {
    const r = ultimoResultado(p).valor;
    return herramienta(usar('t2', 'buscar_productos', { repuesto: 'pastillas de freno', modelo_id: r.candidatos[0].modelo_id, anio: 2018, posicion: 'delantero', tipo: null, precio_max: null }))(p);
  },
];

beforeEach(reiniciarDatos);
afterEach(() => {
  _usarClientePrueba(null);
  config.IA_LIMITE_DIARIO_MENSAJES = 500;
});

describe('Jaimes AI', () => {
  it('sin clave de API el chat sigue con el motor de reglas y no registra uso de IA', async () => {
    const { id, enviar } = await nuevoChat();
    const r = await enviar('pastillas delanteras para fz 2.0 2018');
    expect(r.respuestas[0].tipo).toBe('productos');
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM mensajes WHERE conversacion_id = $1 AND metadata ? 'ia'`, [id]);
    expect(rows[0].n).toBe(0);
  });

  it('usa herramientas de solo lectura y arma las tarjetas con datos de la BD, no del texto del modelo', async () => {
    guion(...buscarPastillasFz(), texto('Tengo 2 opciones para tu FZ 2.0 2018: la original Yamaha y una genérica. ¿Cuál prefieres?'));
    const { id, enviar } = await nuevoChat();
    const r = await enviar('hola, necesito pastillas delanteras para mi fz 2.0 2018');

    expect(r.respuestas[0]).toMatchObject({ tipo: 'texto', texto: expect.stringMatching(/2 opciones/) });
    const tarjeta = r.respuestas[1];
    expect(tarjeta.tipo).toBe('productos');
    expect(tarjeta.datos.productos.map((p: { referencia: string }) => p.referencia)).toEqual(['DEMO-PF-FZ2-D-OR', 'DEMO-PF-FZ2-D-GN']);
    expect(tarjeta.texto).toMatch(/\$68\.000/);
    expect(tarjeta.texto).toMatch(/compatibilidad confirmada antes de instalarlo/); // advertencia de frenos
    expect(tarjeta.texto).toMatch(/datos de demostración ficticios/);
    expect(tarjeta.acciones?.[0].accion).toMatchObject({ tipo: 'agregar' });

    // La solicitud: herramientas estrictas, caché, esfuerzo, respaldo de servidor y nunca temperature
    const s = solicitudes[0] as unknown as Record<string, any>;
    expect(s.model).toBe('claude-opus-5-5');
    expect(s.cache_control).toEqual({ type: 'ephemeral' });
    expect(s.output_config).toEqual({ effort: 'low' });
    expect(s.fallbacks).toBe('default');
    expect(s.temperature).toBeUndefined();
    expect(s.tools.every((t: { strict: boolean; input_schema: { additionalProperties: boolean } }) => t.strict && t.input_schema.additionalProperties === false)).toBe(true);
    expect(JSON.stringify(s.messages)).toContain('<estado>');

    // Uso de tokens guardado una vez por turno
    const { rows } = await pool.query(`SELECT metadata->'ia' AS ia FROM mensajes WHERE conversacion_id = $1 AND metadata ? 'ia'`, [id]);
    expect(rows).toHaveLength(1);
    expect(rows[0].ia).toMatchObject({ modelo: 'claude-opus-5-5', uso: { entrada: 3000, salida: 150, cache_lectura: 2400 }, llamadas_api: 3 });

    // El contexto queda con la moto: el siguiente botón "agregar" funciona con el motor
    const add = await enviar({ accion: tarjeta.acciones![0].accion });
    expect(textos(add)).toMatch(/agregué Pastillas de freno delanteras \(DEMO-PF-FZ2-D-OR\)/);
  });

  it('bloquea un precio inventado: reemplaza el texto y registra ia_cifra_no_verificada', async () => {
    guion(...buscarPastillasFz(), texto('La original te sale en $60.000, ¡súper precio!'));
    const { enviar } = await nuevoChat();
    const r = await enviar('pastillas para la fz 2.0 2018');
    expect(textos(r)).not.toMatch(/60\.000/);
    expect(r.respuestas[0].texto).toMatch(/precio confirmado en nuestro inventario/);
    expect(r.respuestas[1].tipo).toBe('productos');
    const { rows } = await pool.query(`SELECT datos FROM registros_eventos WHERE tipo = 'ia_cifra_no_verificada'`);
    expect(rows).toHaveLength(1);
    expect(rows[0].datos.montos).toEqual(['$60.000']);
  });

  it('acepta precios que sí devolvieron las herramientas', async () => {
    guion(...buscarPastillasFz(), texto('La original Yamaha vale $68.000 y la genérica 32.000 pesos.'));
    const { enviar } = await nuevoChat();
    const r = await enviar('pastillas para la fz 2.0 2018');
    expect(r.respuestas[0].texto).toMatch(/\$68\.000/);
  });

  it('agregar_al_carrito solo funciona con un producto mostrado en una búsqueda por moto', async () => {
    let rechazo = '';
    guion(
      herramienta(usar('t1', 'agregar_al_carrito', { producto_id: 1, cantidad: 1 })),
      (p) => {
        rechazo = ultimoResultado(p).valor;
        return texto('Primero dime el modelo y el año de tu moto.')(p);
      },
    );
    const { enviar } = await nuevoChat();
    const r = await enviar('agrégame unas pastillas');
    expect(rechazo).toMatch(/no salió en una búsqueda por moto/);
    expect(r.respuestas).toHaveLength(1);
  });

  it('agrega al carrito a través del motor (valida stock y precio) cuando el cliente lo pide', async () => {
    let productoId = 0;
    guion(
      ...buscarPastillasFz(),
      (p) => {
        productoId = ultimoResultado(p).valor.productos[0].producto_id;
        return herramienta(usar('t3', 'agregar_al_carrito', { producto_id: productoId, cantidad: 2 }))(p);
      },
      texto('Listo, te la agrego.'),
    );
    const { id, enviar } = await nuevoChat();
    const r = await enviar('agrégame las originales para mi fz 2.0 2018, dos juegos');
    expect(textos(r)).toMatch(/agregué Pastillas de freno delanteras \(DEMO-PF-FZ2-D-OR\) x2/);
    const { rows } = await pool.query('SELECT contexto FROM conversaciones WHERE id = $1', [id]);
    expect(rows[0].contexto.carrito).toEqual([{ producto_id: productoId, cantidad: 2 }]);
  });

  it('solicitar_asesor crea la transferencia con el servicio de siempre', async () => {
    guion(herramienta(usar('t1', 'solicitar_asesor', { motivo: 'Pregunta por garantía' })), texto('Te paso con un asesor.'));
    const { id, enviar } = await nuevoChat();
    const r = await enviar('quiero saber de la garantía de un repuesto que compré');
    expect(r.respuestas.some((x) => x.tipo === 'escalado')).toBe(true);
    const { rows } = await pool.query('SELECT count(*)::int AS n FROM transferencias_atencion WHERE conversacion_id = $1', [id]);
    expect(rows[0].n).toBe(1);
  });

  it('si la API falla, responde el motor de reglas y queda el evento ia_error', async () => {
    _usarClientePrueba(async () => {
      throw new Error('sin conexión');
    });
    const { enviar } = await nuevoChat();
    const r = await enviar('pastillas delanteras para fz 2.0 2018');
    expect(r.respuestas[0].tipo).toBe('productos');
    expect(textos(r)).toMatch(/Encontré 2 opciones/); // texto del motor
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM registros_eventos WHERE tipo = 'ia_error'`);
    expect(rows[0].n).toBe(1);
  });

  it('si el modelo rechaza, responde el motor de reglas', async () => {
    guion(() => ({ content: [] as never, stop_reason: 'refusal' }));
    const { enviar } = await nuevoChat();
    const r = await enviar('hola');
    expect(r.respuestas.length).toBeGreaterThan(0);
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM registros_eventos WHERE tipo = 'ia_rechazo'`);
    expect(rows[0].n).toBe(1);
  });

  it('respeta el máximo de herramientas por mensaje', async () => {
    const pasos: Paso[] = Array.from({ length: 7 }, (_, i) => herramienta(usar(`t${i}`, 'info_negocio', {})));
    let ultimo: { error: boolean; valor: unknown } | null = null;
    guion(...pasos, (p) => {
      ultimo = ultimoResultado(p);
      return texto('Nuestro horario está en la página.')(p);
    });
    const { enviar } = await nuevoChat();
    await enviar('¿cuál es el horario?');
    expect(ultimo).toMatchObject({ error: true, valor: expect.stringMatching(/Límite de consultas/) });
  });

  it('con el tope diario alcanzado no llama a la API', async () => {
    config.IA_LIMITE_DIARIO_MENSAJES = 0;
    guion(texto('no debería llamarse'));
    const { enviar } = await nuevoChat();
    await enviar('pastillas delanteras para fz 2.0 2018');
    expect(solicitudes).toHaveLength(0);
  });

  it('los botones y los datos de entrega siguen siendo deterministas', async () => {
    guion(texto('no debería llamarse'));
    const { enviar } = await nuevoChat();
    await enviar({ accion: { tipo: 'ver_carrito' } });
    expect(solicitudes).toHaveLength(0);
  });

  it('nunca manda a la API un mensaje que parece tarjeta', async () => {
    guion(texto('no debería llamarse'));
    const { enviar } = await nuevoChat();
    const r = await enviar('mi tarjeta es 4111 1111 1111 1111');
    expect(solicitudes).toHaveLength(0);
    expect(textos(r)).toMatch(/no compartas números de tarjeta/);
  });

  it('envía el historial anterior en texto, empezando por el cliente', async () => {
    guion(texto('¿De qué año es tu moto?'), texto('Listo.'));
    const { enviar } = await nuevoChat();
    await enviar('necesito un filtro para la fz');
    await enviar('es 2019');
    const msgs = solicitudes[1].messages;
    expect(msgs[0].role).toBe('user');
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant', 'user']);
    expect(String(msgs[1].content)).toMatch(/De qué año/);
  });
});

describe('montosEnTexto', () => {
  it('encuentra montos en pesos escritos de varias formas', () => {
    expect(montosEnTexto('Vale $68.000 o 32.000 pesos, unos 15 mil')).toEqual([68000, 32000, 15000]);
    expect(montosEnTexto('Tu FZ 2018 tiene 5 mil km')).toEqual([]);
  });
});
