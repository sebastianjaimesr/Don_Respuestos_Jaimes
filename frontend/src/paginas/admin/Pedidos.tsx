import { useState } from 'react';
import { useAuth } from '../../api/auth';
import { apiAdmin, qs } from '../../api/cliente';
import { cop, etiqueta, fecha } from '../../api/formato';
import { Alerta, Boton, Cargando, Insignia, mensajeError, Modal, Paginacion, Selector, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Fila {
  codigo: string;
  estado: string;
  estado_pago: string;
  metodo_pago: string;
  modalidad_entrega: string;
  ciudad_entrega: string | null;
  total: string;
  envio_confirmado: boolean;
  created_at: string;
  cliente: string;
  telefono: string;
}
interface Detalle {
  codigo: string;
  estado: string;
  estado_pago: string;
  metodo_pago: string;
  modalidad_entrega: string;
  ciudad_entrega: string | null;
  direccion_entrega: string | null;
  subtotal: string;
  costo_envio: string | null;
  envio_confirmado: boolean;
  total: string;
  created_at: string;
  cliente_nombre: string;
  cliente_telefono: string;
  cliente_ciudad: string | null;
  cotizacion_codigo: string | null;
  lineas: { referencia: string; descripcion: string; tipo: string; cantidad: number; precio_unitario: string; subtotal: string }[];
}

// Debe coincidir con las transiciones del backend (que es quien las hace cumplir)
const SIGUIENTES: Record<string, string[]> = {
  registrado: ['confirmado', 'cancelado'],
  confirmado: ['en_preparacion', 'cancelado'],
  en_preparacion: ['enviado', 'entregado', 'cancelado'],
  enviado: ['entregado'],
  entregado: [],
  cancelado: [],
};
const ESTADOS = ['registrado', 'confirmado', 'en_preparacion', 'enviado', 'entregado', 'cancelado'];

export default function Pedidos() {
  const [estado, setEstado] = useState('');
  const [q, setQ] = useState('');
  const [busqueda, setBusqueda] = useState('');
  const [pagina, setPagina] = useState(1);
  const [sel, setSel] = useState<string | null>(null);
  const lista = useCarga(() => apiAdmin<{ items: Fila[]; total: number; tamano: number }>(`/admin/pedidos${qs({ estado, q, pagina })}`), [estado, q, pagina]);

  return (
    <>
      <Titulo>Pedidos</Titulo>
      <Tarjeta>
        <form
          className="mb-4 grid gap-3 sm:grid-cols-3"
          onSubmit={(e) => {
            e.preventDefault();
            setPagina(1);
            setQ(busqueda);
          }}
        >
          <div className="flex items-end gap-2 sm:col-span-2">
            <div className="flex-1">
              <label htmlFor="bp" className="text-sm font-medium text-slate-700">
                Buscar
              </label>
              <input id="bp" value={busqueda} onChange={(e) => setBusqueda(e.target.value)} placeholder="Código, cliente o teléfono" className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm" />
            </div>
            <Boton type="submit" variante="secundario">
              Buscar
            </Boton>
          </div>
          <Selector
            etiqueta="Estado"
            value={estado}
            onChange={(e) => {
              setPagina(1);
              setEstado(e.target.value);
            }}
          >
            <option value="">Todos</option>
            {ESTADOS.map((s) => (
              <option key={s} value={s}>
                {etiqueta(s)}
              </option>
            ))}
          </Selector>
        </form>
        {lista.error && <Alerta>{lista.error}</Alerta>}
        {!lista.datos ? (
          <Cargando />
        ) : (
          <>
            <Tabla amplia columnas={['Código', 'Fecha', 'Cliente', 'Entrega', 'Pago', 'Total', 'Estado']} vacio={!lista.datos.items.length}>
              {lista.datos.items.map((p) => (
                <tr key={p.codigo} className="cursor-pointer hover:bg-slate-50" onClick={() => setSel(p.codigo)}>
                  <td className="px-2 py-2 font-mono text-xs text-marca-700">{p.codigo}</td>
                  <td className="px-2 py-2 whitespace-nowrap">{fecha(p.created_at)}</td>
                  <td className="px-2 py-2">
                    {p.cliente}
                    <div className="text-xs text-slate-500">{p.telefono}</div>
                  </td>
                  <td className="px-2 py-2">
                    {etiqueta(p.modalidad_entrega)}
                    {p.ciudad_entrega && <div className="text-xs text-slate-500">{p.ciudad_entrega}</div>}
                  </td>
                  <td className="px-2 py-2">
                    {etiqueta(p.metodo_pago)} <Insignia valor={p.estado_pago} />
                  </td>
                  <td className="px-2 py-2 font-medium tabular-nums">
                    {cop(p.total)}
                    {!p.envio_confirmado && <div className="text-xs font-normal text-amber-800">+ envío por confirmar</div>}
                  </td>
                  <td className="px-2 py-2">
                    <Insignia valor={p.estado} />
                  </td>
                </tr>
              ))}
            </Tabla>
            <Paginacion pagina={pagina} tamano={lista.datos.tamano} total={lista.datos.total} onCambiar={setPagina} />
          </>
        )}
      </Tarjeta>
      {sel && (
        <DetallePedido
          codigo={sel}
          onCerrar={() => setSel(null)}
          onCambio={() => void lista.recargar()}
        />
      )}
    </>
  );
}

function DetallePedido({ codigo, onCerrar, onCambio }: { codigo: string; onCerrar: () => void; onCambio: () => void }) {
  const { puede } = useAuth();
  const det = useCarga(() => apiAdmin<Detalle>(`/admin/pedidos/${codigo}`), [codigo]);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);

  const cambiar = async (cuerpo: { estado?: string; estado_pago?: string }) => {
    if (cuerpo.estado === 'cancelado' && !confirm('¿Cancelar el pedido? Las unidades volverán al inventario.')) return;
    setOcupado(true);
    setError(null);
    try {
      await apiAdmin(`/admin/pedidos/${codigo}`, 'PATCH', cuerpo);
      await det.recargar();
      onCambio();
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupado(false);
    }
  };

  const d = det.datos;
  return (
    <Modal abierto titulo={`Pedido ${codigo}`} onCerrar={onCerrar}>
      {error && (
        <div className="mb-3">
          <Alerta>{error}</Alerta>
        </div>
      )}
      {!d ? (
        <Cargando />
      ) : (
        <div className="flex flex-col gap-4">
          <div className="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <p className="text-slate-500">Cliente</p>
              <p className="font-medium">{d.cliente_nombre}</p>
              <p>
                <a href={`tel:${d.cliente_telefono}`} className="text-marca-700 hover:underline">
                  {d.cliente_telefono}
                </a>{' '}
                · {d.cliente_ciudad}
              </p>
            </div>
            <div>
              <p className="text-slate-500">Entrega</p>
              <p className="font-medium">{etiqueta(d.modalidad_entrega)}</p>
              {d.direccion_entrega && (
                <p>
                  {d.direccion_entrega}, {d.ciudad_entrega}
                </p>
              )}
            </div>
            <div>
              <p className="text-slate-500">Estado</p>
              <Insignia valor={d.estado} />
            </div>
            <div>
              <p className="text-slate-500">Pago</p>
              <p>
                {etiqueta(d.metodo_pago)} · <Insignia valor={d.estado_pago} />
              </p>
            </div>
          </div>
          <Tabla columnas={['Referencia', 'Producto', 'Cant.', 'Unitario', 'Subtotal']}>
            {d.lineas.map((l) => (
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
            <span className="text-right tabular-nums">{cop(d.subtotal)}</span>
            <span className="text-slate-500">Envío</span>
            <span className="text-right">{d.envio_confirmado ? (d.costo_envio === '0.00' ? 'No aplica' : cop(d.costo_envio)) : 'Por confirmar'}</span>
            <span className="font-semibold">Total</span>
            <span className="text-right font-semibold tabular-nums">{cop(d.total)}</span>
          </div>
          <p className="text-xs text-slate-500">
            Registrado {fecha(d.created_at)}
            {d.cotizacion_codigo && ` · desde la cotización ${d.cotizacion_codigo}`}
          </p>
          {puede('admin', 'vendedor') && (
            <div className="flex flex-col gap-2 border-t border-slate-100 pt-3">
              <div className="flex flex-wrap gap-2">
                {SIGUIENTES[d.estado].map((s) => (
                  <Boton key={s} variante={s === 'cancelado' ? 'peligro' : 'primario'} tamano="sm" disabled={ocupado} onClick={() => cambiar({ estado: s })}>
                    Marcar como {etiqueta(s).toLowerCase()}
                  </Boton>
                ))}
              </div>
              {d.estado !== 'cancelado' && (
                <div className="flex flex-wrap items-center gap-2 text-sm">
                  <span className="text-slate-600">Pago:</span>
                  {['pendiente', 'confirmado', 'rechazado'].map((s) => (
                    <Boton key={s} variante="secundario" tamano="sm" disabled={ocupado || d.estado_pago === s} onClick={() => cambiar({ estado_pago: s })}>
                      {etiqueta(s)}
                    </Boton>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Modal>
  );
}
