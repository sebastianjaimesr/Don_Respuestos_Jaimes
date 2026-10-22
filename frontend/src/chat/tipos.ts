// Tipos espejo de backend/src/asistente/tipos.ts
export type AccionEntrada =
  | { tipo: 'agregar'; producto_id: number; cantidad?: number }
  | { tipo: 'quitar'; producto_id: number }
  | { tipo: 'ver_carrito' }
  | { tipo: 'cotizar' }
  | { tipo: 'iniciar_pedido' }
  | { tipo: 'datos_entrega'; datos: Record<string, string> }
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

export interface RespuestaApi {
  mensaje_id: number;
  tipo: string;
  texto: string;
  datos?: unknown;
  acciones?: BotonAccion[];
}

export interface MensajeUI {
  id: number | string;
  rol: 'cliente' | 'asistente' | 'asesor' | 'sistema';
  texto: string;
  tipo: string;
  datos?: unknown;
  acciones: BotonAccion[];
}

export interface ProductoChat {
  producto_id: number;
  referencia: string;
  nombre: string;
  tipo: 'original' | 'generico';
  marca: string;
  precio: string | null;
  vendible: boolean;
  es_demo: boolean;
  disponibilidad: { cantidad: number | null; estado: string; tiempo_abastecimiento_dias: number | null };
  compatibilidad: { modelo: string; anio_desde: number; anio_hasta: number; verificada: boolean };
}
