import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router';
import { tienda, type Sugerencias } from '../api/tienda';
import { Iconos } from '../inicio/comunes';
import { cx } from './ui';

type Opcion = { clave: string; texto: string; detalle: string; ir: string };

/** Buscador con autocompletado (productos, categorías y motos) y teclado accesible. */
export function Buscador({ grande = false, alBuscar, autoFocus = false }: { grande?: boolean; alBuscar?: () => void; autoFocus?: boolean }) {
  const navegar = useNavigate();
  const id = useId();
  const [q, setQ] = useState('');
  const [sug, setSug] = useState<Sugerencias | null>(null);
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState(-1);
  const caja = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) {
      setSug(null);
      return;
    }
    let vivo = true;
    const espera = setTimeout(() => {
      tienda
        .sugerencias(t)
        .then((s) => vivo && setSug(s))
        .catch(() => vivo && setSug(null));
    }, 220);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [q]);

  useEffect(() => {
    const fuera = (e: MouseEvent) => !caja.current?.contains(e.target as Node) && setAbierto(false);
    document.addEventListener('mousedown', fuera);
    return () => document.removeEventListener('mousedown', fuera);
  }, []);

  const opciones: Opcion[] = sug
    ? [
        ...sug.motos.map((m) => ({ clave: `m${m.id}`, texto: `${m.fabricante} ${m.nombre}`, detalle: 'Moto', ir: `/catalogo?fabricante=${m.fabricante_id}&modelo=${m.id}` })),
        ...sug.categorias.map((c) => ({ clave: `c${c.clave}`, texto: c.etiqueta, detalle: 'Categoría', ir: `/catalogo?categoria=${c.clave}` })),
        ...sug.productos.map((p) => ({ clave: `p${p.slug}`, texto: p.nombre, detalle: p.sku, ir: `/producto/${p.slug}` })),
      ]
    : [];

  const ir = (ruta: string) => {
    setAbierto(false);
    setActiva(-1);
    alBuscar?.();
    navegar(ruta);
  };
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    if (activa >= 0 && opciones[activa]) return ir(opciones[activa].ir);
    const t = q.trim();
    ir(t ? `/catalogo?q=${encodeURIComponent(t)}` : '/catalogo');
  };
  const teclas = (e: KeyboardEvent) => {
    if (!opciones.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setAbierto(true);
      setActiva((a) => (a + 1) % opciones.length);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiva((a) => (a <= 0 ? opciones.length - 1 : a - 1));
    } else if (e.key === 'Escape') setAbierto(false);
  };
  const mostrar = abierto && opciones.length > 0;

  return (
    <div ref={caja} className="relative w-full">
      <form role="search" onSubmit={enviar} className="relative">
        <label htmlFor={`${id}-q`} className="sr-only">
          Buscar repuestos
        </label>
        <Iconos.lupa className={cx('pointer-events-none absolute top-1/2 -translate-y-1/2 text-gris-tec', grande ? 'left-5 h-6 w-6' : 'left-3.5 h-5 w-5')} />
        <input
          id={`${id}-q`}
          type="search"
          role="combobox"
          aria-expanded={mostrar}
          aria-controls={`${id}-lista`}
          aria-activedescendant={activa >= 0 ? `${id}-op-${activa}` : undefined}
          autoComplete="off"
          autoFocus={autoFocus}
          value={q}
          maxLength={80}
          onChange={(e) => {
            setQ(e.target.value);
            setAbierto(true);
            setActiva(-1);
          }}
          onFocus={() => setAbierto(true)}
          onKeyDown={teclas}
          placeholder={grande ? 'Ej.: pastillas NKD 125' : 'Buscar repuesto, referencia o moto'}
          className={cx(
            'w-full rounded-2xl border border-white/10 bg-noche-900/80 text-white placeholder:text-gris-tec focus:border-electrico-400 focus:outline-none focus:ring-2 focus:ring-electrico-500/30',
            grande ? 'py-4.5 pr-32 pl-14 text-base sm:text-lg' : 'py-2.5 pr-3 pl-11 text-sm',
          )}
        />
        {grande && (
          <button
            type="submit"
            className="absolute top-1/2 right-2 -translate-y-1/2 rounded-xl bg-gradient-to-br from-electrico-400 to-electrico-600 px-5 py-3 text-sm font-semibold text-white shadow-[0_10px_30px_-12px_rgba(47,107,255,1)] transition hover:brightness-110"
          >
            Buscar
          </button>
        )}
      </form>
      {mostrar && (
        <ul id={`${id}-lista`} role="listbox" className="vidrio absolute inset-x-0 top-full z-50 mt-2 max-h-80 overflow-y-auto rounded-2xl bg-noche-900/95 p-1.5 shadow-2xl">
          {opciones.map((o, i) => (
            <li
              key={o.clave}
              id={`${id}-op-${i}`}
              role="option"
              aria-selected={i === activa}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => ir(o.ir)}
              className={cx('flex cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm', i === activa ? 'bg-electrico-500/20 text-white' : 'text-slate-200 hover:bg-white/[0.06]')}
            >
              <span className="truncate">{o.texto}</span>
              <span className="shrink-0 text-xs text-gris-tec">{o.detalle}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
