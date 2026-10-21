import { AMBIGUOS, CATEGORIAS } from '../modulos/catalogo/categorias';
import { contieneFrase, normalizar } from '../utils/texto';

/**
 * Extracción de datos del texto del cliente. Todo es determinista (reglas),
 * así que es fácil de probar y nunca "inventa" información.
 */

export type ResultadoCategoria =
  | { tipo: 'encontrada'; clave: string }
  | { tipo: 'ambigua'; opciones: string[]; pregunta: string }
  | { tipo: 'ninguna' };

export function detectarCategoria(texto: string): ResultadoCategoria {
  const t = normalizar(texto);
  // Si el texto ya es una clave interna (ej. "filtro_aceite")
  const directa = CATEGORIAS.find((c) => c.clave === texto.trim());
  if (directa) return { tipo: 'encontrada', clave: directa.clave };

  let mejor: { clave: string; largo: number } | null = null;
  for (const c of CATEGORIAS) {
    for (const s of c.sinonimos) {
      if (contieneFrase(t, s) && (!mejor || s.length > mejor.largo)) mejor = { clave: c.clave, largo: s.length };
    }
  }
  if (mejor) return { tipo: 'encontrada', clave: mejor.clave };
  for (const a of AMBIGUOS) {
    if (contieneFrase(t, a.palabra)) return { tipo: 'ambigua', opciones: a.opciones, pregunta: a.pregunta };
  }
  return { tipo: 'ninguna' };
}

export function detectarPosicion(texto: string): 'delantero' | 'trasero' | null {
  const t = normalizar(texto);
  if (/\b(delanter[oa]s?|de adelante|adelante|frontal(es)?)\b/.test(t)) return 'delantero';
  if (/\b(traser[oa]s?|de atras|atras|posterior(es)?)\b/.test(t)) return 'trasero';
  return null;
}

export function detectarTipo(texto: string): 'original' | 'generico' | 'cualquiera' | null {
  const t = normalizar(texto);
  if (/\b(cualquiera|me da igual|ambos|las dos|los dos|lo que haya)\b/.test(t)) return 'cualquiera';
  if (/\b(no original(es)?|generic[oa]s?|alternativ[oa]s?|replica|economic[oa]s?|mas barat[oa]s?)\b/.test(t)) return 'generico';
  if (/\b(original(es)?|de marca yamaha|legitim[oa]s?)\b/.test(t)) return 'original';
  return null;
}

/** Año de 4 dígitos razonable para una moto (1980 … año actual + 1). */
export function detectarAnio(texto: string, ahora = new Date()): number | null {
  const max = ahora.getFullYear() + 1;
  const m = normalizar(texto).match(/\b(19[89]\d|20\d{2})\b/g);
  if (!m) return null;
  const anios = m.map(Number).filter((a) => a >= 1980 && a <= max);
  return anios.length ? anios[0] : null;
}

export interface ModeloCatalogo {
  id: number;
  nombre: string;
  alias: string[];
}

export type ResultadoModelo =
  | { tipo: 'encontrado'; modelo: ModeloCatalogo }
  | { tipo: 'ambiguo'; candidatos: ModeloCatalogo[] }
  | { tipo: 'ninguno' };

/**
 * Busca el modelo por alias usando la coincidencia MÁS LARGA.
 * "fz 2.0" gana sobre "fz"; si el cliente solo escribe "fz" y varios modelos
 * tienen ese alias, el resultado es ambiguo y el asistente debe preguntar.
 */
export function detectarModelo(texto: string, modelos: ModeloCatalogo[]): ResultadoModelo {
  const t = normalizar(texto);
  let mejorLargo = 0;
  let candidatos: ModeloCatalogo[] = [];
  for (const m of modelos) {
    const frases = [normalizar(m.nombre), ...m.alias.map(normalizar)];
    let largo = 0;
    for (const f of frases) if (f && contieneFrase(t, f)) largo = Math.max(largo, f.length);
    if (largo === 0) continue;
    if (largo > mejorLargo) {
      mejorLargo = largo;
      candidatos = [m];
    } else if (largo === mejorLargo) {
      candidatos.push(m);
    }
  }
  if (candidatos.length === 1) return { tipo: 'encontrado', modelo: candidatos[0] };
  if (candidatos.length > 1) return { tipo: 'ambiguo', candidatos };
  return { tipo: 'ninguno' };
}

