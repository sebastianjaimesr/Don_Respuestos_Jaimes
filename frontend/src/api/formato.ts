export function cop(valor: string | number | null | undefined): string {
  if (valor === null || valor === undefined || valor === '') return '—';
  const n = typeof valor === 'number' ? valor : Number(valor);
  return n.toLocaleString('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: n % 1 ? 2 : 0 });
}

export function fecha(v: string | null | undefined, conHora = true): string {
  if (!v) return '—';
  return new Date(v).toLocaleString('es-CO', {
    timeZone: 'America/Bogota',
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    ...(conHora ? { hour: '2-digit', minute: '2-digit' } : {}),
  });
}

export const ETIQUETAS: Record<string, string> = {
  // pedidos
  registrado: 'Registrado',
  confirmado: 'Confirmado',
  en_preparacion: 'En preparación',
  enviado: 'Enviado',
  entregado: 'Entregado',
  cancelado: 'Cancelado',
  // pago
  pendiente: 'Pendiente',
  rechazado: 'Rechazado',
  reembolsado: 'Reembolsado',
  // cotización
  emitida: 'Emitida',
  aceptada: 'Aceptada',
  vencida: 'Vencida',
  anulada: 'Anulada',
  // stock
  disponible: 'Disponible',
  stock_bajo: 'Stock bajo',
  agotado: 'Agotado',
  sin_registro: 'Sin registro',
  // atención
  en_atencion: 'En atención',
  resuelta: 'Resuelta',
  // otros
  original: 'Original',
  generico: 'Genérico',
  recogida_tienda: 'Recoge en tienda',
  envio: 'Envío',
  nequi: 'Nequi',
  daviplata: 'Daviplata',
  transferencia: 'Transferencia',
  efectivo: 'Efectivo',
  contraentrega: 'Contraentrega',
  admin: 'Administrador',
  vendedor: 'Vendedor',
  consulta: 'Solo consulta',
  solicitud_cliente: 'Pidió un asesor',
  cliente_molesto: 'Cliente molesto',
  compatibilidad_dudosa: 'Compatibilidad dudosa',
  datos_faltantes: 'Datos faltantes',
  precio_no_confirmado: 'Precio sin confirmar',
  producto_agotado: 'Producto agotado',
  error_sistema: 'Error del sistema',
  otro: 'Otro',
  delantero: 'Delantero',
  trasero: 'Trasero',
};
export const etiqueta = (k: string | null | undefined) => (k ? ETIQUETAS[k] ?? k : '—');
