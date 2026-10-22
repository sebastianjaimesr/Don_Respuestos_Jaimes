import { Navigate, Route, Routes } from 'react-router';
import PaginaChat from './chat/PaginaChat';
import { ProveedorAuth } from './api/auth';
import { LayoutAdmin, RutaProtegida } from './paginas/admin/Layout';
import Login from './paginas/admin/Login';
import Resumen from './paginas/admin/Resumen';
import Productos from './paginas/admin/Productos';
import DetalleProducto from './paginas/admin/DetalleProducto';
import Inventario from './paginas/admin/Inventario';
import Cotizaciones from './paginas/admin/Cotizaciones';
import Pedidos from './paginas/admin/Pedidos';
import Atencion from './paginas/admin/Atencion';
import Configuracion from './paginas/admin/Configuracion';
import Usuarios from './paginas/admin/Usuarios';
import Eventos from './paginas/admin/Eventos';

// Se activa al publicar solo el frontend (GitHub Pages) sin un backend conectado.
const SIN_SERVIDOR = import.meta.env.VITE_SIN_SERVIDOR === '1';

const rutas = (
  <Routes>
    <Route path="/" element={<PaginaChat />} />
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
