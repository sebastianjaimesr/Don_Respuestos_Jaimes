import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { useAuth } from '../../api/auth';
import { apiAdmin, ErrorApi, urlBackend } from '../../api/cliente';
import { cop, etiqueta, fecha } from '../../api/formato';
import { Alerta, Boton, Campo, Cargando, erroresPorCampo, Insignia, InsigniaDemo, mensajeError, Modal, Selector, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { Pestanas } from '../../componentes/editor';
import { FormProducto, type Producto } from './FormProducto';
import { Titulo } from './Layout';

interface Precio {
  precio_anterior: string | null;
  precio_nuevo: string | null;
  precio_compra_anterior: string | null;
  precio_compra_nuevo: string | null;
  origen: string;
  created_at: string;
  asesor: string | null;
}
interface Compat {
  id: number;
  modelo_id: number;
  modelo: string;
  fabricante: string;
  version_id: number | null;
  version: string | null;
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
  const nav = useNavigate();
  const { tiene } = useAuth();
  const p = useCarga(() => apiAdmin<Detalle>(`/admin/productos/${id}`), [id]);
  const movs = useCarga(() => apiAdmin<{ items: Movimiento[] }>(`/admin/inventario/${id}/movimientos?tamano=30`), [id]);
  const precios = useCarga(() => apiAdmin<Precio[]>(`/admin/productos/${id}/precios`), [id]);
  const [editar, setEditar] = useState(false);
  const [mensaje, setMensaje] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pestana, setPestana] = useState<'movimientos' | 'precios'>('movimientos');

  if (p.error) return <Alerta>{p.error}</Alerta>;
  if (!p.datos) return <Cargando />;
  const d = p.datos;
  const recargarTodo = () => {
    void p.recargar();
    void movs.recargar();
    void precios.recargar();
  };
  const estado = async (cambio: { activo?: boolean; destacado?: boolean }) => {
    setError(null);
    try {
      await apiAdmin(`/admin/productos/${d.id}/estado`, 'PATCH', cambio);
      void p.recargar();
    } catch (e) {
      setError(mensajeError(e));
    }
  };
  const borrar = async () => {
    if (!confirm(`¿Borrar definitivamente ${d.sku}? Solo se puede si nunca tuvo movimientos, ventas ni compras.`)) return;
    setError(null);
    try {
      await apiAdmin(`/admin/productos/${d.id}`, 'DELETE');
      nav('/admin/productos', { replace: true });
    } catch (e) {
      setError(mensajeError(e));
    }
  };
  const margen = d.precio && d.precio_compra && Number(d.precio_compra) > 0 ? Math.round(((Number(d.precio) - Number(d.precio_compra)) / Number(d.precio)) * 100) : null;
  const editarProd = tiene('productos.editar');

  return (
    <>
      <Link to="/admin/productos" className="text-sm text-electrico-300 hover:underline">
        ← Productos
      </Link>
      <Titulo
        acciones={
          editarProd && (
            <div className="flex flex-wrap gap-2">
              <Boton variante="secundario" onClick={() => estado({ activo: !d.activo })}>
                {d.activo ? 'Desactivar' : 'Activar'}
              </Boton>
              <Boton variante="secundario" onClick={() => estado({ destacado: !d.destacado })}>
                {d.destacado ? 'Quitar de destacados' : 'Destacar'}
              </Boton>
              <Boton onClick={() => setEditar(true)}>Editar producto</Boton>
            </div>
          )
        }
      >
        <span className="flex flex-wrap items-center gap-2">
          {d.nombre} <span className="font-mono text-base text-gris-tec">{d.sku}</span>
          {d.es_demo && <InsigniaDemo />}
          {!d.activo && <Insignia color="gris" texto="Inactivo" />}
          {d.destacado && <Insignia color="azul" texto="Destacado" />}
        </span>
      </Titulo>
      {mensaje && (
        <div className="mb-3">
          <Alerta tipo="exito">{mensaje}</Alerta>
        </div>
      )}
      {error && (
        <div className="mb-3">
          <Alerta>{error}</Alerta>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="flex flex-col gap-4">
          <Tarjeta titulo="Datos">
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-sm">
              <dt className="text-gris-tec">Tipo</dt>
              <dd>
                <Insignia valor={d.tipo} texto={d.tipo === 'alternativo' ? 'Alternativo' : undefined} /> <span className="text-slate-300">{d.marca}</span>
              </dd>
              <dt className="text-gris-tec">Categoría</dt>
              <dd>
                {d.categoria_nombre ?? d.categoria.replace(/_/g, ' ')} {d.posicion && `· ${etiqueta(d.posicion)}`}
              </dd>
              <dt className="text-gris-tec">Ref. fabricante</dt>
              <dd className="font-mono text-xs">{d.referencia ?? '—'}</dd>
              <dt className="text-gris-tec">Cód. barras</dt>
              <dd className="font-mono text-xs">{d.codigo_barras ?? '—'}</dd>
              <dt className="text-gris-tec">Precio</dt>
              <dd className="font-semibold">{d.precio ? cop(d.precio) : <Insignia color="amarillo" texto="Sin precio confirmado" />}</dd>
              <dt className="text-gris-tec">Costo</dt>
              <dd>
                {d.precio_compra ? cop(d.precio_compra) : '—'}
                {margen !== null && <span className="ml-2 text-xs text-gris-tec">margen {margen} %</span>}
              </dd>
              <dt className="text-gris-tec">Stock</dt>
              <dd>
                <span className="font-semibold tabular-nums">{d.cantidad}</span> <Insignia valor={d.estado_stock} />
              </dd>
              <dt className="text-gris-tec">Mínimo</dt>
              <dd>{d.stock_minimo}</dd>
              <dt className="text-gris-tec">Ubicación</dt>
              <dd>{d.ubicacion ?? '—'}</dd>
              <dt className="text-gris-tec">Abastecimiento</dt>
              <dd>{d.tiempo_abastecimiento_dias ? `${d.tiempo_abastecimiento_dias} días` : 'No confirmado'}</dd>
            </dl>
            {d.descripcion && <p className="mt-3 text-sm text-slate-200">{d.descripcion}</p>}
            {Object.keys(d.especificaciones ?? {}).length > 0 && (
              <dl className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 border-t border-white/[0.06] pt-3 text-xs">
                {Object.entries(d.especificaciones).map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-gris-tec">{k}</dt>
                    <dd>{typeof v === 'boolean' ? (v ? 'Sí' : 'No') : String(v)}</dd>
                  </div>
                ))}
              </dl>
            )}
            {editarProd && (
              <div className="mt-4 border-t border-white/[0.06] pt-3">
                <Boton tamano="sm" variante="fantasma" onClick={borrar}>
                  Borrar producto
                </Boton>
              </div>
            )}
          </Tarjeta>
          <Imagenes productoId={d.id} editable={tiene('imagenes.editar')} />
        </div>

        <div className="flex flex-col gap-4 lg:col-span-2">
          <Compatibilidades producto={d} editable={tiene('compatibilidades.editar')} onCambio={p.recargar} />
          {tiene('inventario.mover') && (
            <FormMovimiento
              productoId={d.id}
              stockActual={d.cantidad}
              onHecho={(m) => {
                setMensaje(m);
                recargarTodo();
              }}
            />
          )}
          <Tarjeta>
            <Pestanas
              opciones={[
                { v: 'movimientos', t: 'Movimientos de inventario' },
                { v: 'precios', t: 'Historial de precios' },
              ]}
              valor={pestana}
              onCambiar={setPestana}
            />
            {pestana === 'movimientos' ? (
              <Tabla columnas={['Fecha', 'Tipo', 'Cambio', 'Antes → Después', 'Motivo', 'Usuario']} vacio={!movs.datos?.items.length} amplia>
                {movs.datos?.items.map((m) => (
                  <tr key={m.id}>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">{fecha(m.created_at)}</td>
                    <td className="px-2 py-2 capitalize">{m.tipo}</td>
                    <td className={`px-2 py-2 font-semibold tabular-nums ${m.cantidad > 0 ? 'text-emerald-300' : 'text-red-300'}`}>{m.cantidad > 0 ? `+${m.cantidad}` : m.cantidad}</td>
                    <td className="px-2 py-2 tabular-nums">
                      {m.cantidad_anterior} → {m.cantidad_nueva}
                    </td>
                    <td className="px-2 py-2 text-xs">{m.motivo}</td>
                    <td className="px-2 py-2 text-xs">{m.asesor ?? (m.pedido_codigo ? 'Tienda / asistente (pedido)' : 'Sistema')}</td>
                  </tr>
                ))}
              </Tabla>
            ) : (
              <Tabla columnas={['Fecha', 'Venta', 'Compra', 'Origen', 'Usuario']} vacio={!precios.datos?.length} amplia>
                {precios.datos?.map((h, i) => (
                  <tr key={i}>
                    <td className="px-2 py-2 text-xs whitespace-nowrap">{fecha(h.created_at)}</td>
                    <td className="px-2 py-2 text-xs tabular-nums">{cambioPrecio(h.precio_anterior, h.precio_nuevo)}</td>
                    <td className="px-2 py-2 text-xs tabular-nums">{cambioPrecio(h.precio_compra_anterior, h.precio_compra_nuevo)}</td>
                    <td className="px-2 py-2 text-xs">{ORIGEN[h.origen] ?? h.origen}</td>
                    <td className="px-2 py-2 text-xs">{h.asesor ?? 'Sistema'}</td>
                  </tr>
                ))}
              </Tabla>
            )}
          </Tarjeta>
        </div>
      </div>

      <Modal abierto={editar} titulo="Editar producto" onCerrar={() => setEditar(false)} ancho="max-w-3xl">
        {editar && (
          <FormProducto
            producto={d}
            onGuardado={() => {
              setEditar(false);
              setMensaje('Producto actualizado. Si cambió el precio, quedó en el historial.');
              recargarTodo();
            }}
          />
        )}
      </Modal>
    </>
  );
}

