import { useState } from 'react';
import { Link } from 'react-router';
import { useAuth } from '../../api/auth';
import { apiAdmin } from '../../api/cliente';
import { Alerta, Boton, Cargando, Insignia, InsigniaDemo, Modal, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { FormMovimiento } from './DetalleProducto';
import { Titulo } from './Layout';

interface AlertaStock {
  id: number;
  referencia: string;
  nombre: string;
  tipo: string;
  es_demo: boolean;
  cantidad: number;
  stock_minimo: number;
  estado: string;
  tiempo_abastecimiento_dias: number | null;
}

export default function Inventario() {
  const { puede } = useAuth();
  const alertas = useCarga(() => apiAdmin<AlertaStock[]>('/admin/inventario/alertas'), []);
  const [sel, setSel] = useState<AlertaStock | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  return (
    <>
      <Titulo>Inventario</Titulo>
      <p className="mb-4 text-sm text-slate-600">
        Cada entrada, salida o ajuste queda en la bitácora con usuario, fecha y motivo. Para ver el stock completo usa{' '}
        <Link to="/admin/productos" className="text-marca-700 hover:underline">
          Productos
        </Link>{' '}
        con el filtro de stock.
      </p>
      {msg && (
        <div className="mb-3">
          <Alerta tipo="exito">{msg}</Alerta>
        </div>
      )}
      <Tarjeta titulo="Alertas: agotados y stock bajo">
        {alertas.error && <Alerta>{alertas.error}</Alerta>}
        {alertas.cargando && !alertas.datos ? (
          <Cargando />
        ) : (
          <Tabla amplia columnas={['Referencia', 'Producto', 'Stock', 'Mínimo', 'Abastecimiento', 'Estado', '']} vacio={!alertas.datos?.length}>
            {alertas.datos?.map((a) => (
              <tr key={a.id}>
                <td className="px-2 py-2 font-mono text-xs">
                  <Link to={`/admin/productos/${a.id}`} className="text-marca-700 hover:underline">
                    {a.referencia}
                  </Link>
                </td>
                <td className="px-2 py-2">
                  {a.nombre} {a.es_demo && <InsigniaDemo />}
                </td>
                <td className="px-2 py-2 font-semibold tabular-nums">{a.cantidad}</td>
                <td className="px-2 py-2 tabular-nums">{a.stock_minimo}</td>
                <td className="px-2 py-2">{a.tiempo_abastecimiento_dias ? `${a.tiempo_abastecimiento_dias} días` : '—'}</td>
                <td className="px-2 py-2">
                  <Insignia valor={a.estado} />
                </td>
                <td className="px-2 py-2 text-right">
                  {puede('admin', 'vendedor') && (
                    <Boton tamano="sm" variante="secundario" onClick={() => setSel(a)}>
                      Registrar movimiento
                    </Boton>
                  )}
                </td>
              </tr>
            ))}
          </Tabla>
        )}
      </Tarjeta>
      <Modal abierto={!!sel} titulo={sel ? `${sel.nombre} · ${sel.referencia}` : ''} onCerrar={() => setSel(null)}>
        {sel && (
          <FormMovimiento
            productoId={sel.id}
            stockActual={sel.cantidad}
            onHecho={(m) => {
              setSel(null);
              setMsg(m);
              void alertas.recargar();
            }}
          />
        )}
      </Modal>
    </>
  );
}
