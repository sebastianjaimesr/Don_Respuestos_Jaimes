import { z } from 'zod';
import {
  buscarRepuesto,
  compatibilidadesPorReferencia,
  disponibilidadPorReferencia,
  listarModelos,
  ResultadoProducto,
} from '../../modulos/catalogo/servicio';
import { listarProductos } from '../../modulos/catalogo/publico';
import { asegurarCategorias, categoriaPorClave, categoriasHoja } from '../../modulos/catalogo/categorias';
import { informacionPublica } from '../../modulos/negocio/servicio';
import { detectarModelo } from '../extraccion';
import { vendibilidad } from '../motor';
import type { AccionEntrada, Contexto } from '../tipos';

/**
 * Herramientas de Jaimes AI (docs/ARQUITECTURA.md § 6.2).
 *
 * - Todas las de lectura reutilizan las mismas consultas parametrizadas del
 *   catálogo y la tienda: el modelo nunca escribe SQL ni ve tablas.
 * - Cada entrada se valida con Zod aunque el esquema de la API ya sea estricto.
 * - Ningún resultado trae más de 8 elementos.
 * - Las dos acciones (agregar al carrito y pedir un asesor) NO se ejecutan
 *   aquí: se anotan y el motor de reglas las ejecuta al final del turno con
 *   sus validaciones de siempre (compatibilidad verificada, precio y stock).
 */

export const MAX_RESULTADOS = 8;

/** Lo que va acumulando un turno mientras el modelo usa herramientas. */
export interface EstadoTurno {
  ctx: Contexto;
  /** Productos de una búsqueda por moto (compatibilidad del catálogo para ese modelo y año). */
  busqueda: { modelo: { id: number; nombre: string; fabricante: string } | null; anio: number; productos: ResultadoProducto[] } | null;
  /** Todas las cifras que devolvieron las herramientas en este turno (para verificar el texto). */
  cifras: Set<number>;
  acciones: AccionEntrada[];
  llamadas: { nombre: string; ok: boolean }[];
}

export const nuevoEstadoTurno = (ctx: Contexto): EstadoTurno => ({ ctx, busqueda: null, cifras: new Set(), acciones: [], llamadas: [] });

const nulo = <T extends string>(t: T) => [t, 'null'] as const;

/** Definiciones para la API. Orden y texto estables: forman parte del prefijo en caché. */
export const DEFINICIONES = [
  {
    name: 'identificar_moto',
    description:
      'Busca en el catálogo de motos el modelo que menciona el cliente (por ejemplo "fz 2.0", "pulsar 200", "nmax"). Devuelve uno o varios candidatos con su id. Úsala antes de buscar repuestos por moto. Si hay varios candidatos, pregúntale al cliente cuál es.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { texto: { type: 'string', description: 'Lo que dijo el cliente sobre su moto' } },
      required: ['texto'],
      additionalProperties: false,
    },
  },
  {
    name: 'buscar_productos',
    description:
      'Busca repuestos. Con modelo_id y anio devuelve solo productos registrados como compatibles con esa moto y ese año, con precio, stock y si se pueden vender: esos son los únicos que se pueden agregar al carrito. Sin moto hace una búsqueda general del catálogo (la compatibilidad con la moto del cliente NO queda confirmada). Máximo 8 resultados.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: {
        repuesto: { type: 'string', description: 'Qué repuesto busca, en palabras del cliente: "pastillas de freno", "filtro de aceite", "kit de arrastre"' },
        modelo_id: { type: nulo('integer'), description: 'id devuelto por identificar_moto, o null' },
        anio: { type: nulo('integer'), description: 'Año de la moto, o null si no se sabe' },
        posicion: { type: nulo('string'), enum: ['delantero', 'trasero', null], description: 'Solo para repuestos que lo requieren (frenos, llantas…)' },
        tipo: { type: nulo('string'), enum: ['original', 'generico', null], description: '"generico" significa no original' },
        precio_max: { type: nulo('integer'), description: 'Precio máximo en pesos, si el cliente lo pidió' },
      },
      required: ['repuesto', 'modelo_id', 'anio', 'posicion', 'tipo', 'precio_max'],
      additionalProperties: false,
    },
  },
  {
    name: 'consultar_producto',
    description: 'Detalle de un producto por su referencia o SKU: precio, promoción, stock y todas sus compatibilidades registradas.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { referencia: { type: 'string' } },
      required: ['referencia'],
      additionalProperties: false,
    },
  },
  {
    name: 'verificar_compatibilidad',
    description: 'Revisa si un producto (referencia o SKU) está registrado como compatible con un modelo (id de identificar_moto) y un año. Responde compatible_verificada, por_confirmar o no_registrada.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { referencia: { type: 'string' }, modelo_id: { type: 'integer' }, anio: { type: 'integer' } },
      required: ['referencia', 'modelo_id', 'anio'],
      additionalProperties: false,
    },
  },
  {
    name: 'categorias_mantenimiento',
    description: 'Lista las categorías que el negocio marcó como de mantenimiento. No trae intervalos de kilometraje: esos no se deben inventar.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'info_negocio',
    description: 'Horario, dirección, ciudades de envío, costo de envío y medios de pago. Un valor null significa que el negocio aún no lo confirmó.',
    strict: true,
    input_schema: { type: 'object', properties: {}, required: [], additionalProperties: false },
  },
  {
    name: 'agregar_al_carrito',
    description:
      'Agrega al carrito de ESTA conversación un producto que buscar_productos devolvió con moto y con vendible=true. Úsala solo cuando el cliente lo pida. El sistema valida stock y precio y le confirma al cliente.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { producto_id: { type: 'integer' }, cantidad: { type: 'integer', description: 'Entre 1 y 100' } },
      required: ['producto_id', 'cantidad'],
      additionalProperties: false,
    },
  },
  {
    name: 'solicitar_asesor',
    description: 'Pasa la conversación a un asesor humano. Úsala si el cliente lo pide, está molesto, o si hace falta confirmar algo que las herramientas no tienen.',
    strict: true,
    input_schema: {
      type: 'object',
      properties: { motivo: { type: 'string', description: 'Una frase corta para el asesor' } },
      required: ['motivo'],
      additionalProperties: false,
    },
  },
] as const;

