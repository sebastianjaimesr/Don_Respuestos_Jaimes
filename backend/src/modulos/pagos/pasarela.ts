/**
 * Contrato que cumple cualquier pasarela de pagos (hoy Wompi; mañana PayU o
 * Mercado Pago). Reglas que no cambian con la pasarela:
 * - El monto y la referencia salen SIEMPRE del servidor, nunca del navegador.
 * - Un pago solo queda "aprobado" cuando llega un evento firmado por la pasarela
 *   (o cuando un asesor lo registra a mano). Volver a la tienda después de pagar
 *   NO confirma nada: esa URL la puede abrir cualquiera.
 */
export interface IntencionPago {
  proveedor: 'wompi';
  /** Página de pago de la pasarela a la que se envía al cliente. */
  url: string;
  referencia: string;
  monto_centavos: number;
}

export type EstadoPasarela = 'aprobado' | 'rechazado' | 'pendiente';

export interface EventoPago {
  proveedor: 'wompi';
  /** Nuestra referencia (la que mandamos al crear la intención). */
  referencia: string;
  /** Id de la transacción en la pasarela. */
  transaccion: string;
  estado: EstadoPasarela;
  monto_centavos: number;
  moneda: string;
  metodo: string | null;
  payload: unknown;
}

export interface PasarelaPagos {
  nombre: 'wompi';
  crearIntencion(datos: { referencia: string; monto_centavos: number; url_retorno: string | null }): IntencionPago;
  /** Devuelve el evento si la firma es válida; si no, null (el evento se rechaza). */
  verificarEvento(cuerpo: unknown, encabezadoChecksum?: string): EventoPago | null;
}
