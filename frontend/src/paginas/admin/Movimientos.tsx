import { useState } from 'react';
import { Link } from 'react-router';
import { apiAdmin, qs } from '../../api/cliente';
import { fecha } from '../../api/formato';
import { BuscadorProducto } from '../../componentes/BuscadorProducto';
import { Alerta, Boton, Cargando, Campo, Insignia, Paginacion, Selector, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Movimiento {
  id: number;
  producto_id: number;
  sku: string;
  producto: string;
  tipo: 'entrada' | 'salida' | 'ajuste' | 'venta' | 'devolucion';
  cantidad: number;
  cantidad_anterior: number;
  cantidad_nueva: number;
  motivo: string | null;
  asesor: string | null;
  pedido_codigo: string | null;
  compra_codigo: string | null;
  created_at: string;
}

const TIPOS = { entrada: 'Entrada', salida: 'Salida', ajuste: 'Ajuste', venta: 'Venta', devolucion: 'Devolución' } as const;
const COLOR = { entrada: 'verde', devolucion: 'verde', salida: 'rojo', venta: 'azul', ajuste: 'amarillo' } as const;
const TAMANO = 30;

/** Bitácora de TODO lo que cambió el stock: quién, cuándo, cuánto y por qué. */
export default function Movimientos() {
  const [f, setF] = useState({ tipo: '', desde: '', hasta: '' });
  const [producto, setProducto] = useState<{ id: number; sku: string; nombre: string } | null>(null);
  const [pagina, setPagina] = useState(1);
  const lista = useCarga(
    () => apiAdmin<{ items: Movimiento[]; total: number }>(`/admin/inventario/movimientos${qs({ ...f, producto_id: producto?.id, pagina, tamano: TAMANO })}`),
    [f.tipo, f.desde, f.hasta, producto?.id, pagina],
  );
  const cambiar = (k: keyof typeof f) => (e: { target: { value: string } }) => {
    setF((x) => ({ ...x, [k]: e.target.value }));
    setPagina(1);
  };

  return (
    <>
      <Titulo descripcion="Cada entrada, salida, ajuste, venta o devolución con usuario, fecha y motivo. El stock solo cambia por aquí: nunca se edita a mano.">Movimientos de inventario</Titulo>
      <Tarjeta className="mb-4">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            {producto ? (
              <div>
                <p className="mb-1 text-sm font-medium text-slate-200">Producto</p>
                <p className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-sm">
                  <span className="truncate">
                    <span className="font-mono text-xs text-gris-tec">{producto.sku}</span> {producto.nombre}
                  </span>
                  <Boton tamano="sm" variante="fantasma" onClick={() => setProducto(null)} aria-label="Quitar filtro de producto">
                    ✕
                  </Boton>
                </p>
              </div>
            ) : (
              <BuscadorProducto
                onElegir={(p) => {
                  setProducto(p);
                  setPagina(1);
                }}
              />
            )}
          </div>
          <Selector etiqueta="Tipo" value={f.tipo} onChange={cambiar('tipo')}>
            <option value="">Todos</option>
            {Object.entries(TIPOS).map(([v, t]) => (
              <option key={v} value={v}>
                {t}
              </option>
            ))}
          </Selector>
          <Campo etiqueta="Desde" type="date" value={f.desde} onChange={cambiar('desde')} />
          <Campo etiqueta="Hasta" type="date" value={f.hasta} onChange={cambiar('hasta')} />
        </div>
      </Tarjeta>
      {lista.error && <Alerta>{lista.error}</Alerta>}
      {!lista.datos ? (
        <Cargando />
      ) : (
        <Tarjeta>
          <Tabla columnas={['Fecha', 'Producto', 'Tipo', 'Cambio', 'Stock', 'Motivo', 'Usuario']} vacio={!lista.datos.items.length} amplia>
            {lista.datos.items.map((m) => (
              <tr key={m.id}>
                <td className="px-2 py-2 text-xs whitespace-nowrap">{fecha(m.created_at)}</td>
                <td className="px-2 py-2">
                  <Link to={`/admin/productos/${m.producto_id}`} className="font-mono text-xs text-electrico-300 hover:underline">
                    {m.sku}
                  </Link>
                  <span className="block text-xs text-gris-tec">{m.producto}</span>
                </td>
                <td className="px-2 py-2">
                  <Insignia color={COLOR[m.tipo]} texto={TIPOS[m.tipo]} />
                </td>
                <td className={`px-2 py-2 font-semibold tabular-nums ${m.cantidad > 0 ? 'text-emerald-300' : 'text-rose-300'}`}>
                  {m.cantidad > 0 ? '+' : ''}
                  {m.cantidad}
                </td>
                <td className="px-2 py-2 text-xs tabular-nums whitespace-nowrap">
                  {m.cantidad_anterior} → <span className="text-white">{m.cantidad_nueva}</span>
                </td>
                <td className="px-2 py-2 text-xs">
                  {m.motivo ?? '—'}
                  {m.pedido_codigo && <span className="block text-gris-tec">Pedido {m.pedido_codigo}</span>}
                  {m.compra_codigo && <span className="block text-gris-tec">Compra {m.compra_codigo}</span>}
                </td>
                <td className="px-2 py-2 text-xs">{m.asesor ?? 'Sistema'}</td>
              </tr>
            ))}
          </Tabla>
          <Paginacion pagina={pagina} tamano={TAMANO} total={lista.datos.total} onCambiar={setPagina} />
        </Tarjeta>
      )}
    </>
  );
}