export type NombreHerramienta = (typeof DEFINICIONES)[number]['name'];

const entradas = {
  identificar_moto: z.object({ texto: z.string().trim().min(1).max(120) }),
  buscar_productos: z.object({
    repuesto: z.string().trim().min(1).max(80),
    modelo_id: z.number().int().positive().nullable(),
    anio: z.number().int().min(1980).max(new Date().getFullYear() + 1).nullable(),
    posicion: z.enum(['delantero', 'trasero']).nullable(),
    tipo: z.enum(['original', 'generico']).nullable(),
    precio_max: z.number().int().positive().nullable(),
  }),
  consultar_producto: z.object({ referencia: z.string().trim().min(1).max(60) }),
  verificar_compatibilidad: z.object({ referencia: z.string().trim().min(1).max(60), modelo_id: z.number().int().positive(), anio: z.number().int().min(1980).max(2100) }),
  categorias_mantenimiento: z.object({}),
  info_negocio: z.object({}),
  agregar_al_carrito: z.object({ producto_id: z.number().int().positive(), cantidad: z.number().int().min(1).max(100) }),
  solicitar_asesor: z.object({ motivo: z.string().trim().min(1).max(300) }),
} satisfies Record<NombreHerramienta, z.ZodTypeAny>;

/** Guarda cada número que devolvió una herramienta: el texto del modelo solo puede citar esos. */
function anotarCifras(valor: unknown, cifras: Set<number>, profundidad = 0) {
  if (profundidad > 6 || valor === null || valor === undefined) return;
  if (typeof valor === 'number' && Number.isFinite(valor)) cifras.add(Math.round(valor));
  else if (typeof valor === 'string' && /^\d+(\.\d+)?$/.test(valor)) cifras.add(Math.round(Number(valor)));
  else if (Array.isArray(valor)) valor.forEach((v) => anotarCifras(v, cifras, profundidad + 1));
  else if (typeof valor === 'object') Object.values(valor).forEach((v) => anotarCifras(v, cifras, profundidad + 1));
}

