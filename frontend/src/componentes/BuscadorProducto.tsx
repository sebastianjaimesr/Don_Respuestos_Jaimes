import { useEffect, useId, useState } from 'react';
import { apiAdmin, qs } from '../api/cliente';
import { cop } from '../api/formato';

export interface ProductoBreve {
  id: number;
  sku: string;
  nombre: string;
  precio: string | null;
  cantidad?: number;
}

/** Busca productos del panel por nombre o referencia y devuelve el elegido. */
export function BuscadorProducto({ etiqueta = 'Producto', onElegir, placeholder = 'Nombre o referencia', excluir = [] }: { etiqueta?: string; onElegir: (p: ProductoBreve) => void; placeholder?: string; excluir?: number[] }) {
  const id = useId();
  const [q, setQ] = useState('');
  const [res, setRes] = useState<ProductoBreve[]>([]);
  const [abierto, setAbierto] = useState(false);
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) return setRes([]);
    let vivo = true;
    const espera = setTimeout(() => {
      apiAdmin<{ items: ProductoBreve[] }>(`/admin/productos${qs({ q: t, tamano: 8 })}`)
        .then((r) => vivo && setRes(r.items))
        .catch(() => vivo && setRes([]));
    }, 250);
    return () => {
      vivo = false;
      clearTimeout(espera);
    };
  }, [q]);
  const visibles = res.filter((p) => !excluir.includes(p.id));
  return (
    <div className="relative">
      <label htmlFor={id} className="mb-1 block text-sm font-medium text-slate-200">
        {etiqueta}
      </label>
      <input
        id={id}
        value={q}
        onChange={(e) => {
          setQ(e.target.value);
          setAbierto(true);
        }}
        onFocus={() => setAbierto(true)}
        onBlur={() => setTimeout(() => setAbierto(false), 150)}
        placeholder={placeholder}
        autoComplete="off"
        className="w-full rounded-lg border border-white/15 bg-noche-900 px-3 py-2 text-sm focus:border-electrico-400 focus:ring-2 focus:ring-electrico-500/30 focus:outline-none"
      />
      {abierto && visibles.length > 0 && (
        <ul role="listbox" className="absolute inset-x-0 top-full z-50 mt-1 max-h-64 overflow-y-auto rounded-lg border border-white/10 bg-noche-800 p-1 shadow-2xl">
          {visibles.map((p) => (
            <li key={p.id} role="option" aria-selected={false}>
              <button
                type="button"
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onElegir(p);
                  setQ('');
                  setAbierto(false);
                }}
                className="flex w-full items-center justify-between gap-3 rounded-md px-2 py-1.5 text-left text-sm hover:bg-white/[0.06]"
              >
                <span className="min-w-0 truncate">
                  <span className="font-mono text-xs text-gris-tec">{p.sku}</span> {p.nombre}
                </span>
                <span className="shrink-0 text-xs text-gris-tec">
                  {p.precio ? cop(p.precio) : 'sin precio'}
                  {p.cantidad !== undefined ? ` · ${p.cantidad} u.` : ''}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
