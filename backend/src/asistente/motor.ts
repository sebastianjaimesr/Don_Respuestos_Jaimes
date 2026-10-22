import { AppError } from '../errores';
import { pool as poolSinBloqueo } from '../db'; // lecturas sin transacción
import { buscarRepuesto, listarModelos, obtenerProductoVenta, ResultadoBusqueda, ResultadoProducto } from '../modulos/catalogo/servicio';
import { ADVERTENCIA_SEGURIDAD, CATEGORIAS, categoriaPorClave } from '../modulos/catalogo/categorias';
import { crearCotizacion } from '../modulos/cotizaciones/servicio';
import { registrarPedido } from '../modulos/pedidos/servicio';
import { escalarAHumano, MotivoEscalamiento } from '../modulos/escalamiento/servicio';
import { calcularLineas } from '../modulos/ventas/lineas';
import { costoEnvioConfirmado, obtenerConfiguracion } from '../modulos/negocio/servicio';
import { registrarEvento } from '../modulos/eventos/servicio';
import { formatoCOP } from '../utils/dinero';
import { normalizar, normalizarTelefono } from '../utils/texto';
import {
  detectarAnio,
  detectarCantidad,
  detectarCategoria,
  detectarIntenciones,
  detectarModelo,
  detectarOpcion,
  detectarPosicion,
  detectarTipo,
  pareceTarjeta,
} from './extraccion';
import type { AccionEntrada, BotonAccion, Contexto, DatosEntrega, Respuesta } from './tipos';

export const SALUDO = '¡Hola! Soy Don Repuestos Jaimes 🏍️ ¿En qué te puedo ayudar hoy?';
export const DESPEDIDA = '¡Gracias por confiar en Don Repuestos Jaimes! Que esa Yamaha siga rodando 🔧';

const ETIQUETA_TIPO = { original: 'Original Yamaha', generico: 'Genérico' } as const;
const ETIQUETA_PAGO: Record<DatosEntrega['metodo_pago'], string> = {
  nequi: 'Nequi',
  daviplata: 'Daviplata',
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  contraentrega: 'Contraentrega',
};
const ORDEN_CAMPOS: (keyof DatosEntrega)[] = ['nombre', 'telefono', 'ciudad', 'modalidad', 'direccion', 'metodo_pago'];
const PREGUNTA_CAMPO: Record<keyof DatosEntrega, string> = {
  nombre: '¿A nombre de quién va el pedido?',
  telefono: '¿A qué número de celular te contactamos?',
  ciudad: '¿En qué ciudad estás?',
  modalidad: '¿Prefieres recoger en tienda o que te lo enviemos?',
  direccion: '¿Cuál es la dirección completa de entrega? (calle, número, barrio)',
  metodo_pago: '¿Cómo prefieres pagar? Nequi, Daviplata, transferencia, efectivo o contraentrega.',
};

export interface EntradaMotor {
  conversacionId: string;
  estadoConversacion: 'activa' | 'escalada' | 'cerrada';
  contexto: Contexto;
  texto?: string;
  accion?: AccionEntrada;
}

export interface SalidaMotor {
  respuestas: Respuesta[];
  contexto: Contexto;
  clienteId?: number | null;
}

const texto = (t: string, acciones?: BotonAccion[]): Respuesta => ({ tipo: 'texto', texto: t, acciones });

/**
 * Motor conversacional determinista.
 * Recibe el mensaje (texto libre o acción de un botón) y el contexto guardado,
 * decide el siguiente paso del flujo de ventas y devuelve las respuestas.
 * Toda la información de productos sale de las herramientas (base de datos).
 */
export async function procesar(entrada: EntradaMotor): Promise<SalidaMotor> {
  const ctx: Contexto = structuredClone(entrada.contexto);
  const salida: Respuesta[] = [];
  const s: Estado = { ctx, salida, conversacionId: entrada.conversacionId, clienteId: null };

  try {
    if (entrada.accion) await manejarAccion(s, entrada.accion);
    else await manejarTexto(s, entrada.texto ?? '', entrada.estadoConversacion);
  } catch (e) {
    await manejarErrorInterno(s, e);
  }
  return { respuestas: salida, contexto: ctx, clienteId: s.clienteId };
}

interface Estado {
  ctx: Contexto;
  salida: Respuesta[];
  conversacionId: string;
  clienteId: number | null;
}

// ---------------------------------------------------------------------
// Acciones de botones (chat web)
// ---------------------------------------------------------------------
async function manejarAccion(s: Estado, a: AccionEntrada) {
  switch (a.tipo) {
    case 'agregar':
      return agregarAlCarrito(s, a.producto_id, a.cantidad ?? 1);
    case 'quitar':
      s.ctx.carrito = s.ctx.carrito.filter((i) => i.producto_id !== a.producto_id);
      return mostrarCarrito(s);
    case 'ver_carrito':
      return mostrarCarrito(s);
    case 'cotizar':
      return cotizar(s);
    case 'iniciar_pedido':
      return iniciarPedido(s);
    case 'datos_entrega':
      return recibirDatosEntregaCompletos(s, a.datos);
    case 'confirmar_pedido':
      if (s.ctx.etapa !== 'confirmacion') {
        s.salida.push(texto('Antes de registrar el pedido necesito revisar contigo el resumen. ¿Quieres que lo armemos?', [{ etiqueta: 'Hacer pedido', accion: { tipo: 'iniciar_pedido' } }]));
        return;
      }
      return confirmarPedido(s);
    case 'rechazar_confirmacion':
      s.ctx.etapa = 'consulta';
      s.salida.push(texto('Listo, no registré nada. ¿Qué quieres cambiar?', botonesCarrito()));
      return;
    case 'escalar':
      return escalar(s, 'solicitud_cliente', 'El cliente pidió hablar con un asesor (botón)');
    case 'elegir_modelo': {
      const elegido = s.ctx.candidatos_modelo.find((m) => m.id === a.modelo_id) ?? (await listarModelos()).find((m) => m.id === a.modelo_id);
      if (!elegido) {
        s.salida.push(texto('No encontré ese modelo. ¿Me escribes el modelo de tu moto?'));
        return;
      }
      fijarModelo(s.ctx, elegido.id, elegido.nombre);
      return avanzarConsulta(s);
    }
    case 'elegir_categoria':
      if (!categoriaPorClave(a.categoria)) return;
      s.ctx.consulta = { categoria: a.categoria, tipo: s.ctx.consulta.tipo };
      return avanzarConsulta(s);
    case 'elegir_posicion':
      s.ctx.consulta.posicion = a.posicion;
      return avanzarConsulta(s);
    case 'nueva_busqueda':
      s.ctx.consulta = {};
      s.ctx.ultimos_resultados = [];
      s.ctx.esperando = 'categoria';
      s.salida.push(texto(s.ctx.moto.modelo ? `¿Qué otro repuesto necesitas para tu ${s.ctx.moto.modelo}${s.ctx.moto.anio ? ' ' + s.ctx.moto.anio : ''}?` : '¿Qué repuesto necesitas y para qué moto?'));
      return;
  }
}