/** Versión compacta de un producto para el modelo (menos tokens, mismos datos). */
const resumenProducto = (p: ResultadoProducto) => ({
  producto_id: p.producto_id,
  referencia: p.referencia,
  nombre: p.nombre,
  tipo: p.tipo,
  marca: p.marca,
  posicion: p.posicion,
  precio: p.precio,
  promocion: p.promocion ? { nombre: p.promocion.nombre, precio_antes: p.promocion.precio_antes } : null,
  stock: p.disponibilidad.cantidad,
  estado_stock: p.disponibilidad.estado,
  compatibilidad: { anios: `${p.compatibilidad.anio_desde}-${p.compatibilidad.anio_hasta}`, verificada: p.compatibilidad.verificada, notas: p.compatibilidad.notas },
  advertencia_seguridad: p.advertencia_seguridad,
  es_demo: p.es_demo,
  ...vendibilidad(p),
});

export class ErrorHerramienta extends Error {}

/** Ejecuta una herramienta. Devuelve un objeto serializable o lanza ErrorHerramienta. */
export async function ejecutarHerramienta(nombre: string, entradaCruda: unknown, t: EstadoTurno): Promise<unknown> {
  if (!(nombre in entradas)) throw new ErrorHerramienta(`Herramienta desconocida: ${nombre}`);
  const n = nombre as NombreHerramienta;
  const v = entradas[n].safeParse(entradaCruda ?? {});
  if (!v.success) throw new ErrorHerramienta(`Entrada inválida: ${v.error.issues.map((i) => `${i.path.join('.')} ${i.message}`).join('; ')}`);
  const e = v.data as never;
  const r = await correr(n, e, t);
  anotarCifras(r, t.cifras);
  return r;
}

