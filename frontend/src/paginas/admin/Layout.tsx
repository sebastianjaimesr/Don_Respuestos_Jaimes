import { useEffect, useState, type ReactNode } from 'react';
import { Link, Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth } from '../../api/auth';
import { etiqueta } from '../../api/formato';
import { Cargando } from '../../componentes/ui';
import { Logo } from '../../inicio/comunes';

export function RutaProtegida({ children }: { children: ReactNode }) {
  const { usuario, cargando } = useAuth();
  const loc = useLocation();
  if (cargando) return <Cargando />;
  if (!usuario) return <Navigate to="/admin/login" replace state={{ desde: loc.pathname }} />;
  return <>{children}</>;
}

/**
 * Menú agrupado. Cada enlace se muestra solo si el usuario tiene el permiso:
 * es comodidad visual, el servidor vuelve a verificar cada solicitud.
 */
const MENU: { grupo: string; enlaces: { a: string; texto: string; permiso: string | string[] }[] }[] = [
  { grupo: '', enlaces: [{ a: '/admin', texto: 'Resumen', permiso: 'ventas.ver' }] },
  {
    grupo: 'Ventas',
    enlaces: [
      { a: '/admin/pedidos', texto: 'Pedidos', permiso: 'ventas.ver' },
      { a: '/admin/cotizaciones', texto: 'Cotizaciones', permiso: 'ventas.ver' },
      { a: '/admin/atencion', texto: 'Atención humana', permiso: 'ventas.ver' },
    ],
  },
  {
    grupo: 'Catálogo',
    enlaces: [
      { a: '/admin/productos', texto: 'Productos', permiso: 'catalogo.ver' },
      { a: '/admin/motos', texto: 'Motos', permiso: 'catalogo.ver' },
      { a: '/admin/categorias', texto: 'Categorías y marcas', permiso: 'catalogo.ver' },
      { a: '/admin/promociones', texto: 'Promociones', permiso: 'catalogo.ver' },
      { a: '/admin/precios', texto: 'Precios masivos', permiso: 'precios.masivo' },
    ],
  },
  {
    grupo: 'Inventario',
    enlaces: [
      { a: '/admin/inventario', texto: 'Existencias', permiso: 'inventario.ver' },
      { a: '/admin/movimientos', texto: 'Movimientos', permiso: 'inventario.ver' },
      { a: '/admin/compras', texto: 'Compras', permiso: 'inventario.ver' },
      { a: '/admin/proveedores', texto: 'Proveedores', permiso: 'catalogo.ver' },
      { a: '/admin/datos', texto: 'Importar y exportar', permiso: ['importaciones.aplicar', 'exportaciones.descargar'] },
    ],
  },
  {
    grupo: 'Sistema',
    enlaces: [
      { a: '/admin/configuracion', texto: 'Configuración', permiso: [] },
      { a: '/admin/envios', texto: 'Tarifas de envío', permiso: 'catalogo.ver' },
      { a: '/admin/usuarios', texto: 'Usuarios y roles', permiso: 'usuarios.gestionar' },
      { a: '/admin/auditoria', texto: 'Auditoría', permiso: 'auditoria.ver' },
      { a: '/admin/eventos', texto: 'Registro de eventos', permiso: 'auditoria.ver' },
    ],
  },
];

export function LayoutAdmin() {
  const { usuario, salir, tiene } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const { pathname } = useLocation();
  useEffect(() => {
    setAbierto(false);
  }, [pathname]);
  // Un arreglo de permisos = basta con UNO de ellos (p. ej. importar o exportar)
  const visible = (p: string | string[]) => (Array.isArray(p) ? p.length === 0 || p.some((x) => tiene(x)) : tiene(p));
  // Si entran por URL directa a una sección sin permiso, se avisa en vez de dejar la página a medio cargar.
  const seccion = MENU.flatMap((g) => g.enlaces)
    .filter((e) => (e.a === '/admin' ? pathname.replace(/\/$/, '') === '/admin' : pathname === e.a || pathname.startsWith(e.a + '/')))
    .sort((a, b) => b.a.length - a.a.length)[0];
  const permitido = !seccion || visible(seccion.permiso);
  const grupos = MENU.map((g) => ({ ...g, enlaces: g.enlaces.filter((e) => visible(e.permiso)) })).filter((g) => g.enlaces.length);

  const nav = (
    <nav className="flex flex-col gap-4 p-3" aria-label="Menú del panel">
      {grupos.map((g) => (
        <div key={g.grupo || 'inicio'}>
          {g.grupo && <p className="mb-1 px-3 text-[11px] font-semibold tracking-[0.16em] text-gris-tec uppercase">{g.grupo}</p>}
          <ul className="flex flex-col gap-0.5">
            {g.enlaces.map((m) => (
              <li key={m.a}>
                <NavLink
                  to={m.a}
                  end={m.a === '/admin'}
                  className={({ isActive }) =>
                    `block rounded-lg px-3 py-2 text-sm font-medium transition ${isActive ? 'bg-electrico-500/15 text-white ring-1 ring-electrico-400/30' : 'text-slate-300 hover:bg-white/[0.05] hover:text-white'}`
                  }
                >
                  {m.texto}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-full bg-noche-950 text-slate-200">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col overflow-y-auto border-r border-white/[0.06] bg-noche-900/60 md:flex">
        <Link to="/" className="block border-b border-white/[0.06] px-4 py-4" aria-label="Ir a la tienda">
          <Logo />
          <p className="mt-1 text-xs text-gris-tec">Panel del negocio</p>
        </Link>
        {nav}
      </aside>
      {abierto && (
        <div className="fixed inset-0 z-30 bg-black/60 md:hidden" onClick={() => setAbierto(false)}>
          <aside className="h-full w-72 overflow-y-auto bg-noche-900" onClick={(e) => e.stopPropagation()} aria-label="Menú">
            <div className="border-b border-white/[0.06] px-4 py-4">
              <Logo />
            </div>
            {nav}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-white/[0.06] bg-noche-950/85 px-4 py-3 backdrop-blur">
          <button className="rounded-lg border border-white/15 px-3 py-1.5 text-sm md:hidden" onClick={() => setAbierto(true)} aria-label="Abrir menú" aria-expanded={abierto}>
            ☰ Menú
          </button>
          <span className="hidden text-sm text-gris-tec md:block">Los cambios de precios, stock y pedidos quedan registrados en la auditoría.</span>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-200">
              {usuario?.nombre} · <span className="text-gris-tec">{etiqueta(usuario?.rol)}</span>
            </span>
            <button onClick={salir} className="rounded-lg px-2 py-1 text-electrico-300 hover:bg-electrico-500/10">
              Salir
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
          {permitido ? (
            <Outlet />
          ) : (
            <div role="alert" className="rounded-xl border border-white/10 bg-noche-900 p-6 text-sm">
              <p className="font-semibold text-white">No tienes permiso para ver «{seccion?.texto}».</p>
              <p className="mt-1 text-gris-tec">Si lo necesitas, pídele a un administrador que lo active para tu rol en Usuarios y roles.</p>
            </div>
          )}
        </main>
      </div>
    </div>
  );
}

export function Titulo({ children, acciones, descripcion }: { children: ReactNode; acciones?: ReactNode; descripcion?: ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="font-display text-2xl font-semibold text-white">{children}</h1>
        {descripcion && <p className="mt-1 max-w-3xl text-sm text-gris-tec">{descripcion}</p>}
      </div>
      {acciones}
    </div>
  );
}