// ---------------------------------------------------------------------
// Texto libre
// ---------------------------------------------------------------------
async function manejarTexto(s: Estado, entradaTexto: string, estadoConv: EntradaMotor['estadoConversacion']) {
  const t = normalizar(entradaTexto);
  const { ctx } = s;
  if (!t) {
    s.salida.push(texto('No me llegó ningún mensaje. ¿En qué te puedo ayudar?'));
    return;
  }

  if (pareceTarjeta(entradaTexto)) {
    s.salida.push(
      texto('🔒 Por tu seguridad, no compartas números de tarjeta, claves ni códigos por este chat. No los necesitamos: el pago se coordina con un asesor por medios autorizados.'),
    );
    return;
  }

  const intenciones = detectarIntenciones(entradaTexto);

  // 1. Escalamiento: cliente molesto o pide un humano
  if (intenciones.has('molesto')) return escalar(s, 'cliente_molesto', 'Cliente molesto');
  if (intenciones.has('humano')) return escalar(s, 'solicitud_cliente', 'El cliente pidió hablar con un asesor');

  if (estadoConv === 'escalada' && !ctx.saludado) ctx.saludado = true;

  // 2. Recolección de datos de entrega (paso a paso)
  if (ctx.etapa === 'datos_entrega') {
    if (intenciones.has('negacion') && /\bcancel/.test(t)) {
      ctx.etapa = 'consulta';
      ctx.campo_pendiente = null;
      s.salida.push(texto('Listo, cancelé el registro de datos. Tus productos siguen guardados. ¿Te ayudo con algo más?', botonesCarrito()));
      return;
    }
    return recibirCampoEntrega(s, entradaTexto);
  }

  // 3. Confirmación explícita del pedido
  if (ctx.etapa === 'confirmacion') {
    if (intenciones.has('afirmacion')) return confirmarPedido(s);
    if (intenciones.has('negacion')) {
      ctx.etapa = 'consulta';
      s.salida.push(texto('Listo, no registré nada. ¿Qué quieres cambiar?', botonesCarrito()));
      return;
    }
    s.salida.push(texto('Para registrarlo necesito tu confirmación: responde SÍ para registrar el pedido o NO para cambiar algo.', botonesConfirmacion()));
    return;
  }

  // 4. Extraer datos de la moto y del repuesto
  const modelos = await listarModelos();
  const rModelo = detectarModelo(entradaTexto, modelos);
  const anio = detectarAnio(entradaTexto);
  let rCategoria = detectarCategoria(entradaTexto);
  const posicion = detectarPosicion(entradaTexto);
  const tipo = detectarTipo(entradaTexto);
  const opcion = detectarOpcion(entradaTexto);

  // Respuestas cortas a una pregunta pendiente ("la 2", "aire", "delanteras")
  let respondioPendiente = false;
  if (ctx.esperando === 'modelo' && rModelo.tipo === 'ninguno' && opcion && ctx.candidatos_modelo[opcion - 1]) {
    const m = ctx.candidatos_modelo[opcion - 1];
    fijarModelo(ctx, m.id, m.nombre);
    respondioPendiente = true;
  }
  const opcionesCat = ctx.consulta.opciones_categoria;
  if (ctx.esperando === 'categoria' && opcionesCat?.length && !(rCategoria.tipo === 'encontrada' && opcionesCat.includes(rCategoria.clave))) {
    // "aceite" después de "¿filtro de aire o de aceite?" significa filtro de aceite, no aceite de motor
    const elegida = resolverOpcionCategoria(t, opcionesCat, opcion);
    if (elegida) rCategoria = { tipo: 'encontrada', clave: elegida };
  }

  const hayDatosNuevos =
    respondioPendiente || rModelo.tipo !== 'ninguno' || anio !== null || rCategoria.tipo !== 'ninguna' || posicion !== null || tipo !== null;

  // 5. Agregar al carrito un resultado mostrado ("sí", "la 2", "agrégalo")
  if (!hayDatosNuevos && ctx.ultimos_resultados.length && (intenciones.has('agregar') || intenciones.has('afirmacion') || opcion)) {
    const cantidad = detectarCantidad(entradaTexto) ?? 1;
    const vendibles = ctx.ultimos_resultados.filter((r) => r.vendible);
    let elegido: number | undefined;
    if (opcion) elegido = ctx.ultimos_resultados[opcion - 1]?.producto_id;
    else if (vendibles.length === 1) elegido = vendibles[0].producto_id;
    else if (ctx.ultimos_resultados.length === 1) elegido = ctx.ultimos_resultados[0].producto_id; // explicará por qué no se puede
    if (elegido) return agregarAlCarrito(s, elegido, cantidad);
    if (vendibles.length > 1) {
      s.salida.push(texto('¿Cuál de las opciones quieres agregar? Respóndeme con el número (por ejemplo: "la 1").'));
      return;
    }
  }
  if (!hayDatosNuevos && ctx.ultimos_resultados.length && intenciones.has('negacion') && !intenciones.has('pedido')) {
    ctx.ultimos_resultados = [];
    s.salida.push(texto('Listo. ¿Te ayudo con otro repuesto?', botonesCarrito()));
    return;
  }

  // 6. Comandos del pedido
  if (intenciones.has('vaciar')) {
    ctx.carrito = [];
    ctx.cotizacion_codigo = null;
    s.salida.push(texto('Listo, vacié tu pedido. ¿Qué repuesto necesitas?'));
    return;
  }
  if (intenciones.has('cotizar') && !hayDatosNuevos) return cotizar(s);
  if (intenciones.has('pedido') && !hayDatosNuevos) return iniciarPedido(s);
  if (intenciones.has('verCarrito') && !hayDatosNuevos) return mostrarCarrito(s);

  // 7. Preguntas sobre el negocio (horario, dirección, pagos, envíos)
  if (!hayDatosNuevos && (intenciones.has('horario') || intenciones.has('ubicacion') || intenciones.has('pagos') || intenciones.has('envios'))) {
    return responderInfoNegocio(s, intenciones);
  }

  // 8. Saludo / despedida / fuera de tema
  const prefijoSaludo = !ctx.saludado && intenciones.has('saludo');
  if (prefijoSaludo) ctx.saludado = true;
  if (!hayDatosNuevos) {
    if (intenciones.has('despedida')) {
      s.salida.push(texto(DESPEDIDA));
      return;
    }
    if (intenciones.has('agradecimiento')) {
      s.salida.push(texto('¡Con mucho gusto! ¿Te ayudo con algo más?'));
      return;
    }
    if (prefijoSaludo || intenciones.has('saludo')) {
      s.salida.push(texto(prefijoSaludo ? SALUDO : '¡Hola de nuevo! ¿Qué repuesto necesitas para tu Yamaha?'));
      return;
    }
    if (intenciones.has('afirmacion')) {
      s.salida.push(texto('¡Claro! Cuéntame qué repuesto necesitas y para qué moto.'));
      return;
    }
    if (intenciones.has('negacion')) {
      s.salida.push(texto(DESPEDIDA));
      return;
    }
    if (intenciones.has('fueraDeTema')) {
      s.salida.push(texto('Ahí sí no te puedo ayudar 😅. Yo me encargo de repuestos para motos Yamaha. ¿Necesitas algún repuesto?'));
      return;
    }
    // Respuesta a "¿qué moto?" con un modelo que no está en el catálogo
    if (ctx.esperando === 'modelo') {
      s.salida.push(texto(`No encontré ese modelo en nuestro catálogo. Trabajamos repuestos Yamaha como ${modelos.slice(0, 6).map((m) => m.nombre).join(', ')}. ¿Cuál es tu moto?`));
      return;
    }
    ctx.no_entendidos += 1;
    if (ctx.no_entendidos >= 3) {
      ctx.no_entendidos = 0;
      s.salida.push(
        texto('Creo que no te estoy entendiendo bien. ¿Quieres que te comunique con un asesor?', [{ etiqueta: 'Hablar con un asesor', accion: { tipo: 'escalar' } }]),
      );
      return;
    }
    s.salida.push(texto('No te entendí bien. Cuéntame el modelo y año de tu Yamaha y el repuesto que buscas. Por ejemplo: "pastillas delanteras para FZ 2.0 2018".'));
    return;
  }
  ctx.no_entendidos = 0;
  if (prefijoSaludo) s.salida.push(texto('¡Hola! Soy Don Repuestos Jaimes 🏍️'));

  // 9. Actualizar contexto con lo detectado
  if (rModelo.tipo === 'encontrado') fijarModelo(ctx, rModelo.modelo.id, rModelo.modelo.nombre);
  else if (rModelo.tipo === 'ambiguo') {
    ctx.candidatos_modelo = rModelo.candidatos.map(({ id, nombre }) => ({ id, nombre }));
    ctx.moto = { anio: anio ?? ctx.moto.anio };
  }
  if (anio) ctx.moto.anio = anio;
  if (rCategoria.tipo === 'encontrada') {
    if (rCategoria.clave !== ctx.consulta.categoria) ctx.consulta = { tipo: ctx.consulta.tipo };
    ctx.consulta.categoria = rCategoria.clave;
    ctx.consulta.opciones_categoria = undefined;
  } else if (rCategoria.tipo === 'ambigua') {
    ctx.consulta = { opciones_categoria: rCategoria.opciones, tipo: ctx.consulta.tipo };
  }
  if (posicion) ctx.consulta.posicion = posicion;
  if (tipo) ctx.consulta.tipo = tipo === 'cualquiera' ? null : tipo;

  return avanzarConsulta(s);
}

