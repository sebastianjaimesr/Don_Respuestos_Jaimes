import { m } from 'framer-motion';
import type { ReactNode } from 'react';

const SUAVE = [0.22, 1, 0.36, 1] as const;

/** Aparición suave al entrar en pantalla (una sola vez). */
export function Revelar({ children, className, retraso = 0, y = 28 }: { children: ReactNode; className?: string; retraso?: number; y?: number }) {
  return (
    <m.div className={className} initial={{ opacity: 0, y }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true, margin: '-60px' }} transition={{ duration: 0.8, delay: retraso, ease: SUAVE }}>
      {children}
    </m.div>
  );
}

export function EncabezadoSeccion({ etiqueta, titulo, texto, centrado = true }: { etiqueta: string; titulo: ReactNode; texto?: ReactNode; centrado?: boolean }) {
  return (
    <Revelar className={`flex max-w-2xl flex-col gap-4 ${centrado ? 'mx-auto items-center text-center' : 'items-start'}`}>
      <span className="inline-flex items-center gap-2 rounded-full border border-electrico-400/25 bg-electrico-500/10 px-3 py-1 text-[11px] font-semibold tracking-[0.18em] text-electrico-300 uppercase">
        <span className="h-1.5 w-1.5 rounded-full bg-electrico-400 shadow-[0_0_10px_2px_rgba(77,141,255,0.8)]" />
        {etiqueta}
      </span>
      <h2 className="font-display text-3xl leading-tight font-semibold tracking-tight text-white sm:text-4xl lg:text-[44px]">{titulo}</h2>
      {texto && <p className="text-base leading-relaxed text-slate-400 sm:text-lg">{texto}</p>}
    </Revelar>
  );
}

/** Botón/enlace principal con brillo eléctrico y microinteracción. */
export function BotonPrincipal({
  children,
  href,
  onClick,
  variante = 'primario',
  className = '',
}: {
  children: ReactNode;
  href?: string;
  onClick?: () => void;
  variante?: 'primario' | 'vidrio';
  className?: string;
}) {
  const estilo =
    variante === 'primario'
      ? 'bg-gradient-to-br from-electrico-400 via-electrico-500 to-electrico-600 text-white shadow-[0_14px_40px_-12px_rgba(37,99,255,0.95)] hover:shadow-[0_18px_50px_-10px_rgba(37,99,255,1)]'
      : 'vidrio text-white hover:border-electrico-400/50 hover:bg-white/10';
  const clase = `group relative inline-flex items-center justify-center gap-2.5 overflow-hidden rounded-2xl px-6 py-3.5 text-[15px] font-semibold transition duration-300 hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.98] ${estilo} ${className}`;
  const interior = (
    <>
      {variante === 'primario' && (
        <span
          aria-hidden
          className="pointer-events-none absolute inset-0 -translate-x-full bg-gradient-to-r from-transparent via-white/30 to-transparent transition-transform duration-700 group-hover:translate-x-full"
        />
      )}
      <span className="relative inline-flex items-center gap-2.5">{children}</span>
    </>
  );
  if (href)
    return (
      <a href={href} onClick={onClick} className={clase}>
        {interior}
      </a>
    );
  return (
    <button type="button" onClick={onClick} className={clase}>
      {interior}
    </button>
  );
}

export function Logo({ compacto = false }: { compacto?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <svg viewBox="0 0 40 40" className="h-9 w-9 shrink-0" aria-hidden>
        <defs>
          <linearGradient id="logo-g" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#8fb6ff" />
            <stop offset="0.5" stopColor="#2563ff" />
            <stop offset="1" stopColor="#1546f0" />
          </linearGradient>
        </defs>
        {/* engranaje/disco estilizado con las iniciales */}
        <path d="M20 2.5 34.5 10.8v18.4L20 37.5 5.5 29.2V10.8Z" fill="url(#logo-g)" />
        <path d="M20 6.5 31 12.8v14.4L20 33.5 9 27.2V12.8Z" fill="#070b16" />
        <text x="20" y="24.6" textAnchor="middle" fontFamily="Sora Variable, Inter Variable, sans-serif" fontWeight="700" fontSize="12.5" letterSpacing="-0.4" fill="#fff">D<tspan fill="#8fb6ff">J</tspan></text>
      </svg>
      {!compacto && (
        <span className="flex flex-col leading-none">
          <span className="font-display text-[15px] font-semibold tracking-tight text-white">Don Repuestos</span>
          <span className="text-[10px] font-semibold tracking-[0.32em] text-electrico-300 uppercase">Jaimes</span>
        </span>
      )}
    </span>
  );
}