/** Cantidad pedida: "2 unidades", "x3", "dos". */
export function detectarCantidad(texto: string): number | null {
  const t = normalizar(texto);
  const palabras: Record<string, number> = { una: 1, uno: 1, un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6 };
  const m = t.match(/\b(\d{1,3})\s*(unidades|unidad|und|uds|juegos|juego|pares|par)\b/) ?? t.match(/\bx\s?(\d{1,3})\b/);
  if (m) return parseInt(m[1], 10);
  const p = t.match(/\b(una|uno|un|dos|tres|cuatro|cinco|seis)\s+(unidades|unidad|juegos|juego|pares|par)\b/);
  if (p) return palabras[p[1]];
  return null;
}

/** Selección de una opción listada: "la 2", "opción 1", "el primero", o solo "2". */
export function detectarOpcion(texto: string): number | null {
  const t = normalizar(texto);
  const ordinales: Record<string, number> = { primer: 1, primero: 1, primera: 1, segundo: 2, segunda: 2, tercero: 3, tercera: 3, cuarto: 4, cuarta: 4 };
  const m = t.match(/^(?:la|el|opcion|numero|#)?\s*(\d)$/) ?? t.match(/\b(?:opcion|numero|la|el)\s+(\d)\b/);
  if (m) return parseInt(m[1], 10);
  for (const [palabra, n] of Object.entries(ordinales)) if (new RegExp(`\\b${palabra}\\b`).test(t)) return n;
  return null;
}

// ---------------------------------------------------------------------
// Intenciones
// ---------------------------------------------------------------------
const PATRONES = {
  humano: /\b(asesor|asesora|humano|persona real|una persona|hablar con alguien|vendedor|encargado|operador|llamar(me)?)\b/,
  molesto: /\b(pesimo|pesima|estafa|estafadores|ladrones|molest[oa]|furios[oa]|indignad[oa]|harto|harta|mal servicio|no sirven|no sirve para nada|queja|reclamo|grosero|que mamera|hp|hijueputa|malparid[oa]s?)\b/,
  saludo: /^(hola|buenas|buenos dias|buenas tardes|buenas noches|hey|que tal|saludos|ola|alo)\b/,
  despedida: /\b(chao|adios|hasta luego|nos vemos|eso es todo|eso seria todo|nada mas|ya no necesito)\b/,
  agradecimiento: /^(gracias|muchas gracias|mil gracias|listo gracias|ok gracias)\b/,
  afirmacion: /^(si|sii+|s|claro|dale|de una|listo|ok|okay|okey|confirmo|confirmado|correcto|asi es|hagale|perfecto|va|sip)\b/,
  negacion: /^(no|nop|nel|negativo|todavia no|aun no|mejor no|cancelar|cancela)\b/,
  agregar: /\b(agregar|agregalo|agregala|agregalos|agregue|añadir|anadir|lo quiero|la quiero|los quiero|las quiero|me lo llevo|me la llevo)\b/,
  cotizar: /\b(cotizacion|cotizar|cotizame|cotiza|presupuesto)\b/,
  pedido: /\b(hacer (el )?pedido|hacer la compra|comprar|finalizar|pedir|confirmar (el )?pedido|quiero pedir|terminar compra)\b/,
  verCarrito: /\b(mi pedido|carrito|que llevo|ver pedido|resumen)\b/,
  vaciar: /\b(vaciar|borrar (el )?pedido|empezar de nuevo|reiniciar)\b/,
  horario: /\b(horario|a que hora|abren|cierran|atienden)\b/,
  ubicacion: /\b(direccion del local|donde quedan|donde estan|ubicacion|local)\b/,
  pagos: /\b(medios de pago|formas de pago|como pago|nequi|daviplata|transferencia|contraentrega)\b/,
  envios: /\b(envio|envios|envian|domicilio|transportadora|mandan)\b/,
  // Temas que no son del negocio
  fueraDeTema: /\b(futbol|politica|clima|chiste|receta|pelicula|novela|tarea|bitcoin|criptomoneda|loteria|horoscopo|musica|cancion)\b/,
};

export type Intencion = keyof typeof PATRONES;

export function detectarIntenciones(texto: string): Set<Intencion> {
  const t = normalizar(texto);
  const r = new Set<Intencion>();
  for (const [k, re] of Object.entries(PATRONES)) if (re.test(t)) r.add(k as Intencion);
  return r;
}

/** Detecta si el cliente escribió algo parecido a un número de tarjeta (13-19 dígitos). */
export function pareceTarjeta(texto: string): boolean {
  return /\b(?:\d[ -]?){13,19}\b/.test(texto) && !/^\+?57?\s?3\d{9}$/.test(texto.replace(/\s/g, ''));
}
