import { useState } from 'react';
import { useAuth } from '../../api/auth';
import { apiAdmin, qs } from '../../api/cliente';
import { cop, fecha } from '../../api/formato';
import { Alerta, Boton, Cargando, Insignia, mensajeError, Modal, Paginacion, Selector, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Fila {
  codigo: string;
  estado: string;
  subtotal: string;
  costo_envio: string | null;
  envio_confirmado: boolean;
  total: string;
  fecha_emision: string;
  vigente_hasta: string | null;
  cliente: string | null;
  items: number;
}
interface Detalle extends Fila {
  lineas: { referencia: string; descripcion: string; tipo: string; cantidad: number; precio_unitario: string; subtotal: string }[];
}

export default function Cotizaciones() {
  const { puede } = useAuth();
  const [estado, setEstado] = useState('');
  const [pagina, setPagina] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const lista = useCarga(() => apiAdmin<{ items: Fila[]; total: number; tamano: number }>(`/admin/cotizaciones${qs({ estado, pagina })}`), [estado, pagina]);
  const det = useCarga(() => (sel ? apiAdmin<Detalle>(`/admin/cotizaciones/${sel}`) : Promise.resolve(null)), [sel]);
  const [error, setError] = useState<string | null>(null);

  const anular = async () => {
    if (!sel || !confirm('¿Anular esta cotización?')) return;
    try {
      await apiAdmin(`/admin/cotizaciones/${sel}`, 'PATCH', { estado: 'anulada' });
      setSel(null);
      void lista.recargar();
    } catch (e) {
      setError(mensajeError(e));
    }
  };

  return (
    <>
      <Titulo>Cotizaciones</Titulo>
      <Tarjeta>
        <div className="mb-4 max-w-xs">
          <Selector
            etiqueta="Estado"
            value={estado}
            onChange={(e) => {
              setPagina(1);
              setEstado(e.target.value);
            }}
          >
            <option value="">Todos</option>
            <option value="emitida">Emitida</option>
            <option value="aceptada">Aceptada (se volvió pedido)</option>
            <option value="vencida">Vencida</option>
            <option value="anulada">Anulada</option>
          </Selector>
        </div>
        {lista.error && <Alerta>{lista.error}</Alerta>}
        {!lista.datos ? (
          <Cargando />
        ) : (
          <>
            <Tabla amplia columnas={['Código', 'Fecha', 'Cliente', 'Ítems', 'Total', 'Envío', 'Estado']} vacio={!lista.datos.items.length}>
              {lista.datos.items.map((c) => (
                <tr key={c.codigo} className="cursor-pointer hover:bg-slate-50" onClick={() => setSel(c.codigo)}>
                  <td className="px-2 py-2 font-mono text-xs text-marca-700">{c.codigo}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{fecha(c.fecha_emision)}</td>
                  <td className="px-2 py-2">{c.cliente ?? 'Sin identificar'}</td>
                  <td className="px-2 py-2 tabular-nums">{c.items}</td>
                  <td className="px-2 py-2 font-medium tabular-nums">{cop(c.total)}</td>
                  <td className="px-2 py-2">{c.envio_confirmado ? (c.costo_envio === '0.00' ? 'No aplica' : cop(c.costo_envio)) : <Insignia color="amarillo" texto="Por confirmar" />}</td>
                  <td className="px-2 py-2">
                    <Insignia valor={c.estado} />
                  </td>
                </tr>
              ))}
            </Tabla>
            <Paginacion pagina={pagina} tamano={lista.datos.tamano} total={lista.datos.total} onCambiar={setPagina} />
          </>
        )}
      </Tarjeta>
      <Modal abierto={!!sel} titulo={`Cotización ${sel ?? ''}`} onCerrar={() => setSel(null)}>
        {error && <Alerta>{error}</Alerta>}
        {!det.datos ? (
          <Cargando />
        ) : (
          <div className="flex flex-col gap-3">
            <p className="text-sm text-slate-600">
              Emitida {fecha(det.datos.fecha_emision)} · <Insignia valor={det.datos.estado} />
              {det.datos.vigente_hasta ? ` · vigente hasta ${fecha(det.datos.vigente_hasta, false)}` : ' · vigencia por confirmar'}
            </p>
            <Tabla columnas={['Referencia', 'Producto', 'Cant.', 'Unitario', 'Subtotal']}>
              {det.datos.lineas.map((l) => (
                <tr key={l.referencia}>
                  <td className="px-2 py-2 font-mono text-xs">{l.referencia}</td>
                  <td className="px-2 py-2">
                    {l.descripcion} <Insignia valor={l.tipo} />
                  </td>
                  <td className="px-2 py-2 tabular-nums">{l.cantidad}</td>
                  <td className="px-2 py-2 tabular-nums">{cop(l.precio_unitario)}</td>
                  <td className="px-2 py-2 tabular-nums">{cop(l.subtotal)}</td>
                </tr>
              ))}
            </Tabla>
            <div className="ml-auto grid grid-cols-2 gap-x-6 text-sm">
              <span className="text-slate-500">Subtotal</span>
              <span className="text-right tabular-nums">{cop(det.datos.subtotal)}</span>
              <span className="text-slate-500">Envío</span>
              <span className="text-right">{det.datos.envio_confirmado ? cop(det.datos.costo_envio) : 'Por confirmar'}</span>
              <span className="font-semibold">Total</span>
              <span className="text-right font-semibold tabular-nums">{cop(det.datos.total)}</span>
            </div>
            {puede('admin', 'vendedor') && det.datos.estado === 'emitida' && (
              <div className="flex justify-end">
                <Boton variante="peligro" onClick={anular}>
                  Anular cotización
                </Boton>
              </div>
            )}
          </div>
        )}
      </Modal>
    </>
  );
}
