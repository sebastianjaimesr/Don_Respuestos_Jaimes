import { Link } from 'react-router';
import { apiAdmin } from '../../api/cliente';
import { cop } from '../../api/formato';
import { Alerta, Cargando, Insignia, Metrica, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Metricas {
  ventas: { pedidos_hoy: number; pedidos_mes: number; ventas_mes: string; pendientes_confirmar: number };
  inventario: { productos_activos: number; stock_bajo: number; agotados: number; sin_precio: number; valor_inventario: string };
  atencion: { pendientes: number; en_atencion: number };
  top_productos: { referencia: string; descripcion: string; unidades: number; total: string }[];
  ventas_por_dia: { dia: string; total: string; pedidos: number }[];
}
interface AlertaStock {
  id: number;
  referencia: string;
  nombre: string;
  cantidad: number;
  stock_minimo: number;
  estado: string;
}

export default function Resumen() {
  const m = useCarga(() => apiAdmin<Metricas>('/admin/metricas'), []);
  const a = useCarga(() => apiAdmin<AlertaStock[]>('/admin/inventario/alertas'), []);
  if (m.error) return <Alerta>{m.error}</Alerta>;
  if (!m.datos) return <Cargando />;
  const { ventas, inventario, atencion } = m.datos;

  return (
    <>
      <Titulo>Resumen</Titulo>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metrica titulo="Pedidos hoy" valor={ventas.pedidos_hoy} />
        <Metrica titulo="Ventas del mes" valor={cop(ventas.ventas_mes)} detalle={`${ventas.pedidos_mes} pedidos (sin cancelados)`} />
        <Metrica titulo="Pedidos por confirmar" valor={ventas.pendientes_confirmar} tono={ventas.pendientes_confirmar ? 'alerta' : 'normal'} />
        <Metrica titulo="Atención humana pendiente" valor={atencion.pendientes} detalle={`${atencion.en_atencion} en atención`} tono={atencion.pendientes ? 'alerta' : 'normal'} />
        <Metrica titulo="Productos activos" valor={inventario.productos_activos} detalle={`Valor en inventario: ${cop(inventario.valor_inventario)}`} />
        <Metrica titulo="Stock bajo" valor={inventario.stock_bajo} tono={inventario.stock_bajo ? 'alerta' : 'normal'} />
        <Metrica titulo="Agotados" valor={inventario.agotados} tono={inventario.agotados ? 'peligro' : 'normal'} />
        <Metrica titulo="Sin precio confirmado" valor={inventario.sin_precio} detalle="El asistente no los vende" tono={inventario.sin_precio ? 'alerta' : 'normal'} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Ventas de los últimos 14 días">
          <Tabla columnas={['Día', 'Pedidos', 'Total']}>
            {m.datos.ventas_por_dia.map((d) => (
              <tr key={d.dia} className={d.pedidos ? '' : 'text-slate-400'}>
                <td className="px-2 py-1.5">{d.dia}</td>
                <td className="px-2 py-1.5 tabular-nums">{d.pedidos}</td>
                <td className="px-2 py-1.5 tabular-nums">{cop(d.total)}</td>
              </tr>
            ))}
          </Tabla>
        </Tarjeta>
        <Tarjeta titulo="Más vendidos (30 días)">
          <Tabla columnas={['Referencia', 'Producto', 'Unidades', 'Total']} vacio={!m.datos.top_productos.length}>
            {m.datos.top_productos.map((t) => (
              <tr key={t.referencia}>
                <td className="px-2 py-2 font-mono text-xs">{t.referencia}</td>
                <td className="px-2 py-2">{t.descripcion}</td>
                <td className="px-2 py-2 tabular-nums">{t.unidades}</td>
                <td className="px-2 py-2 tabular-nums">{cop(t.total)}</td>
              </tr>
            ))}
          </Tabla>
        </Tarjeta>
      </div>

      <Tarjeta titulo="Alertas de inventario" className="mt-4" acciones={<Link to="/admin/inventario" className="text-sm text-marca-700 hover:underline">Ver inventario</Link>}>
        {a.cargando ? (
          <Cargando />
        ) : (
          <Tabla columnas={['Referencia', 'Producto', 'Stock', 'Mínimo', 'Estado']} vacio={!a.datos?.length}>
            {a.datos?.slice(0, 8).map((x) => (
              <tr key={x.id}>
                <td className="px-2 py-2 font-mono text-xs">
                  <Link to={`/admin/productos/${x.id}`} className="text-marca-700 hover:underline">
                    {x.referencia}
                  </Link>
                </td>
                <td className="px-2 py-2">{x.nombre}</td>
                <td className="px-2 py-2 tabular-nums">{x.cantidad}</td>
                <td className="px-2 py-2 tabular-nums">{x.stock_minimo}</td>
                <td className="px-2 py-2">
                  <Insignia valor={x.estado} />
                </td>
              </tr>
            ))}
          </Tabla>
        )}
      </Tarjeta>
    </>
  );
}
