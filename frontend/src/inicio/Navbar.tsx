import { AnimatePresence, m } from 'framer-motion';
import { useEffect, useState } from 'react';
import { Iconos, Logo, irAlAsistente } from './comunes';

const ENLACES = [
  { href: '#inicio', texto: 'Inicio' },
  { href: '#catalogo', texto: 'Catálogo' },
  { href: '#servicios', texto: 'Servicios' },
  { href: '#contacto', texto: 'Contacto' },
];

export function Navbar({ onAsistente }: { onAsistente: () => void }) {
  const [compacta, setCompacta] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const [activa, setActiva] = useState('#inicio');

  useEffect(() => {
    const alDesplazar = () => setCompacta(window.scrollY > 24);
    alDesplazar();
    window.addEventListener('scroll', alDesplazar, { passive: true });
    return () => window.removeEventListener('scroll', alDesplazar);
  }, []);

  // Resalta la sección visible
  useEffect(() => {
    const ids = [...ENLACES.map((e) => e.href.slice(1)), 'asistente'];
    const obs = new IntersectionObserver(
      (entradas) => {
        for (const e of entradas) if (e.isIntersecting) setActiva(`#${e.target.id}`);
      },
      { rootMargin: '-45% 0px -50% 0px' },
    );
    ids.forEach((id) => {
      const el = document.getElementById(id);
      if (el) obs.observe(el);
    });
    return () => obs.disconnect();
  }, []);

  const asistente = () => {
    setAbierto(false);
    irAlAsistente(onAsistente);
  };

  return (
    <header className="fixed inset-x-0 top-0 z-50 px-3 pt-3 sm:px-5">
      <nav
        aria-label="Principal"
        className={`mx-auto flex max-w-6xl items-center justify-between gap-4 rounded-2xl px-3 py-2.5 transition-all duration-500 sm:px-4 ${compacta || abierto ? 'vidrio bg-noche-900/70 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.8)]' : 'border border-transparent'}`}
      >
        <a href="#inicio" aria-label="Don Repuestos Jaimes, ir al inicio" className="rounded-xl">
          <Logo />
        </a>

        <ul className="hidden items-center gap-1 md:flex">
          {ENLACES.map((e) => (
            <li key={e.href}>
              <a
                href={e.href}
                aria-current={activa === e.href ? 'true' : undefined}
                className={`relative rounded-xl px-3.5 py-2 text-sm font-medium transition ${activa === e.href ? 'text-white' : 'text-slate-400 hover:text-white'}`}
              >
                {e.texto}
                <span
                  aria-hidden
                  className={`absolute inset-x-3 -bottom-0.5 h-0.5 origin-left rounded-full bg-gradient-to-r from-electrico-400 to-cian-400 transition-transform duration-300 ${activa === e.href ? 'scale-x-100' : 'scale-x-0'}`}
                />
              </a>
            </li>
          ))}
        </ul>

        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={asistente}
            className="group relative hidden items-center gap-2 overflow-hidden rounded-xl bg-gradient-to-br from-electrico-400 to-electrico-600 px-4 py-2.5 text-sm font-semibold text-white shadow-[0_10px_30px_-10px_rgba(37,99,255,1)] transition hover:-translate-y-0.5 hover:brightness-110 active:scale-95 sm:inline-flex"
          >
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-white/70" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-white" />
            </span>
            Asistente Virtual
          </button>
          <button
            type="button"
            onClick={() => setAbierto((x) => !x)}
            aria-expanded={abierto}
            aria-controls="menu-movil"
            aria-label={abierto ? 'Cerrar menú' : 'Abrir menú'}
            className="grid h-10 w-10 place-items-center rounded-xl text-slate-200 transition hover:bg-white/10 md:hidden"
          >
            {abierto ? <Iconos.cerrar className="h-6 w-6" /> : <Iconos.menu className="h-6 w-6" />}
          </button>
        </div>
      </nav>

      <AnimatePresence>
        {abierto && (
          <m.div
            id="menu-movil"
            initial={{ opacity: 0, y: -10, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -10, scale: 0.98 }}
            transition={{ duration: 0.25, ease: 'easeOut' }}
            className="vidrio mx-auto mt-2 max-w-6xl rounded-2xl bg-noche-900/90 p-2 md:hidden"
          >
            <ul className="flex flex-col">
              {ENLACES.map((e) => (
                <li key={e.href}>
                  <a href={e.href} onClick={() => setAbierto(false)} className="block rounded-xl px-4 py-3 text-[15px] font-medium text-slate-200 hover:bg-white/10">
                    {e.texto}
                  </a>
                </li>
              ))}
              <li className="p-1">
                <button type="button" onClick={asistente} className="mt-1 w-full rounded-xl bg-gradient-to-br from-electrico-400 to-electrico-600 px-4 py-3 text-[15px] font-semibold text-white">
                  Asistente Virtual
                </button>
              </li>
            </ul>
          </m.div>
        )}
      </AnimatePresence>
    </header>
  );
}
