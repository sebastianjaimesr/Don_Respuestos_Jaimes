import { lazy, Suspense, type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router';
import PaginaChat from './chat/PaginaChat';
import PaginaInicio from './inicio/PaginaInicio';
import { ProveedorAuth } from './api/auth';
import { ProveedorTienda } from './tienda/estado';
import { LayoutTienda } from './tienda/LayoutTienda';

// Páginas de la tienda (menos la portada) en archivos aparte: la primera visita descarga solo lo necesario.
const PaginaCatalogo = lazy(() => import('./tienda/catalogo/PaginaCatalogo'));
const PaginaProducto = lazy(() => import('./tienda/producto/PaginaProducto'));
const PaginaCarrito = lazy(() => import('./tienda/carrito/PaginaCarrito'));
const PaginaCheckout = lazy(() => import('./tienda/carrito/PaginaCheckout'));
const PaginaPedido = lazy(() => import('./tienda/carrito/PaginaPedido'));
const PaginaIngresar = lazy(() => import('./tienda/cuenta/PaginaIngresar'));
const PaginaCuenta = lazy(() => import('./tienda/cuenta/PaginaCuenta'));

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
const Motos = lazy(() => import('./paginas/admin/Motos'));
const Categorias = lazy(() => import('./paginas/admin/Categorias'));
const Proveedores = lazy(() => import('./paginas/admin/Proveedores'));
const Promociones = lazy(() => import('./paginas/admin/Promociones'));
const PreciosMasivos = lazy(() => import('./paginas/admin/PreciosMasivos'));
const Movimientos = lazy(() => import('./paginas/admin/Movimientos'));
const Compras = lazy(() => import('./paginas/admin/Compras'));
const Datos = lazy(() => import('./paginas/admin/Datos'));
const Envios = lazy(() => import('./paginas/admin/Envios'));
const Auditoria = lazy(() => import('./paginas/admin/Auditoria'));

const RutaProtegida = ({ children }: { children: ReactNode }) => <RutaProtegidaPerezosa>{children}</RutaProtegidaPerezosa>;

// Se activa al publicar solo el frontend (GitHub Pages) sin un backend conectado.
const SIN_SERVIDOR = import.meta.env.VITE_SIN_SERVIDOR === '1';

const rutas = (
  <Suspense fallback={<div className="grid h-full place-items-center text-sm text-slate-500">Cargando…</div>}>
    <Routes>
      <Route element={<LayoutTienda />}>
        <Route path="/" element={<PaginaInicio />} />
        <Route path="/catalogo" element={<PaginaCatalogo />} />
        <Route path="/producto/:slug" element={<PaginaProducto />} />
        <Route path="/carrito" element={<PaginaCarrito />} />
        <Route path="/checkout" element={<PaginaCheckout />} />
        <Route path="/pedido" element={<PaginaPedido />} />
        <Route path="/pedido/:codigo" element={<PaginaPedido />} />
        <Route path="/ingresar" element={<PaginaIngresar />} />
        <Route path="/cuenta" element={<PaginaCuenta />} />
      </Route>
      <Route path="/asistente" element={<PaginaChat />} />
      <Route path="/chat" element={<Navigate to="/asistente" replace />} />
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
        <Route path="motos" element={<Motos />} />
        <Route path="categorias" element={<Categorias />} />
        <Route path="proveedores" element={<Proveedores />} />
        <Route path="promociones" element={<Promociones />} />
        <Route path="precios" element={<PreciosMasivos />} />
        <Route path="movimientos" element={<Movimientos />} />
        <Route path="compras" element={<Compras />} />
        <Route path="datos" element={<Datos />} />
        <Route path="envios" element={<Envios />} />
        <Route path="auditoria" element={<Auditoria />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  </Suspense>
);

function AvisoSinServidor() {
  return (
    <div role="status" className="shrink-0 bg-amber-100 px-4 py-2 text-center text-sm text-amber-900">
      Vista de demostración publicada en GitHub Pages: el servidor todavía no está conectado, así que el catálogo, el carrito, el chat y el panel no responden.
    </div>
  );
}

export default function App() {
  return (
    <ProveedorAuth>
      <ProveedorTienda>
      {SIN_SERVIDOR ? (
        <div className="flex h-full flex-col">
          <AvisoSinServidor />
          <div className="min-h-0 flex-1 overflow-y-auto">{rutas}</div>
        </div>
      ) : (
        rutas
      )}
      </ProveedorTienda>
    </ProveedorAuth>
  );
}