function fijarModelo(ctx: Contexto, id: number, nombre: string) {
  if (ctx.moto.modelo_id !== id) ctx.ultimos_resultados = [];
  ctx.moto = { modelo_id: id, modelo: nombre, anio: ctx.moto.anio };
  ctx.candidatos_modelo = [];
}

function resolverOpcionCategoria(t: string, opciones: string[], opcion: number | null): string | null {
  if (opcion && opciones[opcion - 1]) return opciones[opcion - 1];
  // Palabras que distinguen cada opción: "aire" vs "aceite", "pastillas" vs "disco"
  const palabrasDe = (clave: string) => normalizar(categoriaPorClave(clave)?.etiqueta ?? '').split(' ');
  const comunes = opciones.map(palabrasDe).reduce((a, b) => a.filter((p) => b.includes(p)));
  const coincidencias = opciones.filter((o) => palabrasDe(o).some((p) => !comunes.includes(p) && p.length > 2 && new RegExp(`\\b${p.slice(0, 5)}`).test(t)));
  return coincidencias.length === 1 ? coincidencias[0] : null;
}

/** Pregunta lo que falta (moto → año → repuesto → posición) o busca. */
async function avanzarConsulta(s: Estado) {
  const { ctx } = s;
  if (ctx.candidatos_modelo.length) {
    ctx.esperando = 'modelo';
    const lista = ctx.candidatos_modelo.map((m, i) => `${i + 1}) ${m.nombre}`).join('\n');
    s.salida.push(
      texto(
        `Tenemos varios modelos con ese nombre y no comparten los mismos repuestos. ¿Cuál es la tuya?\n${lista}`,
        ctx.candidatos_modelo.map((m) => ({ etiqueta: m.nombre, accion: { tipo: 'elegir_modelo', modelo_id: m.id } })),
      ),
    );
    return;
  }
  if (!ctx.moto.modelo_id) {
    ctx.esperando = 'modelo';
    s.salida.push(texto('¿Para qué moto es? Dime el modelo y el año (por ejemplo: FZ 2.0 2018).'));
    return;
  }
  if (!ctx.moto.anio) {
    ctx.esperando = 'anio';
    s.salida.push(texto(`¿De qué año es tu ${ctx.moto.modelo}?`));
    return;
  }
  if (ctx.consulta.opciones_categoria?.length && !ctx.consulta.categoria) {
    ctx.esperando = 'categoria';
    const opciones = ctx.consulta.opciones_categoria;
    const pregunta = opciones.includes('filtro_aire') ? '¿Necesitas el filtro de aire o el filtro de aceite?' : '¿Buscas pastillas, bandas o disco de freno?';
    s.salida.push(
      texto(
        pregunta,
        opciones.map((o) => ({ etiqueta: categoriaPorClave(o)!.etiqueta, accion: { tipo: 'elegir_categoria', categoria: o } })),
      ),
    );
    return;
  }
  if (!ctx.consulta.categoria) {
    ctx.esperando = 'categoria';
    s.salida.push(texto(`Perfecto, ${ctx.moto.modelo} ${ctx.moto.anio}. ¿Qué repuesto necesitas?`));
    return;
  }
  const cat = categoriaPorClave(ctx.consulta.categoria)!;
  if (cat.requierePosicion && !ctx.consulta.posicion) {
    ctx.esperando = 'posicion';
    const plural = cat.etiqueta.toLowerCase();
    const fem = /^(pastillas|bandas|llanta)/i.test(cat.etiqueta);
    s.salida.push(
      texto(`¿Buscas ${plural} ${fem ? 'delanteras o traseras' : 'delantero o trasero'}?`, [
        { etiqueta: fem ? 'Delanteras' : 'Delantero', accion: { tipo: 'elegir_posicion', posicion: 'delantero' } },
        { etiqueta: fem ? 'Traseras' : 'Trasero', accion: { tipo: 'elegir_posicion', posicion: 'trasero' } },
      ]),
    );
    return;
  }
  ctx.esperando = null;
  await buscarYPresentar(s);
}

