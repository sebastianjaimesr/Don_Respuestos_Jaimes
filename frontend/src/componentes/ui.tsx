import { useCallback, useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ErrorApi } from '../api/cliente';
import { etiqueta } from '../api/formato';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------------
// Botones
// ---------------------------------------------------------------------
type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma';
const VARIANTES: Record<Variante, string> = {
  primario: 'bg-electrico-500 text-white hover:bg-electrico-400 disabled:bg-white/10',
  secundario: 'bg-white/[0.04] text-slate-100 border border-white/15 hover:bg-white/[0.04] disabled:text-slate-500',
  peligro: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-white/10',
  fantasma: 'text-electrico-300 hover:bg-electrico-500/10 disabled:text-slate-500',
};

export function Boton({ variante = 'primario', tamano = 'md', className, ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { variante?: Variante; tamano?: 'sm' | 'md' }) {
  return (
    <button
      type="button"
      {...p}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-colors disabled:cursor-not-allowed',
        tamano === 'sm' ? 'px-2.5 py-1.5 text-sm' : 'px-4 py-2 text-sm',
        VARIANTES[variante],
        className,
      )}
    />
  );
}

// ---------------------------------------------------------------------
// Campos de formulario
// ---------------------------------------------------------------------
function Envoltura({ etiqueta: et, ayuda, error, id, children }: { etiqueta: string; ayuda?: string; error?: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-medium text-slate-200">
        {et}
      </label>
      {children}
      {ayuda && !error && <p className="text-xs text-gris-tec">{ayuda}</p>}
      {error && <p className="text-xs text-red-300">{error}</p>}
    </div>
  );
}
const claseCampo = 'rounded-lg border border-white/15 bg-noche-900 px-3 py-2 text-sm shadow-sm focus:border-electrico-400 focus:outline-none focus:ring-2 focus:ring-electrico-500/30';

export function Campo({ etiqueta: et, ayuda, error, ...p }: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; ayuda?: string; error?: string }) {
  const id = useId();
  return (
    <Envoltura etiqueta={et} ayuda={ayuda} error={error} id={id}>
      <input id={id} {...p} className={cx(claseCampo, p.className)} aria-invalid={!!error} />
    </Envoltura>
  );
}

export function Selector({ etiqueta: et, ayuda, error, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string; ayuda?: string; error?: string }) {
  const id = useId();
  return (
    <Envoltura etiqueta={et} ayuda={ayuda} error={error} id={id}>
      <select id={id} {...p} className={cx(claseCampo, p.className)}>
        {children}
      </select>
    </Envoltura>
  );
}

export function AreaTexto({ etiqueta: et, ayuda, error, ...p }: TextareaHTMLAttributes<HTMLTextAreaElement> & { etiqueta: string; ayuda?: string; error?: string }) {
  const id = useId();
  return (
    <Envoltura etiqueta={et} ayuda={ayuda} error={error} id={id}>
      <textarea id={id} rows={3} {...p} className={cx(claseCampo, p.className)} />
    </Envoltura>
  );
}

// ---------------------------------------------------------------------
// Insignias de estado (colores con buen contraste)
// ---------------------------------------------------------------------
const COLORES: Record<string, string> = {
  verde: 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/25',
  amarillo: 'bg-amber-400/15 text-amber-200 ring-amber-400/25',
  rojo: 'bg-red-400/15 text-red-200 ring-red-400/25',
  azul: 'bg-blue-400/15 text-blue-200 ring-blue-400/25',
  gris: 'bg-white/[0.06] text-slate-200 ring-white/10',
  morado: 'bg-violet-400/15 text-violet-200 ring-violet-400/25',
};
const COLOR_ESTADO: Record<string, keyof typeof COLORES> = {
  disponible: 'verde',
  stock_bajo: 'amarillo',
  agotado: 'rojo',
  sin_registro: 'gris',
  registrado: 'azul',
  confirmado: 'verde',
  en_preparacion: 'morado',
  enviado: 'morado',
  entregado: 'verde',
  cancelado: 'gris',
  pendiente: 'amarillo',
  rechazado: 'rojo',
  reembolsado: 'gris',
  emitida: 'azul',
  aceptada: 'verde',
  vencida: 'gris',
  anulada: 'gris',
  en_atencion: 'morado',
  resuelta: 'verde',
  original: 'azul',
  generico: 'gris',
  alternativo: 'morado',
  info: 'azul',
  aviso: 'amarillo',
  error: 'rojo',
};

export function Insignia({ valor, texto, color }: { valor?: string; texto?: string; color?: keyof typeof COLORES }) {
  const c = color ?? COLOR_ESTADO[valor ?? ''] ?? 'gris';
  return <span className={cx('inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset whitespace-nowrap', COLORES[c])}>{texto ?? etiqueta(valor)}</span>;
}

export const InsigniaDemo = () => <Insignia color="amarillo" texto="DEMO · ficticio" />;
export const InsigniaPendiente = () => <Insignia color="amarillo" texto="Pendiente de confirmar" />;

