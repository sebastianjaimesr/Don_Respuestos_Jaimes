import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import PaginaChat from './chat/PaginaChat';
import PaginaInicio from './inicio/PaginaInicio';
import { ProveedorAuth } from './api/auth';

// El panel se descarga aparte: quien visita la tienda no carga su código.
const LayoutAdmin = lazy(() => import('./paginas/admin/Layout').then((m) => ({ default: m.LayoutAdmin })));
const RutaProtegidaPerezosa = lazy(() => import('./paginas/admin/Layout').then((m) => ({ default: m.RutaProtegida })));
const Login = lazy(() => import('./paginas/admin/Login'));
const Resumen = lazy(() => import('./paginas/admin/Resumen'));
const Productos = lazy(() => import('./paginas/admin/Productos'));
const DetalleProducto = lazy(() => import('./paginas/admin/DetalleProducto'));
const Inventario = lazy(() => import('./paginas/admin/Inventario'));
const Cotizaciones = lazy(() => import('./paginas/admin/Cotizaciones'));
const Pedidos = lazy(() => import('./paginas/admin/Pedidos'));
const Atencion = lazy(() => import('./paginas/admin/Atencion'));
const Configuracion = lazy(() => import('./paginas/admin/Configuracion'));
const Usuarios = lazy(() => import('./paginas/admin/Usuarios'));
const Eventos = lazy(() => import('./paginas/admin/Eventos'));

const RutaProtegida = ({ children }: { children: ReactNode }) => <RutaProtegidaPerezosa>{children}</RutaProtegidaPerezosa>;

// Se activa al publicar solo el frontend (GitHub Pages) sin un backend conectado.
const SIN_SERVIDOR = import.meta.env.VITE_SIN_SERVIDOR === '1';

const rutas = (
  <Suspense fallback={<div className="grid h-full place-items-center text-sm text-slate-500">Cargando…</div>}>
    <Routes>
      <Route path="/" element={<PaginaInicio />} />
      <Route path="/chat" element={<PaginaChat />} />
      <Route path="/admin/login" element={<Login />} />
      <Route
        path="/admin"
        element={
          <RutaProtegida>
            <LayoutAdmin />
          </RutaProtegida>
        }
      >
        <Route index element={<Resumen />} />
        <Route path="productos" element={<Productos />} />
        <Route path="productos/:id" element={<DetalleProducto />} />
        <Route path="inventario" element={<Inventario />} />
        <Route path="cotizaciones" element={<Cotizaciones />} />
        <Route path="pedidos" element={<Pedidos />} />
        <Route path="atencion" element={<Atencion />} />
        <Route path="configuracion" element={<Configuracion />} />
        <Route path="usuarios" element={<Usuarios />} />
        <Route path="eventos" element={<Eventos />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </Suspense>
);

function AvisoSinServidor() {
  return (
    <div role="status" className="shrink-0 bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
      Vista de demostración publicada en GitHub Pages: el servidor todavía no está conectado, así que el chat y el panel no responden.
    </div>
  );
}

export default function App() {
  return (
    <ProveedorAuth>
      {SIN_SERVIDOR ? (
        <div className="flex h-full flex-col">
          <AvisoSinServidor />
          <div className="min-h-0 flex-1 overflow-y-auto">{rutas}</div>
        </div>
      ) : (
        rutas
      )}
    </ProveedorAuth>
  );
}
