import { useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router';
import { ErrorApi } from '../api/cliente';
import { cop } from '../api/formato';
import type { Disponibilidad, Promocion, Tarjeta, TipoRepuesto } from '../api/tienda';
import { Iconos } from '../inicio/comunes';
import { IMAGEN_POR_CATEGORIA } from '../inicio/imagenes';
import { useTienda } from './estado';

export const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

export const mensajeError = (e: unknown) => (e instanceof ErrorApi ? e.message : 'Ocurrió un error inesperado. Intenta de nuevo.');

// ---------------------------------------------------------------------
// Botones y campos (tema oscuro)
// ---------------------------------------------------------------------
type VarianteBoton = 'primario' | 'secundario' | 'fantasma' | 'peligro';
const ESTILO_BOTON: Record<VarianteBoton, string> = {
  primario: 'bg-gradient-to-br from-electrico-400 to-electrico-600 text-white shadow-[0_10px_30px_-12px_rgba(47,107,255,1)] hover:brightness-110',
  secundario: 'border border-white/15 bg-white/[0.04] text-slate-100 hover:border-electrico-400/50 hover:bg-white/[0.08]',
  fantasma: 'text-slate-300 hover:bg-white/[0.06] hover:text-white',
  peligro: 'border border-rose-400/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20',
};
export function Boton({ variante = 'primario', className, cargando, children, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: VarianteBoton; cargando?: boolean }) {
  return (
    <button
      type="button"
      {...p}
      disabled={p.disabled || cargando}
      className={cx(
        'inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition duration-200 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
        ESTILO_BOTON[variante],
        className,
      )}
    >
      {cargando && <span aria-hidden className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />}
      {children}
    </button>
  );
}

const claseCampo =
  'w-full rounded-xl border border-white/10 bg-noche-900/80 px-3.5 py-2.5 text-[15px] text-white placeholder:text-gris-tec focus:border-electrico-400 focus:outline-none focus:ring-2 focus:ring-electrico-500/30';

function Envoltura({ etiqueta, id, error, ayuda, children }: { etiqueta: string; id: string; error?: string; ayuda?: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-sm font-medium text-slate-200">
        {etiqueta}
      </label>
      {children}
      {ayuda && !error && <p className="text-xs text-gris-tec">{ayuda}</p>}
      {error && (
        <p id={`${id}-error`} className="text-xs text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
export function Campo({ etiqueta, error, ayuda, id, ...p }: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; error?: string; ayuda?: string; id: string }) {
  return (
    <Envoltura etiqueta={etiqueta} id={id} error={error} ayuda={ayuda}>
      <input id={id} aria-invalid={!!error} aria-describedby={error ? `${id}-error` : undefined} className={claseCampo} {...p} />
    </Envoltura>
  );
}
export function Selector({ etiqueta, error, id, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string; error?: string; id: string }) {
  return (
    <Envoltura etiqueta={etiqueta} id={id} error={error}>
      <select id={id} className={claseCampo} {...p}>
        {children}
      </select>
    </Envoltura>
  );
}
export function AreaTexto({ etiqueta, error, id, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { etiqueta: string; error?: string; id: string }) {
  return (
    <Envoltura etiqueta={etiqueta} id={id} error={error}>
      <textarea id={id} rows={3} className={claseCampo} {...p} />
    </Envoltura>
  );
}

/** Errores de validación del backend (Zod) por campo: { "cliente.telefono": "…" } */
export function erroresPorCampo(e: unknown): Record<string, string> {
  if (!(e instanceof ErrorApi) || !Array.isArray(e.detalles)) return {};
  const r: Record<string, string> = {};
  for (const d of e.detalles as { campo?: string; ruta?: string; mensaje?: string }[]) {
    const k = d.campo ?? d.ruta;
    if (k && d.mensaje) r[k] = d.mensaje;
  }
  return r;
}

// ---------------------------------------------------------------------
// Estados de carga, error y vacío
// ---------------------------------------------------------------------
export function Esqueleto({ className }: { className?: string }) {
  return <div aria-hidden className={cx('animate-pulse rounded-2xl bg-white/[0.05]', className)} />;
}
export function EstadoError({ error, reintentar }: { error: unknown; reintentar?: () => void }) {
  return (
    <div role="alert" className="vidrio mx-auto flex max-w-lg flex-col items-center gap-4 rounded-3xl p-8 text-center">
      <p className="text-slate-200">{mensajeError(error)}</p>
      {reintentar && (
        <Boton variante="secundario" onClick={reintentar}>
          Reintentar
        </Boton>
      )}
    </div>
  );
}
export function EstadoVacio({ titulo, texto, children }: { titulo: string; texto?: ReactNode; children?: ReactNode }) {
  return (
    <div className="vidrio mx-auto flex max-w-lg flex-col items-center gap-3 rounded-3xl p-8 text-center">
      <span className="grid h-14 w-14 place-items-center rounded-2xl bg-electrico-500/10 text-electrico-300 ring-1 ring-electrico-400/20">
        <Iconos.lupa className="h-7 w-7" />
      </span>
      <h2 className="font-display text-lg font-semibold text-white">{titulo}</h2>
      {texto && <p className="text-sm text-gris-tec">{texto}</p>}
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------
// Datos de producto
// ---------------------------------------------------------------------
export function etiquetaTipo(tipo: TipoRepuesto, marca: string) {
  return tipo === 'original' ? `Original ${marca}` : tipo === 'alternativo' ? `Alternativo · ${marca}` : `Genérico · ${marca}`;
}
export function InsigniaTipo({ tipo, marca }: { tipo: TipoRepuesto; marca: string }) {
  return (
    <span
      className={cx(
        'inline-flex items-center rounded-full px-2.5 py-0.5 text-[11px] font-semibold',
        tipo === 'original' ? 'bg-electrico-500/20 text-electrico-300 ring-1 ring-electrico-400/30' : 'bg-white/10 text-slate-300',
      )}
    >
      {etiquetaTipo(tipo, marca)}
    </span>
  );
}
export const InsigniaDemo = () => (
  <span title="Producto de demostración: los datos no son reales" className="inline-flex items-center rounded-full bg-amber-400/15 px-2.5 py-0.5 text-[11px] font-semibold text-amber-200 ring-1 ring-amber-300/20">
    Demo ficticio
  </span>
);

const DISPONIBILIDAD: Record<Disponibilidad, { texto: string; clase: string }> = {
  disponible: { texto: 'Disponible', clase: 'text-emerald-300' },
  stock_bajo: { texto: 'Últimas unidades', clase: 'text-amber-300' },
  agotado: { texto: 'Agotado', clase: 'text-rose-300' },
  sin_registro: { texto: 'Disponibilidad por confirmar', clase: 'text-gris-tec' },
};
export function TextoDisponibilidad({ estado, className }: { estado: Disponibilidad; className?: string }) {
  const d = DISPONIBILIDAD[estado];
  return (
    <span className={cx('inline-flex items-center gap-1.5 text-xs font-medium', d.clase, className)}>
      <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
      {d.texto}
    </span>
  );
}

/** Precio confirmado (con promoción si hay) o "por confirmar". Nunca inventa un valor. */
export function Precio({ precio, promocion, grande = false }: { precio: string | null; promocion?: Promocion | null; grande?: boolean }) {
  if (precio === null) return <span className={cx('font-medium text-gris-tec', grande ? 'text-lg' : 'text-sm')}>Precio por confirmar</span>;
  return (
    <span className="flex flex-wrap items-baseline gap-x-2">
      <span className={cx('font-display font-semibold text-white', grande ? 'text-3xl' : 'text-lg')}>{cop(precio)}</span>
      {promocion && (
        <>
          <s className={cx('text-gris-tec', grande ? 'text-base' : 'text-xs')}>{cop(promocion.precio_antes)}</s>
          <span className="rounded-full bg-cian-400/15 px-2 py-0.5 text-[11px] font-semibold text-cian-300 ring-1 ring-cian-400/25">{promocion.nombre}</span>
        </>
      )}
    </span>
  );
}

/** Foto del producto o, si no tiene, la ilustración de su categoría (marcada como ilustración). */
export function ImagenProducto({ url, alt, categoria, className }: { url: string | null; alt: string; categoria: string; className?: string }) {
  const [fallo, setFallo] = useState(false);
  const ilustracion = IMAGEN_POR_CATEGORIA[categoria];
  if (url && !fallo) {
    return <img src={url} alt={alt} loading="lazy" decoding="async" onError={() => setFallo(true)} className={cx('h-full w-full object-contain', className)} />;
  }
  return (
    <div className={cx('relative grid h-full w-full place-items-center', className)}>
      <div aria-hidden className="absolute inset-[22%] rounded-full bg-electrico-500/20 blur-2xl" />
      {ilustracion ? (
        <img src={ilustracion.src} srcSet={ilustracion.srcSet} sizes="240px" alt="" loading="lazy" decoding="async" className="relative h-[78%] w-[78%] object-contain opacity-90" />
      ) : (
        <Iconos.engranaje className="relative h-1/3 w-1/3 text-electrico-300/60" />
      )}
      <span className="absolute bottom-2 left-2 rounded-md bg-noche-950/70 px-1.5 py-0.5 text-[10px] text-gris-tec">Ilustración</span>
    </div>
  );
}

export function TarjetaProducto({ p }: { p: Tarjeta }) {
  const { agregar } = useTienda();
  const [estado, setEstado] = useState<{ cargando: boolean; mensaje: string | null; ok: boolean }>({ cargando: false, mensaje: null, ok: false });
  const vendible = p.precio !== null && (p.disponibilidad === 'disponible' || p.disponibilidad === 'stock_bajo');
  const sumar = async () => {
    setEstado({ cargando: true, mensaje: null, ok: false });
    try {
      await agregar(p.id, 1);
      setEstado({ cargando: false, mensaje: 'Agregado al carrito', ok: true });
    } catch (e) {
      setEstado({ cargando: false, mensaje: mensajeError(e), ok: false });
    }
  };
  return (
    <article className="group vidrio relative flex h-full flex-col overflow-hidden rounded-3xl p-3 transition duration-300 hover:-translate-y-1 hover:border-electrico-400/40 hover:shadow-[0_24px_50px_-30px_rgba(47,107,255,0.9)] sm:p-4">
      <Link to={`/producto/${p.slug}`} className="flex flex-1 flex-col gap-3 rounded-2xl focus-visible:outline-offset-4">
        <div className="relative aspect-square overflow-hidden rounded-2xl bg-noche-900/60">
          <ImagenProducto url={p.imagen} alt={p.nombre} categoria={p.categoria.clave} className="transition duration-500 group-hover:scale-105" />
        </div>
        <div className="flex flex-wrap gap-1.5">
          <InsigniaTipo tipo={p.tipo} marca={p.marca} />
          {p.es_demo && <InsigniaDemo />}
        </div>
        <div className="flex flex-1 flex-col gap-1">
          <h3 className="font-display text-[15px] leading-snug font-semibold text-white">{p.nombre}</h3>
          <p className="text-xs text-gris-tec">
            {p.categoria.etiqueta}
            {p.posicion ? ` · ${p.posicion}` : ''} · Ref. {p.sku}
          </p>
        </div>
        <Precio precio={p.precio} promocion={p.promocion} />
        <TextoDisponibilidad estado={p.disponibilidad} />
      </Link>
      <div className="mt-3">
        {vendible ? (
          <Boton className="w-full" onClick={sumar} cargando={estado.cargando} aria-label={`Agregar ${p.nombre} al carrito`}>
            Agregar al carrito
          </Boton>
        ) : (
          <Link
            to={`/producto/${p.slug}`}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-xl border border-white/15 px-4 text-sm font-semibold text-slate-200 transition hover:bg-white/[0.06]"
          >
            {p.precio === null ? 'Consultar precio' : 'Ver detalles'}
          </Link>
        )}
        <p aria-live="polite" className={cx('mt-1.5 min-h-4 text-center text-xs', estado.ok ? 'text-emerald-300' : 'text-rose-300')}>
          {estado.mensaje}
        </p>
      </div>
    </article>
  );
}

export function GrillaProductos({ productos }: { productos: Tarjeta[] }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:gap-5 md:grid-cols-3 xl:grid-cols-4">
      {productos.map((p) => (
        <li key={p.id}>
          <TarjetaProducto p={p} />
        </li>
      ))}
    </ul>
  );
}

export function Contenedor({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cx('mx-auto w-full max-w-6xl px-4 sm:px-5', className)}>{children}</div>;
}
