import { api, qs } from './cliente';

/** Tipos espejo de backend/src/modulos/catalogo/publico.ts y ventas/carrito.ts */
export type TipoRepuesto = 'original' | 'generico' | 'alternativo';
export type Disponibilidad = 'disponible' | 'stock_bajo' | 'agotado' | 'sin_registro';

export interface Promocion {
  nombre: string;
  precio_antes: string;
  termina_at?: string;
}

export interface Tarjeta {
  id: number;
  slug: string;
  sku: string;
  referencia: string | null;
  nombre: string;
  tipo: TipoRepuesto;
  marca: string;
  categoria: { clave: string; etiqueta: string };
  posicion: 'delantero' | 'trasero' | null;
  precio: string | null;
  precio_confirmado: boolean;
  promocion: Promocion | null;
  disponibilidad: Disponibilidad;
  imagen: string | null;
  destacado: boolean;
  es_demo: boolean;
}

export interface Compatibilidad {
  fabricante: string;
  modelo_id: number;
  modelo: string;
  version: string | null;
  anio_desde: number;
  anio_hasta: number;
  verificada: boolean;
  notas: string | null;
}

export interface DetalleProducto extends Tarjeta {
  descripcion: string | null;
  especificaciones: Record<string, string | number | boolean>;
  grupo: { clave: string; etiqueta: string } | null;
  stock: { cantidad: number | null; tiempo_abastecimiento_dias: number | null };
  imagenes: { url: string; alt: string | null; es_principal: boolean }[];
  compatibilidades: Compatibilidad[];
  advertencia_seguridad: boolean;
}

export interface Pagina<T> {
  items: T[];
  total: number;
  pagina: number;
  tamano: number;
}

export interface GrupoCategorias {
  clave: string;
  etiqueta: string;
  categorias: { clave: string; etiqueta: string; requierePosicion: boolean; seguridad: boolean }[];
}

export interface Fabricante {
  id: number;
  nombre: string;
  slug: string;
  logo_url: string | null;
  modelos: number;
}
export interface ModeloMoto {
  id: number;
  nombre: string;
  cilindraje_cc: number | null;
  anio_inicio: number | null;
  anio_fin: number | null;
}

export interface Sugerencias {
  productos: { slug: string; nombre: string; sku: string }[];
  categorias: { clave: string; etiqueta: string }[];
  motos: { id: number; nombre: string; fabricante_id: number; fabricante: string }[];
}

export interface ItemCarrito {
  producto_id: number;
  slug: string;
  sku: string;
  nombre: string;
  tipo: TipoRepuesto;
  marca: string;
  cantidad: number;
  precio_unitario: string | null;
  promocion: { nombre: string; precio_antes: string } | null;
  subtotal: string | null;
  disponibles: number | null;
  problema: 'producto_inactivo' | 'precio_no_confirmado' | 'agotado' | 'stock_insuficiente' | null;
  es_demo: boolean;
}
export interface Carrito {
  id: string;
  estado: 'activo' | 'convertido' | 'abandonado';
  items: ItemCarrito[];
  subtotal: string;
  listo_para_pedido: boolean;
}

export interface PedidoCreado {
  pedido: {
    codigo: string;
    estado: string;
    estado_pago: string;
    modalidad_entrega: 'recogida_tienda' | 'envio';
    subtotal: string;
    costo_envio: string;
    envio_confirmado: boolean;
    total: string;
    lineas: { descripcion: string; referencia: string; cantidad: number; precio_unitario: string; subtotal: string }[];
    idempotente?: boolean;
  };
  whatsapp: string | null;
}

export interface Cliente {
  id: number;
  nombre: string;
  email: string;
  telefono?: string;
}

export type FiltrosCatalogo = Partial<Record<'q' | 'categoria' | 'fabricante' | 'modelo' | 'anio' | 'tipo' | 'precio_min' | 'precio_max' | 'disponible' | 'orden' | 'pagina', string>>;

export const tienda = {
  productos: (f: FiltrosCatalogo & { tamano?: number }) => api<Pagina<Tarjeta>>(`/catalogo/productos${qs(f)}`),
  producto: (slug: string) => api<DetalleProducto>(`/catalogo/productos/${encodeURIComponent(slug)}`),
  relacionados: (slug: string) => api<Tarjeta[]>(`/catalogo/productos/${encodeURIComponent(slug)}/relacionados`),
  destacados: () => api<Tarjeta[]>('/catalogo/destacados'),
  sugerencias: (q: string) => api<Sugerencias>(`/catalogo/sugerencias${qs({ q })}`, { esperaMs: 15_000 }),
  categorias: () => api<GrupoCategorias[]>('/catalogo/categorias'),
  fabricantes: () => api<Fabricante[]>('/catalogo/fabricantes'),
  modelos: (fabricanteId: number) => api<ModeloMoto[]>(`/catalogo/fabricantes/${fabricanteId}/modelos`),

  crearCarrito: () => api<Carrito>('/carritos', { metodo: 'POST' }),
  carrito: (id: string) => api<Carrito>(`/carritos/${id}`),
  fijarItem: (id: string, productoId: number, cantidad: number) => api<Carrito>(`/carritos/${id}/items/${productoId}`, { metodo: 'PUT', cuerpo: { cantidad } }),
  quitarItem: (id: string, productoId: number) => api<Carrito>(`/carritos/${id}/items/${productoId}`, { metodo: 'DELETE' }),
  checkout: (id: string, datos: unknown) => api<PedidoCreado>(`/carritos/${id}/checkout`, { metodo: 'POST', cuerpo: datos, encabezados: { 'Idempotency-Key': `carrito-${id}` } }),
  seguimiento: (codigo: string, telefono: string) =>
    api<{ codigo: string; estado: string; estado_pago: string; modalidad_entrega: string; total: string; envio_confirmado: boolean; created_at: string }>(
      `/pedidos/seguimiento${qs({ codigo, telefono })}`,
    ),

  registro: (d: { nombre: string; email: string; telefono: string; password: string; ciudad?: string }) =>
    api<{ cliente: Cliente; csrf: string }>('/clientes/registro', { metodo: 'POST', cuerpo: d }),
  ingresar: (email: string, password: string) => api<{ cliente: Cliente; csrf: string }>('/clientes/sesion', { metodo: 'POST', cuerpo: { email, password } }),
  salir: () => api<unknown>('/clientes/sesion', { metodo: 'DELETE' }),
  yo: () => api<{ cliente: Cliente; csrf: string | null }>('/clientes/yo'),
  misPedidos: () =>
    api<{ codigo: string; estado: string; estado_pago: string; modalidad_entrega: string; total: string; envio_confirmado: boolean; items: number; created_at: string }[]>(
      '/clientes/yo/pedidos',
    ),
  favoritos: () => api<{ producto_id: number; slug: string; sku: string; nombre: string; precio: string | null; promocion: string | null; precio_lista: string | null; tipo: TipoRepuesto; disponibilidad: Disponibilidad }[]>('/clientes/yo/favoritos'),
  agregarFavorito: (id: number) => api<unknown[]>(`/clientes/yo/favoritos/${id}`, { metodo: 'PUT' }),
  quitarFavorito: (id: number) => api<unknown[]>(`/clientes/yo/favoritos/${id}`, { metodo: 'DELETE' }),
  fusionarCarrito: (carritoId: string) => api<Carrito>('/clientes/yo/carrito/fusionar', { metodo: 'POST', cuerpo: { carrito_id: carritoId } }),
};
