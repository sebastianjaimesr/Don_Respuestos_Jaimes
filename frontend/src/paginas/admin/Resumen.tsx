import { Link } from 'react-router';
import { apiAdmin } from '../../api/cliente';
import { cop } from '../../api/formato';
import { Alerta, Cargando, Insignia, Metrica, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Metricas {
  ventas: { pedidos_hoy: number; ventas_hoy: string; pedidos_mes: number; ventas_mes: string; pendientes_confirmar: number };
  inventario: {
    productos_activos: number;
    productos_total: number;
    stock_bajo: number;
    agotados: number;
    sin_precio: number;
    sin_costo: number;
    valor_inventario: string;
    valor_inventario_costo: string;
  };
  atencion: { pendientes: number; en_atencion: number };
  top_productos: { referencia: string; descripcion: string; unidades: number; total: string }[];
  ventas_por_dia: { dia: string; total: string; pedidos: number }[];
  inventario_por_categoria: { grupo: string; etiqueta: string; productos: number; unidades: number; valor: string }[];
}
interface AlertaStock {
  id: number;
  referencia: string;
  nombre: string;
  cantidad: number;
  stock_minimo: number;
  estado: string;
}

/** Barra horizontal delgada; el número siempre va en texto al lado, la barra solo ayuda a comparar. */
function Barra({ valor, max, etiqueta }: { valor: number; max: number; etiqueta: string }) {
  const ancho = max > 0 ? Math.max(valor > 0 ? 2 : 0, (valor / max) * 100) : 0;
  return (
    <div className="h-2 w-full min-w-16 rounded-full bg-white/[0.06]" title={etiqueta} aria-hidden="true">
      <div className="h-2 rounded-full bg-electrico-500" style={{ width: `${ancho}%` }} />
    </div>
  );
}

export default function Resumen() {
  const m = useCarga(() => apiAdmin<Metricas>('/admin/metricas'), []);
  const a = useCarga(() => apiAdmin<AlertaStock[]>('/admin/inventario/alertas'), []);
  if (m.error) return <Alerta>{m.error}</Alerta>;
  if (!m.datos) return <Cargando />;
  const { ventas, inventario, atencion } = m.datos;
  const maxDia = Math.max(0, ...m.datos.ventas_por_dia.map((d) => Number(d.total)));
  const maxCat = Math.max(0, ...m.datos.inventario_por_categoria.map((c) => Number(c.valor)));

  return (
    <>
      <Titulo descripcion="Cifras calculadas en el servidor con los pedidos y el inventario reales. Los pedidos cancelados no cuentan.">Resumen</Titulo>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metrica titulo="Pedidos hoy" valor={ventas.pedidos_hoy} detalle={`Ventas de hoy: ${cop(ventas.ventas_hoy)}`} />
        <Metrica titulo="Ventas del mes" valor={cop(ventas.ventas_mes)} detalle={`${ventas.pedidos_mes} pedidos (sin cancelados)`} />
        <Metrica titulo="Pedidos por confirmar" valor={ventas.pendientes_confirmar} tono={ventas.pendientes_confirmar ? 'alerta' : 'normal'} />
        <Metrica titulo="Atención humana pendiente" valor={atencion.pendientes} detalle={`${atencion.en_atencion} en atención`} tono={atencion.pendientes ? 'alerta' : 'normal'} />
        <Metrica titulo="Productos activos" valor={inventario.productos_activos} detalle={`${inventario.productos_total} en total, incluidos inactivos`} />
        <Metrica titulo="Inventario a precio de venta" valor={cop(inventario.valor_inventario)} detalle="Solo productos con precio" />
        <Metrica
          titulo="Inventario a costo"
          valor={cop(inventario.valor_inventario_costo)}
          detalle={inventario.sin_costo ? `${inventario.sin_costo} productos sin costo registrado no suman` : 'Todos los productos tienen costo'}
          tono={inventario.sin_costo ? 'alerta' : 'normal'}
        />
        <Metrica titulo="Stock bajo" valor={inventario.stock_bajo} tono={inventario.stock_bajo ? 'alerta' : 'normal'} />
        <Metrica titulo="Agotados" valor={inventario.agotados} tono={inventario.agotados ? 'peligro' : 'normal'} />
        <Metrica titulo="Sin precio confirmado" valor={inventario.sin_precio} detalle="El asistente no los vende" tono={inventario.sin_precio ? 'alerta' : 'normal'} />
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Tarjeta titulo="Ventas de los últimos 14 días">
          <Tabla columnas={['Día', 'Pedidos', 'Total', '']}>
            {m.datos.ventas_por_dia.map((d) => (
              <tr key={d.dia} className={d.pedidos ? '' : 'text-gris-tec'}>
                <td className="px-2 py-1.5 whitespace-nowrap">{d.dia}</td>
                <td className="px-2 py-1.5 tabular-nums">{d.pedidos}</td>
                <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{cop(d.total)}</td>
                <td className="w-1/3 px-2 py-1.5">
                  <Barra valor={Number(d.total)} max={maxDia} etiqueta={`${d.dia}: ${cop(d.total)}`} />
                </td>
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

      <Tarjeta titulo="Inventario por categoría (a precio de venta)" className="mt-4">
        <Tabla columnas={['Categoría', 'Productos', 'Unidades', 'Valor', '']} vacio={!m.datos.inventario_por_categoria.length}>
          {m.datos.inventario_por_categoria.map((c) => (
            <tr key={c.grupo}>
              <td className="px-2 py-1.5">{c.etiqueta}</td>
              <td className="px-2 py-1.5 tabular-nums">{c.productos}</td>
              <td className="px-2 py-1.5 tabular-nums">{c.unidades}</td>
              <td className="px-2 py-1.5 tabular-nums whitespace-nowrap">{cop(c.valor)}</td>
              <td className="w-1/3 px-2 py-1.5">
                <Barra valor={Number(c.valor)} max={maxCat} etiqueta={`${c.etiqueta}: ${cop(c.valor)}`} />
              </td>
            </tr>
          ))}
        </Tabla>
      </Tarjeta>

      <Tarjeta titulo="Alertas de inventario" className="mt-4" acciones={<Link to="/admin/inventario" className="text-sm text-electrico-300 hover:underline">Ver inventario</Link>}>
        {a.cargando ? (
          <Cargando />
        ) : (
          <Tabla columnas={['Referencia', 'Producto', 'Stock', 'Mínimo', 'Estado']} vacio={!a.datos?.length}>
            {a.datos?.slice(0, 8).map((x) => (
              <tr key={x.id}>
                <td className="px-2 py-2 font-mono text-xs">
                  <Link to={`/admin/productos/${x.id}`} className="text-electrico-300 hover:underline">
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