// ---------------------------------------------------------------------
// Contenedores
// ---------------------------------------------------------------------
export function Tarjeta({ titulo, acciones, children, className }: { titulo?: ReactNode; acciones?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cx('rounded-xl border border-white/10 bg-noche-900 shadow-sm', className)}>
      {(titulo || acciones) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-white/[0.06] px-4 py-3">
          {titulo && <h2 className="text-base font-semibold text-white">{titulo}</h2>}
          {acciones}
        </header>
      )}
      <div className="p-4">{children}</div>
    </section>
  );
}

export function Metrica({ titulo, valor, detalle, tono = 'normal' }: { titulo: string; valor: ReactNode; detalle?: string; tono?: 'normal' | 'alerta' | 'peligro' }) {
  return (
    <div
      className={cx(
        'rounded-xl border bg-noche-900 p-4 shadow-sm',
        tono === 'alerta' ? 'border-amber-400/40' : tono === 'peligro' ? 'border-red-400/40' : 'border-white/10',
      )}
    >
      <p className="text-sm text-slate-300">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-white">{valor}</p>
      {detalle && <p className="mt-1 text-xs text-gris-tec">{detalle}</p>}
    </div>
  );
}

export function Modal({ abierto, titulo, onCerrar, children, ancho = 'max-w-2xl' }: { abierto: boolean; titulo: string; onCerrar: () => void; children: ReactNode; ancho?: string }) {
  useEffect(() => {
    if (!abierto) return;
    const f = (e: KeyboardEvent) => e.key === 'Escape' && onCerrar();
    window.addEventListener('keydown', f);
    return () => window.removeEventListener('keydown', f);
  }, [abierto, onCerrar]);
  if (!abierto) return null;
  return (
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div role="dialog" aria-modal="true" aria-label={titulo} className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-noche-900 shadow-xl sm:rounded-2xl', ancho)}>
        <header className="sticky top-0 flex items-center justify-between border-b border-white/[0.06] bg-noche-900 px-5 py-3">
          <h2 className="text-lg font-semibold">{titulo}</h2>
          <button onClick={onCerrar} aria-label="Cerrar" className="rounded-lg p-1 text-gris-tec hover:bg-white/[0.08]">
            ✕
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Alerta({ tipo = 'error', children }: { tipo?: 'error' | 'exito' | 'info' | 'aviso'; children: ReactNode }) {
  const c = { error: 'bg-red-500/10 text-red-200 border-red-400/25', exito: 'bg-emerald-500/10 text-emerald-200 border-emerald-400/25', info: 'bg-blue-500/10 text-blue-200 border-blue-400/25', aviso: 'bg-amber-500/10 text-amber-200 border-amber-400/25' }[tipo];
  return (
    <div role={tipo === 'error' ? 'alert' : 'status'} className={cx('rounded-lg border px-3 py-2 text-sm', c)}>
      {children}
    </div>
  );
}

export function Paginacion({ pagina, tamano, total, onCambiar }: { pagina: number; tamano: number; total: number; onCambiar: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / tamano));
  return (
    <nav className="flex items-center justify-between gap-2 pt-3 text-sm text-slate-300" aria-label="Paginación">
      <span>
        {total} {total === 1 ? 'resultado' : 'resultados'}
      </span>
      <div className="flex items-center gap-2">
        <Boton variante="secundario" tamano="sm" disabled={pagina <= 1} onClick={() => onCambiar(pagina - 1)}>
          Anterior
        </Boton>
        <span>
          Página {pagina} de {paginas}
        </span>
        <Boton variante="secundario" tamano="sm" disabled={pagina >= paginas} onClick={() => onCambiar(pagina + 1)}>
          Siguiente
        </Boton>
      </div>
    </nav>
  );
}

export function Tabla({ columnas, children, vacio, amplia }: { columnas: string[]; children: ReactNode; vacio?: boolean; amplia?: boolean }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4">
      <table className={cx('w-full text-left text-sm', amplia && 'min-w-[720px]')}>
        <thead>
          <tr className="border-b border-white/10 text-xs uppercase tracking-wide text-gris-tec">
            {columnas.map((c) => (
              <th key={c} scope="col" className="px-2 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-white/[0.06]">{children}</tbody>
      </table>
      {vacio && <p className="py-8 text-center text-sm text-gris-tec">No hay resultados.</p>}
    </div>
  );
}

export const Cargando = () => <p className="py-6 text-center text-sm text-gris-tec">Cargando…</p>;

/** Carga datos y expone estado de carga y error. */
export function useCarga<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [datos, setDatos] = useState<T | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [cargando, setCargando] = useState(true);
  const recargar = useCallback(() => {
    setCargando(true);
    return fn()
      .then((d) => {
        setDatos(d);
        setError(null);
      })
      .catch((e) => setError(e instanceof ErrorApi ? e.message : 'Error inesperado'))
      .finally(() => setCargando(false));
  }, deps);
  useEffect(() => {
    void recargar();
  }, [recargar]);
  return { datos, error, cargando, recargar };
}

export const mensajeError = (e: unknown) => (e instanceof ErrorApi ? e.message : 'Ocurrió un error inesperado');

/** Errores de validación del backend → { campo: mensaje } */
export function erroresPorCampo(e: unknown): Record<string, string> {
  if (!(e instanceof ErrorApi) || !Array.isArray(e.detalles)) return {};
  return Object.fromEntries((e.detalles as { campo: string; mensaje: string }[]).map((d) => [d.campo, d.mensaje]));
}
