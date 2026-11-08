import { AnimatePresence, LazyMotion, MotionConfig, domAnimation, m } from 'framer-motion';
import { Suspense, useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { Iconos, Logo } from '../inicio/comunes';
import { Pie } from '../inicio/Secciones';
import { Buscador } from './Buscador';
import { useTienda } from './estado';
import { cx } from './ui';

const ENLACES = [
  { a: '/catalogo', texto: 'Catálogo' },
  { a: '/asistente', texto: 'Jaimes AI' },
];

/** Marco común de la tienda: encabezado con buscador y carrito, contenido y pie. */
export function LayoutTienda() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo({ top: 0 });
  }, [pathname]);
  return (
    <LazyMotion features={domAnimation} strict>
      <MotionConfig reducedMotion="user">
        <div className="relative flex min-h-full flex-col overflow-x-clip bg-noche-950 font-sans text-slate-200 selection:bg-electrico-500/40 selection:text-white">
          <a href="#contenido" className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[60] focus:rounded-lg focus:bg-white focus:px-3 focus:py-2 focus:text-noche-950">
            Ir al contenido
          </a>
          <Encabezado />
          <main id="contenido" className="flex-1">
            <Suspense fallback={<div className="grid min-h-[50vh] place-items-center text-sm text-gris-tec">Cargando…</div>}>
              <Outlet />
            </Suspense>
          </main>
          <Pie />
        </div>
      </MotionConfig>
    </LazyMotion>
  );
}

function Encabezado() {
  const { unidades, cliente } = useTienda();
  const [compacta, setCompacta] = useState(false);
  const [abierto, setAbierto] = useState(false);
  const { pathname } = useLocation();
  const esInicio = pathname === '/';
  useEffect(() => {
    setAbierto(false);
  }, [pathname]);
  useEffect(() => {
    const f = () => setCompacta(window.scrollY > 24);
    f();
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);
  const solido = compacta || abierto || !esInicio;

  return (
    <header className="sticky top-0 z-50 px-3 pt-3 sm:px-5">
      <nav
        aria-label="Principal"
        className={cx(
          'mx-auto flex max-w-6xl items-center gap-3 rounded-2xl px-3 py-2.5 transition-all duration-500 sm:px-4',
          solido ? 'vidrio bg-noche-900/75 shadow-[0_10px_40px_-15px_rgba(0,0,0,0.8)]' : 'border border-transparent',
        )}
      >
        <Link to="/" aria-label="Don Repuestos Jaimes, ir al inicio" className="shrink-0 rounded-xl">
          <Logo />
        </Link>
        <div className={cx('hidden flex-1 md:block', esInicio && !compacta && 'md:invisible')}>
          <Buscador />
        </div>
        <ul className="ml-auto hidden items-center gap-1 lg:flex">
          {ENLACES.map((e) => (
            <li key={e.a}>
              <NavLink to={e.a} className={({ isActive }) => cx('rounded-xl px-3 py-2 text-sm font-medium transition', isActive ? 'text-white' : 'text-gris-tec hover:text-white')}>
                {e.texto}
              </NavLink>
            </li>
          ))}
        </ul>
        <div className="ml-auto flex items-center gap-1 lg:ml-0">
          <Link
            to={cliente ? '/cuenta' : '/ingresar'}
            aria-label={cliente ? `Mi cuenta (${cliente.nombre})` : 'Ingresar'}
            className="grid h-11 w-11 place-items-center rounded-xl text-slate-200 transition hover:bg-white/10"
          >
            <Iconos.persona className="h-6 w-6" />
          </Link>
          <Link to="/carrito" aria-label={`Carrito, ${unidades} ${unidades === 1 ? 'unidad' : 'unidades'}`} className="relative grid h-11 w-11 place-items-center rounded-xl text-slate-200 transition hover:bg-white/10">
            <IconoCarrito className="h-6 w-6" />
            {unidades > 0 && (
              <span className="absolute top-1 right-1 grid h-5 min-w-5 place-items-center rounded-full bg-cian-400 px-1 text-[11px] font-bold text-noche-950">{unidades > 99 ? '99+' : unidades}</span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setAbierto((x) => !x)}
            aria-expanded={abierto}
            aria-controls="menu-movil"
            aria-label={abierto ? 'Cerrar menú' : 'Abrir menú'}
            className="grid h-11 w-11 place-items-center rounded-xl text-slate-200 transition hover:bg-white/10 lg:hidden"
          >
            {abierto ? <Iconos.cerrar className="h-6 w-6" /> : <Iconos.menu className="h-6 w-6" />}
          </button>
        </div>
      </nav>
      <AnimatePresence>
        {abierto && (
          <m.div
            id="menu-movil"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.2 }}
            className="vidrio mx-auto mt-2 max-w-6xl rounded-2xl bg-noche-900/95 p-3 lg:hidden"
          >
            <div className="md:hidden">
              <Buscador alBuscar={() => setAbierto(false)} />
            </div>
            <ul className="mt-2 flex flex-col">
              {[...ENLACES, { a: cliente ? '/cuenta' : '/ingresar', texto: cliente ? 'Mi cuenta' : 'Ingresar o crear cuenta' }].map((e) => (
                <li key={e.a}>
                  <Link to={e.a} className="block rounded-xl px-4 py-3 text-[15px] font-medium text-slate-200 hover:bg-white/10">
                    {e.texto}
                  </Link>
                </li>
              ))}
            </ul>
          </m.div>
        )}
      </AnimatePresence>
    </header>
  );
}

export const IconoCarrito = ({ className }: { className?: string }) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
    <path d="M3 4h2l2.2 10.2a1.5 1.5 0 0 0 1.5 1.2h8.6a1.5 1.5 0 0 0 1.5-1.1L21 8H6.2" />
    <circle cx="9.5" cy="19.5" r="1.3" />
    <circle cx="17" cy="19.5" r="1.3" />
  </svg>
);
