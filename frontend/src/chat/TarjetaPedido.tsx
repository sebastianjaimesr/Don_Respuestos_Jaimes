import type { MensajeUI } from './tipos';

/**
 * Presenta carrito, cotización, resumen y pedido registrado como un "ticket".
 * Se arma a partir del mismo texto que envía el backend (que también sirve para
 * WhatsApp/Telegram), así no se duplica ni se inventa ningún dato.
 */
const TIPOS = {
  carrito: { titulo: 'Tu pedido', chip: 'Carrito', tono: 'electrico' },
  cotizacion: { titulo: 'Cotización', chip: 'Cotización emitida', tono: 'electrico' },
  resumen_pedido: { titulo: 'Revisión del pedido', chip: 'Por confirmar', tono: 'ambar' },
  pedido_registrado: { titulo: 'Pedido registrado', chip: 'Confirmado', tono: 'esmeralda' },
} as const;

export const esTarjetaPedido = (tipo: string): tipo is keyof typeof TIPOS => tipo in TIPOS;

const CLAVES_RESUMEN = /^(Subtotal|Envío|Total|Entrega|Pago|A nombre de|Vigente hasta):\s*/;

export function TarjetaPedido({ m }: { m: MensajeUI }) {
  const cfg = TIPOS[m.tipo as keyof typeof TIPOS];
  const lineas = m.texto.split('\n').filter((l) => l.trim());
  const [primera, ...resto] = lineas;
  const items = resto
    .filter((l) => l.startsWith('• '))
    .map((l) => {
      const t = l.slice(2);
      const corte = t.lastIndexOf(' — ');
      return corte > 0 ? { nombre: t.slice(0, corte), valor: t.slice(corte + 3) } : { nombre: t, valor: '' };
    });
  const filas = resto
    .filter((l) => CLAVES_RESUMEN.test(l))
    .map((l) => {
      const i = l.indexOf(':');
      return { clave: l.slice(0, i), valor: l.slice(i + 1).trim().replace(/(\d)\.$/, '$1') };
    });
  const notas = resto.filter((l) => !l.startsWith('• ') && !CLAVES_RESUMEN.test(l));
  const codigo = m.tipo === 'pedido_registrado' ? ((m.datos as { codigo?: string } | undefined)?.codigo ?? primera.match(/código (\S+?)\.?$/)?.[1]) : null;

  const tono =
    cfg.tono === 'esmeralda'
      ? { borde: 'border-emerald-400/30', chip: 'bg-emerald-400/15 text-emerald-200 ring-emerald-400/30', brillo: 'from-emerald-400/20' }
      : cfg.tono === 'ambar'
        ? { borde: 'border-amber-300/25', chip: 'bg-amber-300/15 text-amber-100 ring-amber-300/30', brillo: 'from-amber-300/10' }
        : { borde: 'border-electrico-400/25', chip: 'bg-electrico-500/20 text-electrico-300 ring-electrico-400/30', brillo: 'from-electrico-500/15' };

  return (
    <article data-tipo={m.tipo} className={`relative w-full overflow-hidden rounded-2xl rounded-bl-md border bg-noche-900/70 text-sm ${tono.borde}`}>
      <div aria-hidden className={`pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b ${tono.brillo} to-transparent`} />
      <header className="relative flex items-center justify-between gap-3 px-4 pt-4">
        <div className="flex items-center gap-2.5">
          {m.tipo === 'pedido_registrado' ? (
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-emerald-400/20 text-emerald-300 ring-1 ring-emerald-400/40">
              <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round">
                <path d="m5 12.5 4.5 4.5L19 7.5" />
              </svg>
            </span>
          ) : (
            <span aria-hidden className="grid h-9 w-9 place-items-center rounded-full bg-white/[0.06] text-electrico-300 ring-1 ring-white/10">
              <svg viewBox="0 0 24 24" className="h-[18px] w-[18px]" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round">
                <path d="M6 3h12v18l-3-2-3 2-3-2-3 2V3Z" />
                <path d="M9 8h6M9 12h6" />
              </svg>
            </span>
          )}
          <h3 className="font-display text-[15px] font-semibold text-white">{cfg.titulo}</h3>
        </div>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ${tono.chip}`}>{cfg.chip}</span>
      </header>

      <div className="relative flex flex-col gap-3 px-4 pt-3 pb-4">
        <p className="text-slate-300">{primera}</p>
        {codigo && (
          <p className="flex items-center justify-between rounded-xl border border-emerald-400/25 bg-emerald-400/10 px-3 py-2">
            <span className="text-xs text-emerald-200">Código del pedido</span>
            <span className="font-mono text-base font-semibold tracking-wide text-white">{codigo}</span>
          </p>
        )}
        {items.length > 0 && (
          <ul className="flex flex-col divide-y divide-white/[0.06] rounded-xl border border-white/[0.07] bg-white/[0.03]">
            {items.map((it, i) => (
              <li key={i} className="flex items-start justify-between gap-3 px-3 py-2">
                <span className="text-slate-200">{it.nombre}</span>
                {it.valor && <span className="shrink-0 text-right font-medium tabular-nums text-white">{it.valor}</span>}
              </li>
            ))}
          </ul>
        )}
        {filas.length > 0 && (
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 border-t border-dashed border-white/10 pt-3">
            {filas.map((f, i) => (
              <div key={i} className="contents">
                <dt className={f.clave === 'Total' ? 'font-semibold text-white' : 'text-slate-400'}>{f.clave}</dt>
                <dd className={`text-right ${f.clave === 'Total' ? 'font-display text-base font-semibold tabular-nums text-white' : 'text-slate-200'}`}>{f.valor}</dd>
              </div>
            ))}
          </dl>
        )}
        {notas.map((n, i) => (
          <p key={i} className="text-slate-300">
            {n}
          </p>
        ))}
      </div>
    </article>
  );
}
