import { m, useMotionValue, useReducedMotion, useScroll, useSpring, useTransform, type MotionValue } from 'framer-motion';
import { useRef, type PointerEvent } from 'react';
import { Iconos, irAlAsistente } from './comunes';
import { Buscador } from '../tienda/Buscador';
import { SelectorMoto } from '../tienda/SelectorMoto';
import { IMAGENES, type ImagenRepuesto } from './imagenes';

const SUAVE = [0.22, 1, 0.36, 1] as const;

export function Hero({ onAsistente }: { onAsistente: () => void }) {
  const ref = useRef<HTMLElement>(null);
  const reducido = useReducedMotion();
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] });
  const textoY = useTransform(scrollYProgress, [0, 1], [0, reducido ? 0 : -90]);
  const textoOpacidad = useTransform(scrollYProgress, [0, 0.75], [1, 0]);

  // Inclinación sutil siguiendo el puntero (solo con mouse)
  const px = useMotionValue(0);
  const py = useMotionValue(0);
  const sx = useSpring(px, { stiffness: 60, damping: 18 });
  const sy = useSpring(py, { stiffness: 60, damping: 18 });
  const mover = (e: PointerEvent) => {
    if (reducido || e.pointerType !== 'mouse') return;
    const r = e.currentTarget.getBoundingClientRect();
    px.set((e.clientX - r.left) / r.width - 0.5);
    py.set((e.clientY - r.top) / r.height - 0.5);
  };

  return (
    <section ref={ref} id="inicio" onPointerMove={mover} className="relative isolate -mt-[76px] flex min-h-[100svh] items-center overflow-hidden pt-28 pb-16 sm:pt-32 lg:pb-24">
      <FondoHero />

      <div className="relative mx-auto grid w-full max-w-6xl items-center gap-10 px-5 lg:grid-cols-[1.15fr_0.9fr] lg:gap-6">
        <m.div style={{ y: textoY, opacity: textoOpacidad }} className="relative z-20 flex flex-col items-start gap-6 text-left">
          <m.span
            initial={{ opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: SUAVE }}
            className="vidrio inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-xs font-medium text-slate-200"
          >
            <span className="h-1.5 w-1.5 rounded-full bg-cian-400 shadow-[0_0_10px_2px_rgba(0,212,255,0.8)]" />
            Don Repuestos Jaimes · Repuestos para todas las marcas
          </m.span>

          <m.h1
            initial={{ opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.08, ease: SUAVE }}
            className="font-display text-[38px] leading-[1.04] font-bold tracking-tight uppercase sm:text-6xl lg:text-[68px]"
          >
            <span className="text-white">¿Qué necesitas</span>
            <br />
            <span className="texto-electrico">para tu moto?</span>
          </m.h1>

          <m.p
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.16, ease: SUAVE }}
            className="max-w-xl text-base leading-relaxed text-gris-tec sm:text-lg"
          >
            Busca por repuesto, referencia o moto. Te mostramos originales, genéricos y alternativos con precio, disponibilidad y compatibilidad reales del inventario.
          </m.p>

          <m.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.24, ease: SUAVE }} className="w-full max-w-xl">
            <Buscador grande />
          </m.div>

          <m.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.9, delay: 0.32, ease: SUAVE }}
            className="vidrio w-full max-w-xl rounded-2xl p-3 sm:p-4"
          >
            <p className="mb-2.5 text-sm font-semibold text-white">¿Qué moto tienes?</p>
            <SelectorMoto compacto />
          </m.div>

          <m.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: 1, delay: 0.45 }} className="flex flex-wrap items-center gap-x-5 gap-y-2 text-sm text-gris-tec">
            <button type="button" onClick={() => irAlAsistente(onAsistente)} className="inline-flex items-center gap-2 font-medium text-electrico-300 transition hover:text-white">
              <Iconos.chat className="h-4 w-4" />
              ¿No sabes qué pieza es? Pregúntale a Jaimes AI
            </button>
          </m.div>
        </m.div>

        <ComposicionRepuestos progreso={scrollYProgress} sx={sx} sy={sy} reducido={!!reducido} />
      </div>

      <a
        href="#caracteristicas"
        aria-label="Bajar a las características"
        className="absolute bottom-6 left-1/2 hidden -translate-x-1/2 flex-col items-center gap-2 text-[11px] tracking-[0.25em] text-slate-500 uppercase transition hover:text-slate-300 lg:flex"
      >
        Descubre
        <span className="flex h-9 w-5 justify-center rounded-full border border-white/20 pt-1.5">
          <span className="h-2 w-1 animate-bounce rounded-full bg-electrico-400" />
        </span>
      </a>
    </section>
  );
}

function FondoHero() {
  return (
    <div aria-hidden className="absolute inset-0 -z-10">
      <div className="rejilla absolute inset-0" />
      <div className="absolute top-[-20%] right-[-10%] h-[70vmax] w-[70vmax] rounded-full bg-[radial-gradient(circle,rgba(47,107,255,0.28),transparent_60%)]" />
      <div className="absolute bottom-[-30%] left-[-20%] h-[60vmax] w-[60vmax] rounded-full bg-[radial-gradient(circle,rgba(0,212,255,0.10),transparent_60%)]" />
      <div className="absolute inset-x-0 bottom-0 h-40 bg-gradient-to-b from-transparent to-noche-950" />
    </div>
  );
}