const ORIGEN: Record<string, string> = { manual: 'Edición', masivo: 'Precios masivos', importacion: 'Importación', compra: 'Compra recibida' };
const cambioPrecio = (a: string | null, b: string | null) => (String(a) === String(b) ? '—' : `${a ? cop(a) : 'sin precio'} → ${b ? cop(b) : 'sin precio'}`);

interface Imagen {
  id: number;
  url: string;
  alt: string | null;
  orden: number;
  es_principal: boolean;
}
const TIPOS_IMG = ['image/jpeg', 'image/png', 'image/webp'];

/** Fotos reales del producto. Se suben directo al almacenamiento con una URL firmada. */
function Imagenes({ productoId, editable }: { productoId: number; editable: boolean }) {
  const imgs = useCarga(() => apiAdmin<Imagen[]>(`/admin/productos/${productoId}/imagenes`), [productoId]);
  const [error, setError] = useState<string | null>(null);
  const [subiendo, setSubiendo] = useState(false);
  const subir = async (archivo: File) => {
    setError(null);
    if (!TIPOS_IMG.includes(archivo.type)) return setError('Solo JPG, PNG o WebP');
    if (archivo.size > 5 * 1024 * 1024) return setError('La imagen supera 5 MB');
    setSubiendo(true);
    try {
      const f = await apiAdmin<{ clave: string; subida: { url: string; metodo: string; encabezados: Record<string, string> } }>(`/admin/productos/${productoId}/imagenes/firma`, 'POST', {
        tipo: archivo.type,
        bytes: archivo.size,
      });
      const r = await fetch(urlBackend(f.subida.url), { method: f.subida.metodo, headers: f.subida.encabezados, body: archivo });
      if (!r.ok) throw new Error('El almacenamiento rechazó la imagen');
      await apiAdmin(`/admin/productos/${productoId}/imagenes`, 'POST', { clave: f.clave, alt: null });
      await imgs.recargar();
    } catch (e) {
      setError(e instanceof Error && !(e instanceof ErrorApi) ? e.message : mensajeError(e));
    } finally {
      setSubiendo(false);
    }
  };
  const accion = async (f: () => Promise<unknown>) => {
    setError(null);
    try {
      await f();
      await imgs.recargar();
    } catch (e) {
      setError(mensajeError(e));
    }
  };
  return (
    <Tarjeta titulo="Fotos">
      {error && (
        <div className="mb-3">
          <Alerta>{error}</Alerta>
        </div>
      )}
      {imgs.error ? (
        <Alerta>{imgs.error}</Alerta>
      ) : !imgs.datos ? (
        <Cargando />
      ) : imgs.datos.length === 0 ? (
        <p className="text-sm text-gris-tec">Sin fotos. La tienda muestra una ilustración de la categoría marcada como "Ilustración".</p>
      ) : (
        <ul className="grid grid-cols-2 gap-2">
          {imgs.datos.map((i) => (
            <li key={i.id} className={`overflow-hidden rounded-xl border ${i.es_principal ? 'border-electrico-400' : 'border-white/10'}`}>
              <img src={i.url} alt={i.alt ?? ''} className="aspect-square w-full bg-noche-900 object-contain" loading="lazy" />
              {editable && (
                <div className="flex justify-between gap-1 p-1">
                  {i.es_principal ? (
                    <span className="px-1 text-[11px] text-electrico-300">Principal</span>
                  ) : (
                    <button type="button" className="px-1 text-[11px] text-slate-300 hover:text-white" onClick={() => accion(() => apiAdmin(`/admin/imagenes/${i.id}`, 'PATCH', { principal: true }))}>
                      Hacer principal
                    </button>
                  )}
                  <button
                    type="button"
                    className="px-1 text-[11px] text-rose-300 hover:text-rose-200"
                    onClick={() => confirm('¿Borrar esta foto?') && accion(() => apiAdmin(`/admin/imagenes/${i.id}`, 'DELETE'))}
                  >
                    Borrar
                  </button>
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {editable && (
        <label className="mt-3 inline-flex cursor-pointer items-center gap-2 rounded-lg border border-white/15 px-3 py-2 text-sm hover:bg-white/[0.04]">
          {subiendo ? 'Subiendo…' : 'Subir foto (JPG, PNG o WebP, máx. 5 MB)'}
          <input
            type="file"
            accept="image/jpeg,image/png,image/webp"
            className="sr-only"
            disabled={subiendo}
            onChange={(e) => {
              const a = e.target.files?.[0];
              e.target.value = '';
              if (a) void subir(a);
            }}
          />
        </label>
      )}
    </Tarjeta>
  );
}

function Compatibilidades({ producto, editable, onCambio }: { producto: Detalle; editable: boolean; onCambio: () => void }) {
  const modelos = useCarga(() => apiAdmin<{ id: number; nombre: string; fabricante?: string }[]>('/admin/modelos'), []);
  const VACIO = { modelo_id: '', version_id: '', anio_desde: '', anio_hasta: '', verificada: false, fuente: '', notas: '' };
  const [f, setF] = useState(VACIO);
  const versiones = useCarga(() => (f.modelo_id ? apiAdmin<{ id: number; nombre: string; activo: boolean }[]>(`/admin/versiones?modelo_id=${f.modelo_id}`) : Promise.resolve([])), [f.modelo_id]);
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
        version_id: f.version_id ? Number(f.version_id) : null,
        anio_desde: Number(f.anio_desde),
        anio_hasta: Number(f.anio_hasta),
        verificada: f.verificada,
        fuente: f.fuente || null,
        notas: f.notas || null,
      });
      setF(VACIO);
      onCambio();
    } catch (err) {
      setErrores(erroresPorCampo(err));
      setError(mensajeError(err));
    }
  };
  const eliminar = async (c: Compat) => {
    if (!confirm(`¿Eliminar la compatibilidad con ${c.fabricante} ${c.modelo} ${c.anio_desde}–${c.anio_hasta}?`)) return;
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
          <Alerta tipo="aviso">Sin compatibilidades: no aparece al filtrar por moto en la tienda y el asistente no lo recomienda para ninguna moto.</Alerta>
        </div>
      )}
      <Tabla columnas={['Modelo', 'Años', 'Verificada', 'Fuente / notas', '']} vacio={false}>
        {producto.compatibilidades.map((c) => (
          <tr key={c.id}>
            <td className="px-2 py-2 font-medium">
              {c.fabricante} {c.modelo}
              {c.version && <span className="block text-xs font-normal text-gris-tec">Versión {c.version}</span>}
            </td>
            <td className="px-2 py-2 tabular-nums">
              {c.anio_desde}–{c.anio_hasta}
            </td>
            <td className="px-2 py-2">{c.verificada ? <Insignia color="verde" texto="Verificada" /> : <Insignia color="amarillo" texto="Sin verificar" />}</td>
            <td className="px-2 py-2 text-xs text-slate-300">
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
        <form onSubmit={agregar} className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4 sm:grid-cols-2 lg:grid-cols-4">
          {error && (
            <div className="sm:col-span-full">
              <Alerta>{error}</Alerta>
            </div>
          )}
          <Selector etiqueta="Modelo" value={f.modelo_id} onChange={(e) => setF((x) => ({ ...x, modelo_id: e.target.value, version_id: '' }))} required error={errores.modelo_id}>
            <option value="">Elige un modelo</option>
            {modelos.datos?.map((m) => (
              <option key={m.id} value={m.id}>
                {m.fabricante ? `${m.fabricante} ${m.nombre}` : m.nombre}
              </option>
            ))}
          </Selector>
          <Selector etiqueta="Versión (opcional)" value={f.version_id} onChange={set('version_id')} disabled={!versiones.datos?.length} ayuda={f.modelo_id && !versiones.datos?.length ? 'Este modelo no tiene versiones registradas' : 'Solo si el repuesto sirve para una versión específica'}>
            <option value="">Todas las versiones</option>
            {versiones.datos?.map((v) => (
              <option key={v.id} value={v.id}>
                {v.nombre}
              </option>
            ))}
          </Selector>
          <Campo etiqueta="Desde (año)" type="number" min="1950" max="2100" value={f.anio_desde} onChange={set('anio_desde')} required error={errores.anio_desde} />
          <Campo etiqueta="Hasta (año)" type="number" min="1950" max="2100" value={f.anio_hasta} onChange={set('anio_hasta')} required error={errores.anio_hasta} />
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="h-4 w-4 accent-electrico-500" checked={f.verificada} onChange={(e) => setF((x) => ({ ...x, verificada: e.target.checked }))} />
            Verificada (con catálogo, manual o prueba)
          </label>
          <Campo etiqueta="Fuente" value={f.fuente} onChange={set('fuente')} error={errores.fuente} ayuda="Catálogo, manual o proveedor. Obligatoria si está verificada." />
          <Campo etiqueta="Notas" value={f.notas} onChange={set('notas')} />
          <div className="flex justify-end sm:col-span-full">
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