// ---------------------------------------------------------------------
// Búsqueda y presentación
// ---------------------------------------------------------------------
async function buscarYPresentar(s: Estado) {
  const { ctx } = s;
  const r: ResultadoBusqueda = await buscarRepuesto({
    modelo: ctx.moto.modelo_id!,
    anio: ctx.moto.anio!,
    repuesto: ctx.consulta.categoria!,
    posicion: ctx.consulta.posicion ?? null,
    tipo: ctx.consulta.tipo ?? null,
  });
  const cat = categoriaPorClave(ctx.consulta.categoria!)!;
  const moto = `${r.modelo?.nombre} ${r.anio}`;
  const nombreRep = `${cat.etiqueta.toLowerCase()}${ctx.consulta.posicion ? (ctx.consulta.posicion === 'delantero' ? ' delanter' : ' traser') + (/^(pastillas|bandas)/.test(cat.clave) ? 'as' : cat.clave === 'llanta' ? 'a' : 'o') : ''}`;
  ctx.ultimos_resultados = [];

  if (r.estado === 'anio_no_compatible') {
    const rangos = [...new Set(r.fuera_de_rango.map((p) => `${p.compatibilidad.anio_desde}–${p.compatibilidad.anio_hasta}`))].join(', ');
    s.salida.push(
      texto(
        `Tengo ${nombreRep} para la ${r.modelo?.nombre}, pero registradas solo para los años ${rangos}. Para tu ${r.anio} no está confirmada la compatibilidad, así que no te la puedo ofrecer como segura. ¿Quieres que un asesor lo revise?`,
        [{ etiqueta: 'Sí, que lo revise un asesor', accion: { tipo: 'escalar' } }, { etiqueta: 'Buscar otro repuesto', accion: { tipo: 'nueva_busqueda' } }],
      ),
    );
    return;
  }
  if (r.estado !== 'ok') {
    const filtroTipo = ctx.consulta.tipo ? ` (${ETIQUETA_TIPO[ctx.consulta.tipo].toLowerCase()})` : '';
    s.salida.push(
      texto(`No encontré ${nombreRep}${filtroTipo} para tu ${moto} en nuestro inventario. ¿Quieres que un asesor lo revise o buscamos otro repuesto?`, [
        { etiqueta: 'Que lo revise un asesor', accion: { tipo: 'escalar' } },
        { etiqueta: 'Buscar otro repuesto', accion: { tipo: 'nueva_busqueda' } },
      ]),
    );
    return;
  }

  const productos = r.resultados.slice(0, 4);
  ctx.ultimos_resultados = productos.map((p) => ({ producto_id: p.producto_id, ...vendibilidad(p) }));
  const varios = productos.length > 1;
  const bloques = productos.map((p, i) => formatoProducto(p, varios ? i + 1 : null));
  const notas: string[] = [];
  if (productos.some((p) => p.tipo === 'original') && productos.some((p) => p.tipo === 'generico')) {
    notas.push('La diferencia: el original es de marca Yamaha; el genérico es de otra marca y por lo general más económico.');
  }
  if (productos.some((p) => p.advertencia_seguridad)) notas.push(ADVERTENCIA_SEGURIDAD);
  if (productos.some((p) => p.es_demo)) notas.push('ℹ️ Estos son datos de demostración ficticios, no inventario real.');

  const vendibles = productos.filter((p) => vendibilidad(p).vendible);
  let cierre: string;
  if (!vendibles.length) cierre = '¿Quieres que un asesor te ayude con esta referencia?';
  else if (vendibles.length === 1) cierre = '¿Quieres agregarlo a tu pedido?';
  else cierre = '¿Cuál quieres agregar a tu pedido? Respóndeme con el número.';

  const encabezado = varios ? `Encontré ${productos.length} opciones para tu Yamaha ${moto}:` : `Encontré esta opción para tu Yamaha ${moto}:`;
  const acciones: BotonAccion[] = vendibles.map((p) => ({
    etiqueta: varios ? `Agregar opción ${productos.indexOf(p) + 1}` : 'Agregar al pedido',
    accion: { tipo: 'agregar', producto_id: p.producto_id, cantidad: 1 },
  }));
  if (vendibles.length < productos.length) acciones.push({ etiqueta: 'Hablar con un asesor', accion: { tipo: 'escalar' } });

  s.salida.push({
    tipo: 'productos',
    texto: [encabezado, ...bloques, ...notas, cierre].join('\n\n'),
    datos: { modelo: r.modelo, anio: r.anio, productos: productos.map((p) => ({ ...p, ...vendibilidad(p) })) },
    acciones,
  });
}

