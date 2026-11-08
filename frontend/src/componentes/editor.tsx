import { useState, type FormEvent, type ReactNode } from 'react';
import { Alerta, AreaTexto, Boton, Campo, Modal, Selector, erroresPorCampo, mensajeError } from './ui';

/**
 * Formulario genérico para los datos maestros del panel (fabricantes, modelos,
 * categorías, marcas, proveedores, tarifas…). Cada campo dice cómo convertir el
 * texto del formulario al tipo que espera la API; los errores de validación del
 * servidor se muestran junto a cada campo.
 */
export type TipoCampo = 'texto' | 'numero' | 'dinero' | 'bool' | 'lista' | 'select' | 'area' | 'fecha_hora' | 'email';

export interface DefCampo {
  k: string;
  etiqueta: string;
  tipo?: TipoCampo;
  opciones?: { v: string; t: string }[];
  /** En un select: el valor se envía como número */
  numerico?: boolean;
  requerido?: boolean;
  ayuda?: string;
  ancho?: boolean;
  /** Se oculta según los demás valores */
  visible?: (v: Record<string, string>) => boolean;
  placeholder?: string;
}

type Valores = Record<string, string>;

/** Convierte un registro de la API en texto para el formulario. */
export function aTexto(campos: DefCampo[], fila?: Record<string, unknown> | null): Valores {
  const v: Valores = {};
  for (const c of campos) {
    const x = fila?.[c.k];
    if (c.tipo === 'bool') v[c.k] = x === undefined || x === null ? (c.k === 'activo' ? 'true' : 'false') : String(Boolean(x));
    else if (c.tipo === 'lista') v[c.k] = Array.isArray(x) ? x.join(', ') : '';
    else if (c.tipo === 'fecha_hora') v[c.k] = typeof x === 'string' ? aLocal(x) : '';
    else if (c.tipo === 'dinero' || c.tipo === 'numero') v[c.k] = x === null || x === undefined ? '' : String(Number(x));
    else v[c.k] = x === null || x === undefined ? '' : String(x);
  }
  return v;
}

/** Convierte el formulario al cuerpo de la API. Los vacíos opcionales se envían como null. */
export function aCuerpo(campos: DefCampo[], v: Valores) {
  const o: Record<string, unknown> = {};
  for (const c of campos) {
    if (c.visible && !c.visible(v)) continue;
    const s = (v[c.k] ?? '').trim();
    if (c.tipo === 'bool') o[c.k] = s === 'true';
    else if (c.tipo === 'lista') o[c.k] = s ? s.split(',').map((x) => x.trim()).filter(Boolean) : [];
    else if (c.tipo === 'numero' || c.tipo === 'dinero' || (c.tipo === 'select' && c.numerico)) o[c.k] = s === '' ? (c.requerido ? undefined : null) : Number(s);
    else if (c.tipo === 'fecha_hora') o[c.k] = s ? deLocal(s) : undefined;
    else o[c.k] = s === '' ? (c.requerido ? '' : null) : s;
  }
  return o;
}

// Fechas: el formulario usa hora local (Colombia, -05:00 sin horario de verano)
const aLocal = (iso: string) => {
  const d = new Date(new Date(iso).getTime() - 5 * 3600_000);
  return d.toISOString().slice(0, 16);
};
const deLocal = (s: string) => `${s}:00-05:00`;

