import { useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import { useAuth } from '../../api/auth';
import { apiAdmin } from '../../api/cliente';
import { cop, etiqueta, fecha } from '../../api/formato';
import { Alerta, Boton, Campo, Cargando, erroresPorCampo, Insignia, InsigniaDemo, mensajeError, Modal, Selector, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { FormProducto, type Producto } from './FormProducto';
import { Titulo } from './Layout';

interface Compat {
  id: number;
  modelo_id: number;
  modelo: string;
  anio_desde: number;
  anio_hasta: number;
  verificada: boolean;
  fuente: string | null;
  notas: string | null;
}
interface Detalle extends Producto {
  marca: string;
  cantidad: number;
  estado_stock: string;
  compatibilidades: Compat[];
}
interface Movimiento {
  id: number;
  tipo: string;
  cantidad: number;
  cantidad_anterior: number;
  cantidad_nueva: number;
  motivo: string | null;
  asesor: string | null;
  pedido_codigo: string | null;
  created_at: string;
}

export default function DetalleProducto() {
  const { id } = useParams();
  const { puede } = useAuth();
  const p = useCarga(() => apiAdmin<Detalle>(`/admin/productos/${id}`), [id]);
  const movs = useCarga(() => apiAdmin<{ items: Movimiento[] }>(`/admin/inventario/${id}/movimientos?tamano=30`), [id]);
  const [editar, setEditar] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);

  if (p.error) return <Alerta>{p.error}</Alerta>;
  if (!p.datos) return <Cargando />;
  const d = p.datos;
  const recargarTodo = () => {
    void p.recargar();
    void movs.recargar();
  };

  return (
    <>
      <Link to="/admin/productos" className="text-sm text-marca-700 hover:underline">
        ← Productos
      </Link>
      <Titulo acciones={puede('admin') && <Boton onClick={() => setEditar(true)}>Editar producto</Boton>}>
        <span className="flex flex-wrap items-center gap-2">
          {d.nombre} <span className="font-mono text-base text-slate-500">{d.referencia}</span>
          {d.es_demo && <InsigniaDemo />}
        </span>
      </Titulo>
      {mensaje && (
        <div className="mb-3">
          <Alerta tipo="exito">{mensaje}</Alerta>
        </div>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Tarjeta titulo="Datos" className="lg:col-span-1">
          <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
            <dt className="text-slate-500">Tipo</dt>
            <dd>
              <Insignia valor={d.tipo} /> <span className="text-slate-600">{d.marca}</span>
            </dd>
            <dt className="text-slate-500">Categoría</dt>
            <dd>
              {d.categoria.replace(/_/g, ' ')} {d.posicion && `· ${etiqueta(d.posicion)}`}
            </dd>
            <dt className="text-slate-500">Precio</dt>
            <dd className="font-semibold">{d.precio ? cop(d.precio) : <Insignia color="amarillo" texto="Sin precio confirmado" />}</dd>
            <dt className="text-slate-500">Stock</dt>
            <dd>
              <span className="font-semibold tabular-nums">{d.cantidad}</span> <Insignia valor={d.estado_stock} />
            </dd>
            <dt className="text-slate-500">Mínimo</dt>
            <dd>{d.stock_minimo}</dd>
            <dt className="text-slate-500">Ubicación</dt>
            <dd>{d.ubicacion ?? '—'}</dd>
            <dt className="text-slate-500">Abastecimiento</dt>
            <dd>{d.tiempo_abastecimiento_dias ? `${d.tiempo_abastecimiento_dias} días` : 'No confirmado'}</dd>
            <dt className="text-slate-500">Estado</dt>
            <dd>{d.activo ? 'Activo' : 'Inactivo'}</dd>
          </dl>
          {d.descripcion && <p className="mt-3 text-sm text-slate-700">{d.descripcion}</p>}
        </Tarjeta>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Compatibilidades producto={d} editable={puede('admin')} onCambio={p.recargar} />
          {puede('admin', 'vendedor') && (
            <FormMovimiento
              productoId={d.id}
              stockActual={d.cantidad}
              onHecho={(m) => {
                setMensaje(m);
                recargarTodo();
              }}
            />
          )}
        </div>
      </div>

      <Tarjeta titulo="Movimientos de inventario" className="mt-4">
        <Tabla columnas={['Fecha', 'Tipo', 'Cambio', 'Antes → Después', 'Motivo', 'Usuario']} vacio={!movs.datos?.items.length}>
          {movs.datos?.items.map((m) => (
            <tr key={m.id}>
              <td className="px-2 py-2 whitespace-nowrap">{fecha(m.created_at)}</td>
              <td className="px-2 py-2 capitalize">{m.tipo}</td>
              <td className={`px-2 py-2 font-semibold tabular-nums ${m.cantidad > 0 ? 'text-emerald-700' : 'text-red-700'}`}>{m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}</td>
              <td className="px-2 py-2 tabular-nums">
                {m.cantidad_anterior} → {m.cantidad_nueva}
              </td>
              <td className="px-2 py-2">{m.pedido_codigo ? `${m.motivo}` : m.motivo}</td>
              <td className="px-2 py-2">{m.asesor ?? (m.pedido_codigo ? 'Asistente (pedido)' : 'Sistema')}</td>
            </tr>
          ))}
        </Tabla>
      </Tarjeta>

      <Modal abierto={editar} titulo="Editar producto" onCerrar={() => setEditar(false)}>
        <FormProducto
          producto={d}
          onGuardado={() => {
            setEditar(false);
            setMensaje('Producto actualizado. El cambio de precio quedó registrado.');
            void p.recargar();
          }}
        />
      </Modal>
    </>
  );
}

function Compatibilidades({ producto, editable, onCambio }: { producto: Detalle; editable: boolean; onCambio: () => void }) {
  const modelos = useCarga(() => apiAdmin<{ id: number; nombre: string }[]>('/admin/modelos'), []);
  const [f, setF] = useState({ modelo_id: '', anio_desde: '', anio_hasta: '', verificada: true, fuente: '', notas: '' });
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));

  const agregar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrores({});
    try {
      await apiAdmin(`/admin/productos/${producto.id}/compatibilidades`, 'POST', {
        modelo_id: Number(f.modelo_id),
        anio_desde: Number(f.anio_desde),
        anio_hasta: Number(f.anio_hasta),
        verificada: f.verificada,
        fuente: f.fuente || null,
        notas: f.notas || null,
      });
      setF({ modelo_id: '', anio_desde: '', anio_hasta: '', verificada: true, fuente: '', notas: '' });
      onCambio();
    } catch (err) {
      setErrores(erroresPorCampo(err));
      setError(mensajeError(err));
    }
  };
  const eliminar = async (c: Compat) => {
    if (!confirm(`¿Eliminar la compatibilidad con ${c.modelo} ${c.anio_desde}–${c.anio_hasta}?`)) return;
    try {
      await apiAdmin(`/admin/compatibilidades/${c.id}`, 'DELETE');
      onCambio();
    } catch (err) {
      setError(mensajeError(err));
    }
  };

  return (
    <Tarjeta titulo="Compatibilidad con motos">
      {!producto.compatibilidades.length && (
        <div className="mb-3">
          <Alerta tipo="aviso">Sin compatibilidades: el asistente no mostrará este producto a ningún cliente.</Alerta>
        </div>
      )}
      <Tabla columnas={['Modelo', 'Años', 'Verificada', 'Fuente / notas', '']} vacio={false}>
        {producto.compatibilidades.map((c) => (
          <tr key={c.id}>
            <td className="px-2 py-2 font-medium">{c.modelo}</td>
            <td className="px-2 py-2 tabular-nums">
              {c.anio_desde}–{c.anio_hasta}
            </td>
            <td className="px-2 py-2">{c.verificada ? <Insignia color="verde" texto="Verificada" /> : <Insignia color="amarillo" texto="Sin verificar" />}</td>
            <td className="px-2 py-2 text-xs text-slate-600">
              {c.fuente ?? '—'}
              {c.notas && <div>{c.notas}</div>}
            </td>
            <td className="px-2 py-2 text-right">
              {editable && (
                <Boton variante="fantasma" tamano="sm" onClick={() => eliminar(c)}>
                  Quitar
                </Boton>
              )}
            </td>
          </tr>
        ))}
      </Tabla>
      {editable && (
        <form onSubmit={agregar} className="mt-4 grid gap-3 border-t border-slate-100 pt-4 sm:grid-cols-3">
          {error && (
            <div className="sm:col-span-3">
              <Alerta>{error}</Alerta>
            </div>
          )}
          <Selector etiqueta="Modelo" value={f.modelo_id} onChange={set('modelo_id')} required error={errores.modelo_id}>
            <option value="" disabled>
              Elige un modelo
            </option>
            {modelos.datos?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.nombre}
              </option>
            ))}
          </Selector>
          <Campo etiqueta="Desde (año)" type="number" min="1950" max="2100" value={f.anio_desde} onChange={set('anio_desde')} required error={errores.anio_desde} />
          <Campo etiqueta="Hasta (año)" type="number" min="1950" max="2100" value={f.anio_hasta} onChange={set('anio_hasta')} required error={errores.anio_hasta} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4" checked={f.verificada} onChange={(e) => setF((x) => ({ ...x, verificada: e.target.checked }))} />
            Compatibilidad verificada
          </label>
          <Campo etiqueta="Fuente" value={f.fuente} onChange={set('fuente')} error={errores.fuente} ayuda="Catálogo, manual o proveedor. Obligatoria si está verificada." />
          <Campo etiqueta="Notas" value={f.notas} onChange={set('notas')} />
          <div className="flex justify-end sm:col-span-3">
            <Boton type="submit">Agregar compatibilidad</Boton>
          </div>
        </form>
      )}
    </Tarjeta>
  );
}