function vendibilidad(p: ResultadoProducto): { vendible: boolean; razon?: string } {
  if (!p.compatibilidad.verificada) return { vendible: false, razon: 'compatibilidad_no_verificada' };
  if (!p.precio_confirmado) return { vendible: false, razon: 'precio_no_confirmado' };
  if (p.disponibilidad.estado === 'agotado' || p.disponibilidad.estado === 'sin_registro') return { vendible: false, razon: 'agotado' };
  return { vendible: true };
}

/** Solo muestra campos confirmados; lo no confirmado se dice explícitamente. */
function formatoProducto(p: ResultadoProducto, numero: number | null): string {
  const lineas = [`${numero ? numero + ') ' : ''}${p.nombre} — ${ETIQUETA_TIPO[p.tipo]}${p.tipo === 'generico' ? ` (${p.marca})` : ''}`];
  lineas.push(`• Referencia: ${p.referencia}`);
  lineas.push(
    p.compatibilidad.verificada
      ? `• Compatibilidad: ${p.compatibilidad.modelo} ${p.compatibilidad.anio_desde}–${p.compatibilidad.anio_hasta}`
      : '• Compatibilidad: sin verificar, debe confirmarla un asesor',
  );
  lineas.push(p.precio ? `• Precio: ${formatoCOP(p.precio)}` : '• Precio: por confirmar con un asesor');
  const d = p.disponibilidad;
  if (d.estado === 'agotado') {
    lineas.push(`• Disponibilidad: agotado${d.tiempo_abastecimiento_dias ? ` (abastecimiento estimado: ${d.tiempo_abastecimiento_dias} días)` : ''}`);
  } else if (d.estado === 'sin_registro' || d.cantidad === null) {
    lineas.push('• Disponibilidad: por confirmar');
  } else {
    lineas.push(`• Disponibilidad: ${d.cantidad} ${d.cantidad === 1 ? 'unidad' : 'unidades'}`);
  }
  lineas.push(`• Tipo: ${ETIQUETA_TIPO[p.tipo]}`);
  return lineas.join('\n');
}

// ---------------------------------------------------------------------
// Carrito y cotización
// ---------------------------------------------------------------------
async function agregarAlCarrito(s: Estado, productoId: number, cantidad: number) {
  const { ctx } = s;
  if (!Number.isInteger(cantidad) || cantidad <= 0 || cantidad > 100) {
    s.salida.push(texto('La cantidad debe ser un número entero entre 1 y 100.'));
    return;
  }
  // Solo se puede agregar algo que el asistente haya mostrado como vendible
  const mostrado = ctx.ultimos_resultados.find((r) => r.producto_id === productoId);
  const enCarrito = ctx.carrito.find((i) => i.producto_id === productoId);
  if (!mostrado && !enCarrito) {
    s.salida.push(texto('Primero busquemos el repuesto para tu moto y así confirmo que sea compatible. ¿Qué necesitas?'));
    return;
  }
  if (mostrado && !mostrado.vendible) {
    const razones: Record<string, string> = {
      compatibilidad_no_verificada: 'su compatibilidad con tu moto no está verificada',
      precio_no_confirmado: 'su precio todavía no está confirmado',
      agotado: 'está agotado en este momento',
    };
    s.salida.push(
      texto(`Esa opción no la puedo agregar porque ${razones[mostrado.razon ?? ''] ?? 'falta información'}. ¿Quieres que un asesor te ayude?`, [
        { etiqueta: 'Hablar con un asesor', accion: { tipo: 'escalar' } },
      ]),
    );
    return;
  }
  const p = await obtenerProductoVenta(productoId);
  const yaTiene = enCarrito?.cantidad ?? 0;
  if (!p || !p.activo || p.precio === null) {
    s.salida.push(texto('Ese producto ya no está disponible para la venta. ¿Te ayudo a buscar otra opción?'));
    return;
  }
  if ((p.cantidad ?? 0) < yaTiene + cantidad) {
    const disp = Math.max(0, (p.cantidad ?? 0) - yaTiene);
    s.salida.push(texto(disp > 0 ? `Solo tengo ${p.cantidad} ${p.cantidad === 1 ? 'unidad' : 'unidades'} de ${p.nombre}. ¿Quieres llevar ${disp}?` : `Ya no hay más unidades disponibles de ${p.nombre}.`));
    return;
  }
  if (enCarrito) enCarrito.cantidad += cantidad;
  else ctx.carrito.push({ producto_id: productoId, cantidad });
  ctx.cotizacion_codigo = null; // el carrito cambió: la cotización anterior ya no aplica
  const t = await calcularLineas(poolSinBloqueo, ctx.carrito, { bloquear: false, costoEnvio: null, envioAplica: false });
  s.salida.push(
    texto(`Listo, agregué ${p.nombre} (${p.referencia}) x${cantidad}. Llevas ${t.lineas.length} ${t.lineas.length === 1 ? 'producto' : 'productos'} por ${formatoCOP(t.subtotal)}. ¿Necesitas otro repuesto o seguimos con la cotización?`, botonesCarrito()),
  );
}

async function mostrarCarrito(s: Estado) {
  if (!s.ctx.carrito.length) {
    s.salida.push(texto('Todavía no tienes productos en tu pedido. ¿Qué repuesto necesitas?'));
    return;
  }
  try {
    const t = await calcularLineas(poolSinBloqueo, s.ctx.carrito, { bloquear: false, costoEnvio: null, envioAplica: false });
    const lineas = t.lineas.map((l) => `• ${l.descripcion} (${l.referencia}) x${l.cantidad} — ${formatoCOP(l.subtotal)}`);
    s.salida.push({
      tipo: 'carrito',
      texto: ['Tu pedido hasta ahora:', ...lineas, `Subtotal: ${formatoCOP(t.subtotal)} (sin envío)`].join('\n'),
      datos: t,
      acciones: [...botonesCarrito(), ...t.lineas.map((l) => ({ etiqueta: `Quitar ${l.referencia}`, accion: { tipo: 'quitar' as const, producto_id: l.producto_id } }))],
    });
  } catch (e) {
    if (e instanceof AppError) return problemaConCarrito(s, e);
    throw e;
  }
}

