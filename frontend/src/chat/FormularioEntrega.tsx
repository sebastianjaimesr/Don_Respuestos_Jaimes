import { useId, useState, type FormEvent, type InputHTMLAttributes, type ReactNode, type SelectHTMLAttributes } from 'react';
import { BotonChat } from './BotonChat';

/** Formulario de datos de entrega dentro del chat (el backend vuelve a validar todo). */
export function FormularioEntrega({ valores, onEnviar }: { valores: Record<string, string>; onEnviar: (d: Record<string, string>) => void }) {
  const [d, setD] = useState<Record<string, string>>({ modalidad: 'recogida_tienda', metodo_pago: '', ...valores });
  const set = (k: string) => (e: { target: { value: string } }) => setD((x) => ({ ...x, [k]: e.target.value }));
  const enviar = (e: FormEvent) => {
    e.preventDefault();
    const datos = { ...d };
    if (datos.modalidad !== 'envio') delete datos.direccion;
    onEnviar(datos);
  };
  return (
    <form onSubmit={enviar} aria-label="Datos de entrega" className="w-full rounded-2xl border border-electrico-400/25 bg-noche-900/70 p-4 shadow-[0_20px_50px_-25px_rgba(37,99,255,0.7)]">
      <div className="mb-4 flex items-center gap-2.5">
        <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-electrico-500/20 text-electrico-300 ring-1 ring-electrico-400/30">
          <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7h11v9H3zM14 10h4l3 3v3h-7" />
            <circle cx="7" cy="17.5" r="1.8" />
            <circle cx="17" cy="17.5" r="1.8" />
          </svg>
        </span>
        <div>
          <h3 className="font-display text-[15px] font-semibold text-white">Datos de entrega</h3>
          <p className="text-xs text-slate-400">Los revisas antes de confirmar el pedido.</p>
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <CampoChat etiqueta="Nombre" value={d.nombre ?? ''} onChange={set('nombre')} required autoComplete="name" />
        <CampoChat etiqueta="Celular" value={d.telefono ?? ''} onChange={set('telefono')} required inputMode="tel" autoComplete="tel" placeholder="3001234567" />
        <CampoChat etiqueta="Ciudad" value={d.ciudad ?? ''} onChange={set('ciudad')} required autoComplete="address-level2" />
        <SelectorChat etiqueta="Entrega" value={d.modalidad} onChange={set('modalidad')}>
          <option value="recogida_tienda">Recojo en tienda</option>
          <option value="envio">Envío (costo por confirmar)</option>
        </SelectorChat>
        {d.modalidad === 'envio' && (
          <div className="sm:col-span-2">
            <CampoChat etiqueta="Dirección completa" value={d.direccion ?? ''} onChange={set('direccion')} required autoComplete="street-address" placeholder="Calle 10 # 20-30, barrio Centro" />
          </div>
        )}
        <SelectorChat etiqueta="Medio de pago" value={d.metodo_pago} onChange={set('metodo_pago')} required ayuda="Sujeto a confirmación del negocio. No pedimos datos de tarjeta.">
          <option value="" disabled>
            Elige uno
          </option>
          <option value="nequi">Nequi</option>
          <option value="daviplata">Daviplata</option>
          <option value="transferencia">Transferencia</option>
          <option value="efectivo">Efectivo</option>
          <option value="contraentrega">Contraentrega</option>
        </SelectorChat>
        <div className="flex items-end sm:justify-end">
          <BotonChat type="submit" className="w-full py-2.5 sm:w-auto">
            Revisar pedido
            <svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M5 12h13M13 6l6 6-6 6" />
            </svg>
          </BotonChat>
        </div>
      </div>
    </form>
  );
}

const claseCampo =
  'w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-sm text-white placeholder:text-slate-500 [color-scheme:dark] transition focus:border-electrico-400/70 focus:bg-white/[0.07] focus:outline-none focus:ring-4 focus:ring-electrico-500/15';

function Envoltura({ etiqueta, ayuda, id, children }: { etiqueta: string; ayuda?: string; id: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-xs font-medium tracking-wide text-slate-300">
        {etiqueta}
      </label>
      {children}
      {ayuda && <p className="text-[11px] text-slate-500">{ayuda}</p>}
    </div>
  );
}

function CampoChat({ etiqueta, ayuda, ...p }: InputHTMLAttributes<HTMLInputElement> & { etiqueta: string; ayuda?: string }) {
  const id = useId();
  return (
    <Envoltura etiqueta={etiqueta} ayuda={ayuda} id={id}>
      <input id={id} {...p} className={claseCampo} />
    </Envoltura>
  );
}

function SelectorChat({ etiqueta, ayuda, children, ...p }: SelectHTMLAttributes<HTMLSelectElement> & { etiqueta: string; ayuda?: string }) {
  const id = useId();
  return (
    <Envoltura etiqueta={etiqueta} ayuda={ayuda} id={id}>
      <select id={id} {...p} className={claseCampo.replace('bg-white/[0.04]', 'bg-noche-800')}>
        {children}
      </select>
    </Envoltura>
  );
}