export function FormMovimiento({ productoId, stockActual, onHecho }: { productoId: number; stockActual: number; onHecho: (mensaje: string) => void }) {
  const [tipo, setTipo] = useState<'entrada' | 'salida' | 'ajuste'>('entrada');
  const [cantidad, setCantidad] = useState('');
  const [motivo, setMotivo] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setEnviando(true);
    setError(null);
    try {
      const n = Number(cantidad);
      const cuerpo = tipo === 'ajuste' ? { tipo, cantidad_nueva: n, motivo } : { tipo, cantidad: n, motivo };
      const r = await apiAdmin<{ cantidad_nueva: number }>(`/admin/inventario/${productoId}/movimientos`, 'POST', cuerpo);
      setCantidad('');
      setMotivo('');
      onHecho(`Movimiento registrado. Stock actual: ${r.cantidad_nueva}.`);
    } catch (err) {
      setError(mensajeError(err));
    } finally {
      setEnviando(false);
    }
  };

  return (
    <Tarjeta titulo={`Registrar movimiento · stock actual ${stockActual}`}>
      <form onSubmit={enviar} className="grid gap-3 sm:grid-cols-4">
        {error && (
          <div className="sm:col-span-4">
            <Alerta>{error}</Alerta>
          </div>
        )}
        <Selector etiqueta="Tipo" value={tipo} onChange={(e) => setTipo(e.target.value as typeof tipo)}>
          <option value="entrada">Entrada (compra, devolución)</option>
          <option value="salida">Salida (daño, venta en mostrador)</option>
          <option value="ajuste">Ajuste por conteo físico</option>
        </Selector>
        <Campo etiqueta={tipo === 'ajuste' ? 'Cantidad real contada' : 'Cantidad'} type="number" min={tipo === 'ajuste' ? 0 : 1} value={cantidad} onChange={(e) => setCantidad(e.target.value)} required />
        <div className="sm:col-span-2">
          <Campo etiqueta="Motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} required minLength={3} placeholder="Ej.: compra a proveedor, factura 123" />
        </div>
        <div className="flex justify-end sm:col-span-4">
          <Boton type="submit" disabled={enviando}>
            Registrar
          </Boton>
        </div>
      </form>
    </Tarjeta>
  );
}