async function cotizar(s: Estado) {
  const { ctx } = s;
  if (!ctx.carrito.length) {
    s.salida.push(texto('Para cotizar primero necesito saber qué repuestos llevas. ¿Qué necesitas y para qué moto?'));
    return;
  }
  try {
    const c = await crearCotizacion({
      items: ctx.carrito,
      modalidad_entrega: ctx.entrega.modalidad ?? null,
      ciudad: ctx.entrega.ciudad ?? null,
      conversacion_id: s.conversacionId,
    });
    ctx.cotizacion_codigo = c.codigo;
    const lineas = c.lineas.map((l) => `• ${l.descripcion} (${l.referencia}) — ${l.cantidad} x ${formatoCOP(l.precio_unitario)} = ${formatoCOP(l.subtotal)}`);
    const envio =
      c.modalidad_entrega === 'recogida_tienda'
        ? 'Envío: no aplica (recoges en tienda)'
        : c.envio_confirmado && c.costo_envio !== null
          ? `Envío: ${formatoCOP(c.costo_envio)}`
          : 'Envío: por confirmar (no está incluido en el total)';
    const fecha = new Date(c.fecha_emision).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' });
    s.salida.push({
      tipo: 'cotizacion',
      texto: [
        `Cotización ${c.codigo} (${fecha}) — estado: emitida`,
        ...lineas,
        `Subtotal: ${formatoCOP(c.subtotal)}`,
        envio,
        `Total: ${formatoCOP(c.total)}${c.envio_confirmado ? '' : ' + envío por confirmar'}`,
        c.vigente_hasta ? `Vigente hasta: ${new Date(c.vigente_hasta).toLocaleDateString('es-CO', { timeZone: 'America/Bogota' })}` : 'Precios sujetos a disponibilidad al momento del pedido.',
        '¿Quieres hacer el pedido?',
      ].join('\n'),
      datos: c,
      acciones: [{ etiqueta: 'Hacer pedido', accion: { tipo: 'iniciar_pedido' } }, { etiqueta: 'Buscar otro repuesto', accion: { tipo: 'nueva_busqueda' } }],
    });
  } catch (e) {
    if (e instanceof AppError) return problemaConCarrito(s, e);
    throw e;
  }
}

function problemaConCarrito(s: Estado, e: AppError) {
  const d = e.detalles as { referencia?: string; disponible?: number } | undefined;
  if (e.codigo === 'STOCK_INSUFICIENTE') {
    s.salida.push(
      texto(`Uy, la disponibilidad cambió: de ${d?.referencia} quedan ${d?.disponible} unidades. Ajustemos la cantidad antes de seguir.`, [
        { etiqueta: 'Ver mi pedido', accion: { tipo: 'ver_carrito' } },
      ]),
    );
  } else if (e.codigo === 'PRECIO_NO_CONFIRMADO') {
    s.salida.push(texto(`El precio de ${d?.referencia} ya no está confirmado, así que un asesor debe revisarlo.`, [{ etiqueta: 'Hablar con un asesor', accion: { tipo: 'escalar' } }]));
  } else {
    s.salida.push(texto(`No pude continuar: ${e.message}.`, [{ etiqueta: 'Hablar con un asesor', accion: { tipo: 'escalar' } }]));
  }
}

// ---------------------------------------------------------------------
// Datos de entrega y confirmación
// ---------------------------------------------------------------------
async function iniciarPedido(s: Estado) {
  const { ctx } = s;
  if (!ctx.carrito.length) {
    s.salida.push(texto('Aún no tienes productos en tu pedido. ¿Qué repuesto necesitas?'));
    return;
  }
  ctx.etapa = 'datos_entrega';
  ctx.campo_pendiente = siguienteCampo(ctx.entrega);
  if (!ctx.campo_pendiente) return mostrarResumen(s);
  s.salida.push({
    tipo: 'formulario_entrega',
    texto: `Perfecto, armemos tu pedido. ${PREGUNTA_CAMPO[ctx.campo_pendiente]}`,
    datos: { campos: ORDEN_CAMPOS, valores: ctx.entrega },
  });
}

function siguienteCampo(e: Partial<DatosEntrega>): keyof DatosEntrega | null {
  for (const c of ORDEN_CAMPOS) {
    if (c === 'direccion' && e.modalidad !== 'envio') continue;
    if (!e[c]) return c;
  }
  return null;
}