/** Composición de repuestos en capas con parallax (scroll + puntero) y flotación suave. */
function ComposicionRepuestos({ progreso, sx, sy, reducido }: { progreso: MotionValue<number>; sx: MotionValue<number>; sy: MotionValue<number>; reducido: boolean }) {
  return (
    <m.div
      initial={{ opacity: 0, scale: 0.92 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={{ duration: 1.2, delay: 0.15, ease: SUAVE }}
      className="relative mx-auto aspect-square w-full max-w-[340px] sm:max-w-[460px] lg:max-w-[560px]"
    >
      {/* halo y anillos técnicos */}
      <div aria-hidden className="absolute inset-[8%] rounded-full bg-[radial-gradient(circle,rgba(47,107,255,0.45),rgba(47,107,255,0.08)_45%,transparent_70%)] blur-2xl" />
      <svg aria-hidden viewBox="0 0 200 200" className="absolute inset-0 h-full w-full animate-[spin_60s_linear_infinite] text-electrico-400/30 motion-reduce:animate-none">
        <circle cx="100" cy="100" r="96" fill="none" stroke="currentColor" strokeWidth="0.4" strokeDasharray="1 5" />
        <circle cx="100" cy="100" r="82" fill="none" stroke="currentColor" strokeWidth="0.3" />
        <path d="M100 4a96 96 0 0 1 67.9 28.1" fill="none" stroke="#5c8cff" strokeWidth="1.2" strokeLinecap="round" />
      </svg>
      <div aria-hidden className="absolute inset-x-[18%] bottom-[4%] h-[8%] rounded-[50%] bg-electrico-500/30 blur-2xl" />

      <Capa
        img={IMAGENES.arrastre}
        progreso={progreso}
        sx={sx}
        sy={sy}
        reducido={reducido}
        profundidad={0.5}
        desplazamiento={-40}
        className="top-[-2%] right-[-6%] w-[52%]"
        flotar="animate-flotar-lento"
        sizes="(min-width:1024px) 290px, 45vw"
      />
      <Capa
        img={IMAGENES.disco}
        progreso={progreso}
        sx={sx}
        sy={sy}
        reducido={reducido}
        profundidad={1}
        desplazamiento={-110}
        className="top-[14%] left-[6%] w-[70%]"
        flotar="animate-flotar"
        sizes="(min-width:1024px) 400px, 62vw"
        prioridad
      />
      <Capa
        img={IMAGENES.filtro}
        progreso={progreso}
        sx={sx}
        sy={sy}
        reducido={reducido}
        profundidad={1.4}
        desplazamiento={-170}
        className="right-[0%] bottom-[2%] w-[34%]"
        flotar="animate-flotar-lento"
        sizes="(min-width:1024px) 190px, 30vw"
      />
      <Capa
        img={IMAGENES.bujia}
        progreso={progreso}
        sx={sx}
        sy={sy}
        reducido={reducido}
        profundidad={1.8}
        desplazamiento={-230}
        className="bottom-[0%] left-[-4%] w-[30%]"
        flotar="animate-flotar"
        sizes="(min-width:1024px) 170px, 28vw"
      />
    </m.div>
  );
}

function Capa({
  img,
  progreso,
  sx,
  sy,
  reducido,
  profundidad,
  desplazamiento,
  className,
  flotar,
  sizes,
  prioridad = false,
}: {
  img: ImagenRepuesto;
  progreso: MotionValue<number>;
  sx: MotionValue<number>;
  sy: MotionValue<number>;
  reducido: boolean;
  profundidad: number;
  desplazamiento: number;
  className: string;
  flotar: string;
  sizes: string;
  prioridad?: boolean;
}) {
  const y = useTransform(progreso, [0, 1], [0, reducido ? 0 : desplazamiento]);
  const x2 = useTransform(sx, (v) => v * 26 * profundidad);
  const y2 = useTransform(sy, (v) => v * 20 * profundidad);
  const rot = useTransform(progreso, [0, 1], [0, reducido ? 0 : 12 * profundidad]);
  return (
    <m.div style={{ y, rotate: rot }} className={`absolute ${className}`}>
      <m.div style={{ x: x2, y: y2 }}>
        <div className={flotar} style={{ animationDelay: `${-profundidad * 2}s` }}>
          <img
            src={img.src}
            srcSet={img.srcSet}
            sizes={sizes}
            alt={img.alt}
            width={480}
            height={480}
            decoding="async"
            loading={prioridad ? 'eager' : 'lazy'}
            {...(prioridad ? ({ fetchpriority: 'high' } as Record<string, string>) : {})}
            draggable={false}
            className="h-auto w-full drop-shadow-[0_30px_40px_rgba(0,0,0,0.6)] select-none"
          />
        </div>
      </m.div>
    </m.div>
  );
}