export function CamposFormulario({ campos, v, set, errores }: { campos: DefCampo[]; v: Valores; set: (k: string, x: string) => void; errores: Record<string, string> }) {
  return (
    <>
      {campos
        .filter((c) => !c.visible || c.visible(v))
        .map((c) => {
          const comun = { etiqueta: c.etiqueta + (c.requerido ? '' : ' (opcional)'), ayuda: c.ayuda, error: errores[c.k] };
          const envoltura = (n: ReactNode) => (
            <div key={c.k} className={c.ancho || c.tipo === 'area' ? 'sm:col-span-2' : ''}>
              {n}
            </div>
          );
          if (c.tipo === 'bool')
            return envoltura(
              <label className="flex items-center gap-2 pt-6 text-sm text-slate-200">
                <input type="checkbox" className="h-4 w-4 accent-electrico-500" checked={v[c.k] === 'true'} onChange={(e) => set(c.k, String(e.target.checked))} />
                {c.etiqueta}
              </label>,
            );
          if (c.tipo === 'select')
            return envoltura(
              <Selector {...comun} etiqueta={c.etiqueta} value={v[c.k]} onChange={(e) => set(c.k, e.target.value)} required={c.requerido}>
                <option value="">{c.requerido ? 'Elige una opción' : '—'}</option>
                {c.opciones?.map((o) => (
                  <option key={o.v} value={o.v}>
                    {o.t}
                  </option>
                ))}
              </Selector>,
            );
          if (c.tipo === 'area') return envoltura(<AreaTexto {...comun} value={v[c.k]} onChange={(e) => set(c.k, e.target.value)} placeholder={c.placeholder} />);
          return envoltura(
            <Campo
              {...comun}
              type={c.tipo === 'numero' || c.tipo === 'dinero' ? 'number' : c.tipo === 'fecha_hora' ? 'datetime-local' : c.tipo === 'email' ? 'email' : 'text'}
              step={c.tipo === 'dinero' ? '0.01' : undefined}
              inputMode={c.tipo === 'numero' ? 'numeric' : c.tipo === 'dinero' ? 'decimal' : undefined}
              value={v[c.k]}
              required={c.requerido}
              placeholder={c.placeholder ?? (c.tipo === 'lista' ? 'Separados por coma' : undefined)}
              onChange={(e) => set(c.k, e.target.value)}
            />,
          );
        })}
    </>
  );
}

/** Ventana con el formulario. `guardar` recibe el cuerpo listo para la API. */
export function EditorModal({
  titulo,
  campos,
  fila,
  abierto,
  onCerrar,
  guardar,
  extra,
}: {
  titulo: string;
  campos: DefCampo[];
  fila?: Record<string, unknown> | null;
  abierto: boolean;
  onCerrar: () => void;
  guardar: (cuerpo: Record<string, unknown>) => Promise<unknown>;
  extra?: ReactNode;
}) {
  return (
    <Modal abierto={abierto} titulo={titulo} onCerrar={onCerrar}>
      {abierto && <FormEditor campos={campos} fila={fila} guardar={guardar} onListo={onCerrar} extra={extra} />}
    </Modal>
  );
}

function FormEditor({ campos, fila, guardar, onListo, extra }: { campos: DefCampo[]; fila?: Record<string, unknown> | null; guardar: (c: Record<string, unknown>) => Promise<unknown>; onListo: () => void; extra?: ReactNode }) {
  const [v, setV] = useState(() => aTexto(campos, fila));
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setGuardando(true);
    setError(null);
    setErrores({});
    try {
      await guardar(aCuerpo(campos, v));
      onListo();
    } catch (err) {
      setErrores(erroresPorCampo(err));
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  };
  return (
    <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-2" noValidate>
      {error && (
        <div className="sm:col-span-2">
          <Alerta>{error}</Alerta>
        </div>
      )}
      <CamposFormulario campos={campos} v={v} set={(k, x) => setV((o) => ({ ...o, [k]: x }))} errores={errores} />
      {extra && <div className="sm:col-span-2">{extra}</div>}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Boton type="button" variante="secundario" onClick={onListo}>
          Cancelar
        </Boton>
        <Boton type="submit" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </Boton>
      </div>
    </form>
  );
}

/** Interruptor visual de activo / inactivo para las tablas. */
export const EstadoActivo = ({ activo }: { activo: boolean }) => (
  <span className={`inline-flex items-center gap-1.5 text-xs font-medium ${activo ? 'text-emerald-300' : 'text-gris-tec'}`}>
    <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-current" />
    {activo ? 'Activo' : 'Inactivo'}
  </span>
);

/** Pestañas simples y accesibles. */
export function Pestanas<T extends string>({ opciones, valor, onCambiar }: { opciones: { v: T; t: string }[]; valor: T; onCambiar: (v: T) => void }) {
  return (
    <div role="tablist" className="mb-4 inline-flex flex-wrap gap-1 rounded-xl bg-white/[0.04] p-1">
      {opciones.map((o) => (
        <button
          key={o.v}
          role="tab"
          type="button"
          aria-selected={valor === o.v}
          onClick={() => onCambiar(o.v)}
          className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${valor === o.v ? 'bg-electrico-500 text-white' : 'text-gris-tec hover:text-white'}`}
        >
          {o.t}
        </button>
      ))}
    </div>
  );
}
