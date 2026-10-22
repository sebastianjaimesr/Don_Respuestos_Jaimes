import { useState, type ReactNode } from 'react';
import { Navigate, NavLink, Outlet, useLocation } from 'react-router';
import { useAuth, type Rol } from '../../api/auth';
import { etiqueta } from '../../api/formato';
import { Cargando } from '../../componentes/ui';

export function RutaProtegida({ children }: { children: ReactNode }) {
  const { usuario, cargando } = useAuth();
  const loc = useLocation();
  if (cargando) return <Cargando />;
  if (!usuario) return <Navigate to="/admin/login" replace state={{ desde: loc.pathname }} />;
  return <>{children}</>;
}

const MENU: { a: string; texto: string; roles?: Rol[] }[] = [
  { a: '/admin', texto: 'Resumen' },
  { a: '/admin/productos', texto: 'Productos' },
  { a: '/admin/inventario', texto: 'Inventario' },
  { a: '/admin/cotizaciones', texto: 'Cotizaciones' },
  { a: '/admin/pedidos', texto: 'Pedidos' },
  { a: '/admin/atencion', texto: 'Atención humana' },
  { a: '/admin/configuracion', texto: 'Configuración' },
  { a: '/admin/usuarios', texto: 'Usuarios', roles: ['admin'] },
  { a: '/admin/eventos', texto: 'Registro de eventos', roles: ['admin'] },
];

export function LayoutAdmin() {
  const { usuario, salir, puede } = useAuth();
  const [abierto, setAbierto] = useState(false);
  const enlaces = MENU.filter((m) => !m.roles || puede(...m.roles));

  const nav = (
    <nav className="flex flex-col gap-1 p-3" aria-label="Menú del panel">
      {enlaces.map((m) => (
        <NavLink
          key={m.a}
          to={m.a}
          end={m.a === '/admin'}
          onClick={() => setAbierto(false)}
          className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-medium ${isActive ? 'bg-marca-700 text-white' : 'text-slate-700 hover:bg-slate-100'}`}
        >
          {m.texto}
        </NavLink>
      ))}
    </nav>
  );

  return (
    <div className="flex min-h-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-slate-200 bg-white md:flex">
        <div className="border-b border-slate-100 px-4 py-4">
          <p className="text-sm font-semibold text-marca-800">🏍️ Don Repuestos Jaimes</p>
          <p className="text-xs text-slate-500">Panel administrativo</p>
        </div>
        {nav}
      </aside>
      {abierto && (
        <div className="fixed inset-0 z-30 bg-slate-900/40 md:hidden" onClick={() => setAbierto(false)}>
          <aside className="h-full w-64 bg-white" onClick={(e) => e.stopPropagation()}>
            {nav}
          </aside>
        </div>
      )}
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
          <button className="rounded-lg border border-slate-300 px-2 py-1 text-sm md:hidden" onClick={() => setAbierto(true)} aria-label="Abrir menú">
            ☰ Menú
          </button>
          <span className="hidden text-sm text-slate-500 md:block">Los cambios de precios, stock y pedidos quedan registrados.</span>
          <div className="flex items-center gap-3 text-sm">
            <span className="text-slate-700">
              {usuario?.nombre} · <span className="text-slate-500">{etiqueta(usuario?.rol)}</span>
            </span>
            <button onClick={salir} className="rounded-lg px-2 py-1 text-marca-700 hover:bg-marca-50">
              Salir
            </button>
          </div>
        </header>
        <main className="mx-auto w-full max-w-7xl flex-1 p-4 md:p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export function Titulo({ children, acciones }: { children: ReactNode; acciones?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
      <h1 className="text-xl font-semibold text-slate-900">{children}</h1>
      {acciones}
    </div>
  );
}
