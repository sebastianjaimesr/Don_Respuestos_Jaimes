import { useCallback, useEffect, useId, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes, type TextareaHTMLAttributes } from 'react';
import { ErrorApi } from '../api/cliente';
import { etiqueta } from '../api/formato';

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ');

// ---------------------------------------------------------------------
// Botones
// ---------------------------------------------------------------------
type Variante = 'primario' | 'secundario' | 'peligro' | 'fantasma';
const VARIANTES: Record<Variante, string> = {
  primario: 'bg-marca-700 text-white hover:bg-marca-800 disabled:bg-slate-300',
  secundario: 'bg-white text-slate-800 border border-slate-300 hover:bg-slate-50 disabled:text-slate-400',
  peligro: 'bg-red-600 text-white hover:bg-red-700 disabled:bg-slate-300',
  fantasma: 'text-marca-700 hover:bg-marca-50 disabled:text-slate-400',
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
      <label htmlFor={id} className="text-sm font-medium text-slate-700">
        {et}
      </label>
      {children}
      {ayuda && !error && <p className="text-xs text-slate-500">{ayuda}</p>}
      {error && <p className="text-xs text-red-700">{error}</p>}
    </div>
  );
}
const claseCampo = 'rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm shadow-sm focus:border-marca-600 focus:outline-none focus:ring-2 focus:ring-marca-100';

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
  verde: 'bg-emerald-100 text-emerald-800 ring-emerald-200',
  amarillo: 'bg-amber-100 text-amber-900 ring-amber-200',
  rojo: 'bg-red-100 text-red-800 ring-red-200',
  azul: 'bg-blue-100 text-blue-800 ring-blue-200',
  gris: 'bg-slate-100 text-slate-700 ring-slate-200',
  morado: 'bg-violet-100 text-violet-800 ring-violet-200',
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
    <section className={cx('rounded-xl border border-slate-200 bg-white shadow-sm', className)}>
      {(titulo || acciones) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {titulo && <h2 className="text-base font-semibold text-slate-900">{titulo}</h2>}
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
        'rounded-xl border bg-white p-4 shadow-sm',
        tono === 'alerta' ? 'border-amber-300' : tono === 'peligro' ? 'border-red-300' : 'border-slate-200',
      )}
    >
      <p className="text-sm text-slate-600">{titulo}</p>
      <p className="mt-1 text-2xl font-semibold tabular-nums text-slate-900">{valor}</p>
      {detalle && <p className="mt-1 text-xs text-slate-500">{detalle}</p>}
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
    <div className="fixed inset-0 z-40 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && onCerrar()}>
      <div role="dialog" aria-modal="true" aria-label={titulo} className={cx('max-h-[92vh] w-full overflow-y-auto rounded-t-2xl bg-white shadow-xl sm:rounded-2xl', ancho)}>
        <header className="sticky top-0 flex items-center justify-between border-b border-slate-100 bg-white px-5 py-3">
          <h2 className="text-lg font-semibold">{titulo}</h2>
          <button onClick={onCerrar} aria-label="Cerrar" className="rounded-lg p-1 text-slate-500 hover:bg-slate-100">
            ✕
          </button>
        </header>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function Alerta({ tipo = 'error', children }: { tipo?: 'error' | 'exito' | 'info' | 'aviso'; children: ReactNode }) {
  const c = { error: 'bg-red-50 text-red-800 border-red-200', exito: 'bg-emerald-50 text-emerald-800 border-emerald-200', info: 'bg-blue-50 text-blue-800 border-blue-200', aviso: 'bg-amber-50 text-amber-900 border-amber-200' }[tipo];
  return (
    <div role={tipo === 'error' ? 'alert' : 'status'} className={cx('rounded-lg border px-3 py-2 text-sm', c)}>
      {children}
    </div>
  );
}

export function Paginacion({ pagina, tamano, total, onCambiar }: { pagina: number; tamano: number; total: number; onCambiar: (p: number) => void }) {
  const paginas = Math.max(1, Math.ceil(total / tamano));
  return (
    <nav className="flex items-center justify-between gap-2 pt-3 text-sm text-slate-600" aria-label="Paginación">
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
          <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
            {columnas.map((c) => (
              <th key={c} scope="col" className="px-2 py-2 font-medium">
                {c}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">{children}</tbody>
      </table>
      {vacio && <p className="py-8 text-center text-sm text-slate-500">No hay resultados.</p>}
    </div>
  );
}

export const Cargando = () => <p className="py-6 text-center text-sm text-slate-500">Cargando…</p>;

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