/** Lleva al asistente y, si se indica, le envía una consulta. */
export function irAlAsistente(alLlegar?: () => void) {
  // Se centra el panel del chat (no el título de la sección) para que se vea completo también en celular
  const panel = document.getElementById('panel-asistente') ?? document.getElementById('asistente');
  panel?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  if (alLlegar) setTimeout(alLlegar, 500);
}

// ---------------------------------------------------------------------
// Íconos
// ---------------------------------------------------------------------
type PropsIcono = { className?: string };
const Svg = ({ className, children }: PropsIcono & { children: ReactNode }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    {children}
  </svg>
);
export const Iconos = {
  escudo: (p: PropsIcono) => (
    <Svg {...p}>
      <path d="M12 3 4.5 6v5.5c0 4.6 3.2 8.4 7.5 9.5 4.3-1.1 7.5-4.9 7.5-9.5V6Z" />
      <path d="m8.8 12 2.3 2.3 4.3-4.6" />
    </Svg>
  ),
  rayo: (p: PropsIcono) => (
    <Svg {...p}>
      <path d="M13 2.5 4.5 13.5H12l-1 8 8.5-11H12Z" />
    </Svg>
  ),
  medalla: (p: PropsIcono) => (
    <Svg {...p}>
      <circle cx="12" cy="9" r="5.5" />
      <path d="m9.3 13.8-1.8 7.2 4.5-2.4 4.5 2.4-1.8-7.2" />
      <path d="m10 9 1.4 1.4L14 7.8" />
    </Svg>
  ),
  flecha: (p: PropsIcono) => (
    <Svg {...p}>
      <path d="M5 12h13M13 6l6 6-6 6" />
    </Svg>
  ),
  chat: (p: PropsIcono) => (
    <Svg {...p}>
      <path d="M20 12a8 8 0 0 1-11.6 7.1L4 20l1-4.1A8 8 0 1 1 20 12Z" />
      <path d="M8.5 11h.01M12 11h.01M15.5 11h.01" strokeWidth={2.6} />
    </Svg>
  ),
  lupa: (p: PropsIcono) => (
    <Svg {...p}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m20 20-4.2-4.2" />
    </Svg>
  ),
  check: (p: PropsIcono) => (
    <Svg {...p}>
      <path d="M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z" />
      <path d="m8.5 12 2.4 2.4 4.6-4.8" />
    </Svg>
  ),
  documento: (p: PropsIcono) => (
    <Svg {...p}>
      <path d="M7 3h7l5 5v13H7z" />
      <path d="M14 3v5h5M10 13h6M10 17h6" />
    </Svg>
  ),
  camion: (p: PropsIcono) => (
    <Svg {...p}>
      <path d="M2.5 6.5h11v9h-11zM13.5 9.5h4l3 3.2v2.8h-7" />
      <circle cx="6.5" cy="17.5" r="1.8" />
      <circle cx="17" cy="17.5" r="1.8" />
    </Svg>
  ),
  persona: (p: PropsIcono) => (
    <Svg {...p}>
      <circle cx="12" cy="8" r="3.8" />
      <path d="M4.5 20.5c1.2-3.6 4-5.5 7.5-5.5s6.3 1.9 7.5 5.5" />
    </Svg>
  ),
  reloj: (p: PropsIcono) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </Svg>
  ),
  ubicacion: (p: PropsIcono) => (
    <Svg {...p}>
      <path d="M12 21s-6.5-5.8-6.5-11a6.5 6.5 0 0 1 13 0c0 5.2-6.5 11-6.5 11Z" />
      <circle cx="12" cy="10" r="2.3" />
    </Svg>
  ),
  tarjeta: (p: PropsIcono) => (
    <Svg {...p}>
      <rect x="3" y="5.5" width="18" height="13" rx="2.5" />
      <path d="M3 10h18M7 15h3" />
    </Svg>
  ),
  telefono: (p: PropsIcono) => (
    <Svg {...p}>
      <path d="M5 4h3.5l1.5 4-2 1.3a10 10 0 0 0 6.7 6.7L16 14l4 1.5V19a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2Z" />
    </Svg>
  ),
  engranaje: (p: PropsIcono) => (
    <Svg {...p}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </Svg>
  ),
  menu: (p: PropsIcono) => (
    <Svg {...p}>
      <path d="M4 7h16M4 12h16M4 17h10" />
    </Svg>
  ),
  cerrar: (p: PropsIcono) => (
    <Svg {...p}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Svg>
  ),
};