async function correr(n: NombreHerramienta, e: any, t: EstadoTurno): Promise<unknown> {
  switch (n) {
    case 'identificar_moto': {
      const modelos = await listarModelos();
      const r = detectarModelo(e.texto, modelos);
      const fila = (m: (typeof modelos)[number]) => ({ modelo_id: m.id, fabricante: m.fabricante, modelo: m.nombre });
      if (r.tipo === 'encontrado') return { resultado: 'encontrado', candidatos: [fila(r.modelo)] };
      if (r.tipo === 'ambiguo') return { resultado: 'varios', candidatos: r.candidatos.slice(0, MAX_RESULTADOS).map(fila) };
      return { resultado: 'no_encontrado', candidatos: [], nota: 'Ese modelo no está en el catálogo. No supongas compatibilidades.' };
    }

    case 'buscar_productos': {
      if (e.modelo_id && e.anio) {
        const r = await buscarRepuesto({ modelo: e.modelo_id, anio: e.anio, repuesto: e.repuesto, posicion: e.posicion, tipo: e.tipo });
        if (r.estado === 'repuesto_ambiguo') {
          return { estado: r.estado, opciones: (r.opciones_categoria ?? []).map((c) => categoriaPorClave(c)?.etiqueta ?? c), nota: 'Pregúntale al cliente cuál de estas necesita.' };
        }
        if (r.estado === 'anio_no_compatible') {
          const rangos = [...new Set(r.fuera_de_rango.map((p) => `${p.compatibilidad.anio_desde}-${p.compatibilidad.anio_hasta}`))];
          return { estado: r.estado, nota: 'Hay productos de ese modelo pero registrados para otros años. NO los ofrezcas como compatibles.', anios_registrados: rangos };
        }
        let productos = r.resultados;
        if (e.precio_max) productos = productos.filter((p) => p.precio !== null && Number(p.precio) <= e.precio_max);
        productos = productos.slice(0, MAX_RESULTADOS);
        if (r.estado === 'ok' && productos.length) {
          // Lo que se muestra al cliente es lo único que después se puede agregar al carrito.
          t.busqueda = { modelo: r.modelo, anio: r.anio, productos };
          t.ctx.ultimos_resultados = productos.map((p) => ({ producto_id: p.producto_id, ...vendibilidad(p) }));
          if (r.modelo) t.ctx.moto = { modelo_id: r.modelo.id, modelo: `${r.modelo.fabricante} ${r.modelo.nombre}`.trim(), anio: r.anio };
          if (r.categoria) t.ctx.consulta = { categoria: r.categoria, posicion: e.posicion ?? undefined, tipo: e.tipo };
        }
        return {
          estado: productos.length ? 'ok' : r.estado === 'ok' ? 'sin_resultados_en_ese_precio' : r.estado,
          moto: r.modelo ? { ...r.modelo, anio: r.anio } : null,
          productos: productos.map(resumenProducto),
          nota: productos.length ? 'El cliente verá estos productos como tarjetas con todos sus datos.' : undefined,
        };
      }
      const r = await listarProductos({
        q: e.repuesto,
        tipo: e.tipo ?? undefined,
        precio_max: e.precio_max ?? undefined,
        orden: 'relevancia',
        pagina: 1,
        tamano: MAX_RESULTADOS,
      });
      return {
        estado: r.items.length ? 'ok' : 'sin_resultados',
        aviso: 'Búsqueda general: la compatibilidad con la moto del cliente NO está confirmada y no se pueden agregar al carrito desde aquí. Pide modelo y año.',
        productos: r.items.map((p) => ({
          referencia: p.sku,
          nombre: p.nombre,
          tipo: p.tipo,
          marca: p.marca,
          categoria: p.categoria.etiqueta,
          precio: p.precio,
          disponibilidad: p.disponibilidad,
          es_demo: p.es_demo,
        })),
      };
    }

    case 'consultar_producto': {
      let d;
      try {
        d = await disponibilidadPorReferencia(e.referencia);
      } catch {
        return { encontrado: false };
      }
      const compat = await compatibilidadesPorReferencia(e.referencia);
      return {
        encontrado: true,
        referencia: d.referencia,
        nombre: d.nombre,
        tipo: d.tipo,
        precio: d.precio,
        precio_confirmado: d.precio_confirmado,
        promocion: d.promocion ? { nombre: d.promocion, precio_antes: d.precio_lista } : null,
        stock: d.cantidad,
        estado_stock: d.estado,
        es_demo: d.es_demo,
        compatibilidades: compat.slice(0, MAX_RESULTADOS).map((c) => ({ moto: `${c.fabricante} ${c.modelo}`, anios: `${c.anio_desde}-${c.anio_hasta}`, verificada: c.verificada, notas: c.notas })),
        mas_compatibilidades: Math.max(0, compat.length - MAX_RESULTADOS),
      };
    }

    case 'verificar_compatibilidad': {
      const modelo = (await listarModelos()).find((m) => m.id === e.modelo_id);
      if (!modelo) return { resultado: 'modelo_no_encontrado' };
      const compat = (await compatibilidadesPorReferencia(e.referencia)).filter((c) => c.modelo === modelo.nombre && (c.fabricante ?? '') === (modelo.fabricante ?? ''));
      const delAnio = compat.filter((c) => e.anio >= c.anio_desde && e.anio <= c.anio_hasta);
      const resultado = delAnio.some((c) => c.verificada) ? 'compatible_verificada' : delAnio.length ? 'por_confirmar' : 'no_registrada';
      return { resultado, moto: `${modelo.fabricante ?? ''} ${modelo.nombre} ${e.anio}`.trim(), anios_registrados: compat.map((c) => `${c.anio_desde}-${c.anio_hasta}`) };
    }

    case 'categorias_mantenimiento': {
      await asegurarCategorias();
      return { categorias: categoriasHoja().filter((c) => c.mantenimiento).map((c) => c.etiqueta), nota: 'No hay intervalos de kilometraje registrados.' };
    }

    case 'info_negocio': {
      const info = await informacionPublica();
      return Object.fromEntries(Object.entries(info).map(([k, v]) => [k, v.valor]));
    }

    case 'agregar_al_carrito': {
      const mostrado = t.ctx.ultimos_resultados.find((r) => r.producto_id === e.producto_id);
      if (!mostrado) throw new ErrorHerramienta('Ese producto no salió en una búsqueda por moto de esta conversación. Busca primero con modelo_id y anio.');
      if (!mostrado.vendible) throw new ErrorHerramienta(`Ese producto no se puede vender ahora (${mostrado.razon}). Ofrece un asesor.`);
      t.acciones.push({ tipo: 'agregar', producto_id: e.producto_id, cantidad: e.cantidad });
      return { anotado: true, nota: 'El sistema lo agrega y le confirma al cliente el total. No repitas el total.' };
    }

    case 'solicitar_asesor': {
      if (!t.acciones.some((a) => a.tipo === 'escalar')) t.acciones.push({ tipo: 'escalar' });
      return { anotado: true, nota: 'El sistema avisa al cliente que un asesor lo atenderá.' };
    }
  }
}