function validarCampo(campo: keyof DatosEntrega, valor: string): { ok: true; valor: string } | { ok: false; error: string } {
  const v = valor.trim();
  const n = normalizar(v);
  switch (campo) {
    case 'nombre':
      return /^[\p{L} .'-]{2,120}$/u.test(v) ? { ok: true, valor: v } : { ok: false, error: 'Escríbeme tu nombre (solo letras), por favor.' };
    case 'telefono': {
      const t = normalizarTelefono(v);
      return t ? { ok: true, valor: t } : { ok: false, error: 'Ese número no parece válido. Escríbeme un celular colombiano de 10 dígitos, por ejemplo 3001234567.' };
    }
    case 'ciudad':
      return /^[\p{L} .'-]{2,80}$/u.test(v) ? { ok: true, valor: v } : { ok: false, error: '¿En qué ciudad estás? Escríbeme solo el nombre de la ciudad.' };
    case 'modalidad':
      if (/\b(recog|tienda|local|paso por|voy por|recojo)/.test(n)) return { ok: true, valor: 'recogida_tienda' };
      if (/\b(envi|domicilio|mand|despach|recogida_tienda)/.test(n)) return { ok: true, valor: n === 'recogida_tienda' ? 'recogida_tienda' : 'envio' };
      return { ok: false, error: '¿Lo recoges en tienda o prefieres envío?' };
    case 'direccion':
      return v.length >= 8 && v.length <= 200 && /\d/.test(v) ? { ok: true, valor: v } : { ok: false, error: 'Necesito la dirección completa, con calle y número (por ejemplo: Calle 10 # 20-30, barrio Centro).' };
    case 'metodo_pago': {
      const mapa: [RegExp, DatosEntrega['metodo_pago']][] = [
        [/nequi/, 'nequi'],
        [/daviplata/, 'daviplata'],
        [/transfer|bancolombia|consignacion/, 'transferencia'],
        [/contra ?entrega|al recibir|cuando llegue/, 'contraentrega'],
        [/efectivo|cash/, 'efectivo'],
      ];
      const m = mapa.find(([re]) => re.test(n));
      return m ? { ok: true, valor: m[1] } : { ok: false, error: PREGUNTA_CAMPO.metodo_pago };
    }
  }
}

async function recibirCampoEntrega(s: Estado, valor: string) {
  const { ctx } = s;
  const campo = ctx.campo_pendiente ?? siguienteCampo(ctx.entrega);
  if (!campo) return mostrarResumen(s);
  const r = validarCampo(campo, valor);
  if (!r.ok) {
    s.salida.push(texto(r.error));
    return;
  }
  (ctx.entrega as Record<string, string>)[campo] = r.valor;
  ctx.campo_pendiente = siguienteCampo(ctx.entrega);
  if (ctx.campo_pendiente) {
    let extra = '';
    if (campo === 'modalidad' && r.valor === 'recogida_tienda') {
      const cfg = await obtenerConfiguracion();
      extra = cfg.direccion?.confirmado ? `Nuestra dirección: ${cfg.direccion.valor}. ` : 'La dirección del local te la confirma un asesor. ';
    }
    s.salida.push(texto(`${extra}${PREGUNTA_CAMPO[ctx.campo_pendiente]}`));
    return;
  }
  return mostrarResumen(s);
}

async function recibirDatosEntregaCompletos(s: Estado, datos: Partial<DatosEntrega>) {
  const { ctx } = s;
  if (!ctx.carrito.length) {
    s.salida.push(texto('Aún no tienes productos en tu pedido. ¿Qué repuesto necesitas?'));
    return;
  }
  const errores: string[] = [];
  const nuevos: Partial<DatosEntrega> = {};
  for (const campo of ORDEN_CAMPOS) {
    const v = datos[campo];
    if (campo === 'direccion' && (datos.modalidad ?? nuevos.modalidad) !== 'envio') continue;
    if (typeof v !== 'string' || !v.trim()) {
      errores.push(PREGUNTA_CAMPO[campo]);
      continue;
    }
    const r = validarCampo(campo, v);
    if (r.ok) (nuevos as Record<string, string>)[campo] = r.valor;
    else errores.push(r.error);
  }
  if (errores.length) {
    ctx.etapa = 'datos_entrega';
    ctx.entrega = { ...ctx.entrega, ...nuevos };
    ctx.campo_pendiente = siguienteCampo(ctx.entrega);
    s.salida.push({ tipo: 'formulario_entrega', texto: `Revisa estos datos, por favor:\n• ${errores.join('\n• ')}`, datos: { campos: ORDEN_CAMPOS, valores: ctx.entrega, errores } });
    return;
  }
  ctx.entrega = nuevos;
  ctx.campo_pendiente = null;
  return mostrarResumen(s);
}

async function mostrarResumen(s: Estado) {
  const { ctx } = s;
  const e = ctx.entrega as DatosEntrega;
  const envioAplica = e.modalidad === 'envio';
  const costo = envioAplica ? await costoEnvioConfirmado(e.ciudad) : null;
  let t;
  try {
    t = await calcularLineas(poolSinBloqueo, ctx.carrito, { bloquear: false, costoEnvio: costo, envioAplica });
  } catch (err) {
    ctx.etapa = 'consulta';
    if (err instanceof AppError) return problemaConCarrito(s, err);
    throw err;
  }
  ctx.etapa = 'confirmacion';
  const lineas = t.lineas.map((l) => `• ${l.descripcion} (${l.referencia}) x${l.cantidad} — ${formatoCOP(l.subtotal)}`);
  const envio = !envioAplica ? 'Entrega: recoges en tienda' : `Entrega: envío a ${e.direccion}, ${e.ciudad}`;
  const costoTxt = !envioAplica ? '' : t.envio_confirmado ? `Envío: ${formatoCOP(t.costo_envio!)}` : 'Envío: costo por confirmar con un asesor (no incluido)';
  s.salida.push({
    tipo: 'resumen_pedido',
    texto: [
      'Revisemos tu pedido antes de registrarlo:',
      ...lineas,
      `Subtotal: ${formatoCOP(t.subtotal)}`,
      costoTxt,
      `Total: ${formatoCOP(t.total)}${t.envio_confirmado ? '' : ' + envío por confirmar'}`,
      envio,
      `Pago: ${ETIQUETA_PAGO[e.metodo_pago]} (sujeto a confirmación del negocio)`,
      `A nombre de: ${e.nombre}, cel. ${e.telefono}`,
      '¿Confirmas el pedido? Responde SÍ para registrarlo o NO para cambiar algo.',
    ]
      .filter(Boolean)
      .join('\n'),
    datos: { ...t, entrega: e },
    acciones: botonesConfirmacion(),
  });
}

async function confirmarPedido(s: Estado) {
  const { ctx } = s;
  const e = ctx.entrega as DatosEntrega;
  // La clave identifica este intento de compra: si el cliente toca "confirmar" dos veces
  // (o n8n reintenta), se devuelve el mismo pedido en lugar de crear otro.
  const clave = `chat:${s.conversacionId}:${ctx.pedidos_realizados + 1}`;
  try {
    const pedido = await registrarPedido({
      cliente: { nombre: e.nombre, telefono: e.telefono, ciudad: e.ciudad, direccion: e.modalidad === 'envio' ? e.direccion : null },
      items: ctx.carrito,
      entrega: { modalidad: e.modalidad, ciudad: e.ciudad, direccion: e.modalidad === 'envio' ? e.direccion : null },
      metodo_pago: e.metodo_pago,
      confirmado_por_cliente: true,
      clave_idempotencia: clave,
      conversacion_id: s.conversacionId,
      cotizacion_codigo: ctx.cotizacion_codigo,
    });
    ctx.pedidos_realizados += 1;
    ctx.carrito = [];
    ctx.cotizacion_codigo = null;
    ctx.etapa = 'consulta';
    ctx.ultimos_resultados = [];
    s.salida.push({
      tipo: 'pedido_registrado',
      texto: [
        `¡Listo! Tu pedido quedó registrado con el código ${pedido.codigo}.`,
        `Total: ${formatoCOP(pedido.total)}${pedido.envio_confirmado ? '' : ' + envío por confirmar'}.`,
        `Un asesor te contactará para coordinar el pago${pedido.envio_confirmado ? '' : ' y el envío'}. Nunca te pediremos claves ni datos de tarjeta.`,
        '¿Te ayudo con algo más?',
      ].join('\n'),
      datos: { codigo: pedido.codigo, total: pedido.total, estado: pedido.estado },
    });
  } catch (err) {
    ctx.etapa = 'consulta';
    if (err instanceof AppError && ['STOCK_INSUFICIENTE', 'PRECIO_NO_CONFIRMADO', 'PRODUCTO_NO_ENCONTRADO'].includes(err.codigo)) {
      s.salida.push(texto('No registré el pedido.'));
      return problemaConCarrito(s, err);
    }
    // Error técnico: decirlo con honestidad y escalar
    void registrarEvento('error', 'pedido_fallido_chat', 'Falló el registro de un pedido desde el chat', { error: (err as Error).message });
    s.salida.push({
      tipo: 'error',
      texto: 'Tuvimos un problema técnico y tu pedido NO quedó registrado. No te preocupes: no se te cobró nada.',
    });
    await escalar(s, 'error_sistema', 'Falló el registro de un pedido confirmado por el cliente', true);
  }
}

// ---------------------------------------------------------------------
// Escalamiento, información del negocio y errores
// ---------------------------------------------------------------------
async function escalar(s: Estado, motivo: MotivoEscalamiento, detalle: string, silencioso = false) {
  try {
    const r = await escalarAHumano({ motivo, detalle, conversacion_id: s.conversacionId });
    const cfg = await obtenerConfiguracion();
    const contacto = cfg.contacto_humano?.confirmado && cfg.contacto_humano.valor ? ` También puedes escribir a: ${cfg.contacto_humano.valor}.` : '';
    const horario = cfg.horario?.confirmado ? ` Nuestro horario es ${String(cfg.horario.valor).toLowerCase().replace(/\.$/, '')}.` : '';
    const inicio =
      motivo === 'cliente_molesto'
        ? 'Lamento mucho la molestia. Le pasé tu caso a un asesor de Don Repuestos Jaimes para que te atienda personalmente.'
        : r.ya_existia
          ? 'Tu solicitud con un asesor ya está registrada.'
          : 'Listo, le pasé tu conversación a un asesor.';
    const estado = r.notificado ? ' Ya quedó notificado.' : ' Tu solicitud quedó registrada y el equipo la verá en el panel de atención.';
    s.salida.push({ tipo: 'escalado', texto: `${inicio}${estado}${horario}${contacto}`, datos: { transferencia_id: r.id, notificado: r.notificado } });
  } catch (e) {
    void registrarEvento('error', 'escalamiento_fallido', 'No se pudo registrar el escalamiento', { error: (e as Error).message });
    if (!silencioso) s.salida.push({ tipo: 'error', texto: 'No pude registrar tu solicitud con un asesor por un problema técnico. Intenta de nuevo en un momento, por favor.' });
    else s.salida.push({ tipo: 'error', texto: 'Tampoco pude avisar a un asesor automáticamente. Intenta de nuevo en un momento, por favor.' });
  }
}

async function responderInfoNegocio(s: Estado, intenciones: Set<string>) {
  const cfg = await obtenerConfiguracion();
  const partes: string[] = [];
  const conf = (k: string) => (cfg[k]?.confirmado && cfg[k].valor !== null ? cfg[k].valor : null);
  if (intenciones.has('horario')) partes.push(conf('horario') ? `Atendemos ${String(conf('horario')).toLowerCase().replace(/\.$/, '')}.` : 'El horario está pendiente de confirmar.');
  if (intenciones.has('ubicacion')) partes.push(conf('direccion') ? `Estamos en ${conf('direccion')}.` : 'La dirección del local aún está pendiente de confirmar; un asesor te la puede compartir.');
  if (intenciones.has('pagos')) {
    const medios = (cfg.medios_pago?.valor as string[] | null) ?? [];
    partes.push(
      `Medios de pago: ${medios.map((m) => ETIQUETA_PAGO[m as DatosEntrega['metodo_pago']] ?? m).join(', ')}${cfg.medios_pago?.confirmado ? '' : ' (sujetos a confirmación del negocio)'}. Nunca te pediremos claves ni datos de tarjeta.`,
    );
  }
  if (intenciones.has('envios')) {
    partes.push(
      conf('ciudades_envio')
        ? `Enviamos a: ${Array.isArray(conf('ciudades_envio')) ? (conf('ciudades_envio') as string[]).join(', ') : conf('ciudades_envio')}.${conf('costo_envio') !== null ? '' : ' El costo te lo confirma un asesor.'}`
        : 'Las ciudades y costos de envío aún están por confirmar; un asesor te los confirma.',
    );
  }
  s.salida.push(texto(`${partes.join(' ')} ¿Te ayudo con algún repuesto?`));
}

async function manejarErrorInterno(s: Estado, e: unknown) {
  void registrarEvento('error', 'error_asistente', 'Error procesando mensaje del asistente', { error: (e as Error)?.message });
  s.salida.length = 0;
  s.salida.push({
    tipo: 'error',
    texto: 'Uy, tuve un problema técnico consultando la información. No quiero darte un dato equivocado, así que intenta de nuevo en un momento o pide hablar con un asesor.',
    acciones: [{ etiqueta: 'Hablar con un asesor', accion: { tipo: 'escalar' } }],
  });
}

function botonesCarrito(): BotonAccion[] {
  return [
    { etiqueta: 'Buscar otro repuesto', accion: { tipo: 'nueva_busqueda' } },
    { etiqueta: 'Ver cotización', accion: { tipo: 'cotizar' } },
    { etiqueta: 'Hacer pedido', accion: { tipo: 'iniciar_pedido' } },
  ];
}

function botonesConfirmacion(): BotonAccion[] {
  return [
    { etiqueta: 'Sí, confirmo el pedido', accion: { tipo: 'confirmar_pedido' } },
    { etiqueta: 'No, quiero cambiar algo', accion: { tipo: 'rechazar_confirmacion' } },
  ];
}

export const _internos = { validarCampo, resolverOpcionCategoria, CATEGORIAS };
