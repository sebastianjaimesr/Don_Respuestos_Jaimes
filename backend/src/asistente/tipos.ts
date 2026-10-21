/** Tipos compartidos del asistente conversacional. */

export interface DatosEntrega {
  nombre: string;
  telefono: string;
  ciudad: string;
  modalidad: 'recogida_tienda' | 'envio';
  direccion: string;
  metodo_pago: 'nequi' | 'daviplata' | 'transferencia' | 'efectivo' | 'contraentrega';
}

export interface Contexto {
  etapa: 'consulta' | 'datos_entrega' | 'confirmacion';
  saludado: boolean;
  moto: { modelo_id?: number; modelo?: string; anio?: number };
  candidatos_modelo: { id: number; nombre: string }[];
  consulta: { categoria?: string; posicion?: 'delantero' | 'trasero'; tipo?: 'original' | 'generico' | null; opciones_categoria?: string[] };
  esperando: 'modelo' | 'anio' | 'categoria' | 'posicion' | null;
  /** Productos mostrados en la última búsqueda (en orden) y cuáles se pueden vender */
  ultimos_resultados: { producto_id: number; vendible: boolean; razon?: string }[];
  carrito: { producto_id: number; cantidad: number }[];
  entrega: Partial<DatosEntrega>;
  campo_pendiente: keyof DatosEntrega | null;
  cotizacion_codigo: string | null;
  pedidos_realizados: number;
  no_entendidos: number;
}

export const contextoInicial = (): Contexto => ({
  etapa: 'consulta',
  saludado: false,
  moto: {},
  candidatos_modelo: [],
  consulta: {},
  esperando: null,
  ultimos_resultados: [],
  carrito: [],
  entrega: {},
  campo_pendiente: null,
  cotizacion_codigo: null,
  pedidos_realizados: 0,
  no_entendidos: 0,
});

/** Acciones estructuradas que envían los botones del chat web. */
export type AccionEntrada =
  | { tipo: 'agregar'; producto_id: number; cantidad?: number }
  | { tipo: 'quitar'; producto_id: number }
  | { tipo: 'ver_carrito' }
  | { tipo: 'cotizar' }
  | { tipo: 'iniciar_pedido' }
  | { tipo: 'datos_entrega'; datos: Partial<DatosEntrega> }
  | { tipo: 'confirmar_pedido' }
  | { tipo: 'rechazar_confirmacion' }
  | { tipo: 'escalar' }
  | { tipo: 'elegir_modelo'; modelo_id: number }
  | { tipo: 'elegir_categoria'; categoria: string }
  | { tipo: 'elegir_posicion'; posicion: 'delantero' | 'trasero' }
  | { tipo: 'nueva_busqueda' };

export interface BotonAccion {
  etiqueta: string;
  accion: AccionEntrada;
}

export type TipoRespuesta = 'texto' | 'productos' | 'carrito' | 'cotizacion' | 'formulario_entrega' | 'resumen_pedido' | 'pedido_registrado' | 'escalado' | 'error';

/** Cada respuesta trae `texto` (sirve para WhatsApp/Telegram) y `datos` opcionales para el chat web. */
export interface Respuesta {
  tipo: TipoRespuesta;
  texto: string;
  datos?: unknown;
  acciones?: BotonAccion[];
}
