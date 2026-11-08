import { useState, type FormEvent } from 'react';
import { useAuth } from '../../api/auth';
import { apiAdmin, qs } from '../../api/cliente';
import { cop, fecha } from '../../api/formato';
import { BuscadorProducto } from '../../componentes/BuscadorProducto';
import { Alerta, AreaTexto, Boton, Campo, Cargando, Insignia, Modal, Selector, Tabla, Tarjeta, erroresPorCampo, mensajeError, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface CompraFila {
  id: number;
  codigo: string;
  estado: 'borrador' | 'recibida' | 'anulada';
  fecha_compra: string;
  factura_proveedor: string | null;
  subtotal: string;
  recibida_at: string | null;
  proveedor: string;
  lineas: number;
}
interface Linea {
  producto_id: number;
  sku: string;
  nombre: string;
  cantidad: number;
  costo_unitario: string;
  subtotal?: string;
}
interface Compra extends Omit<CompraFila, 'lineas'> {
  proveedor_id: number;
  notas: string | null;
  asesor: string | null;
  lineas: Linea[];
}

const COLOR = { borrador: 'amarillo', recibida: 'verde', anulada: 'gris' } as const;
const TAMANO = 30;

/**
 * Compras a proveedores. Un borrador no toca el stock; al RECIBIRLA cada línea
 * entra al inventario como movimiento de "entrada" ligado a la compra.
 */
export default function Compras() {
  const { tiene } = useAuth();
  const gestionar = tiene('compras.gestionar');
  const [estado, setEstado] = useState('');
  const [pagina, setPagina] = useState(1);
  const lista = useCarga(() => apiAdmin<{ items: CompraFila[] }>(`/admin/compras${qs({ estado, pagina, tamano: TAMANO })}`), [estado, pagina]);
  const [abierta, setAbierta] = useState<number | 'nueva' | null>(null);

  return (
    <>
      <Titulo
        descripcion="Registra lo que le compras a cada proveedor. El stock sube solo cuando marcas la compra como recibida, y queda ligado a ella en los movimientos."
        acciones={gestionar && <Boton onClick={() => setAbierta('nueva')}>Nueva compra</Boton>}
      >
        Compras
      </Titulo>
      <div className="mb-3 w-48">
        <Selector
          etiqueta="Estado"
          value={estado}
          onChange={(e) => {
            setEstado(e.target.value);
            setPagina(1);
          }}
        >
          <option value="">Todas</option>
          <option value="borrador">Borrador</option>
          <option value="recibida">Recibida</option>
          <option value="anulada">Anulada</option>
        </Selector>
      </div>
      {lista.error && <Alerta>{lista.error}</Alerta>}
      {!lista.datos ? (
        <Cargando />
      ) : (
        <Tarjeta>
          <Tabla columnas={['Compra', 'Proveedor', 'Fecha', 'Factura', 'Líneas', 'Total', 'Estado']} vacio={!lista.datos.items.length} amplia>
            {lista.datos.items.map((c) => (
              <tr key={c.id} className="cursor-pointer hover:bg-white/[0.04]" onClick={() => setAbierta(c.id)}>
                <td className="px-2 py-2 font-mono text-xs text-electrico-300">{c.codigo}</td>
                <td className="px-2 py-2">{c.proveedor}</td>
                <td className="px-2 py-2 text-xs">{fecha(c.fecha_compra, false)}</td>
                <td className="px-2 py-2 text-xs">{c.factura_proveedor ?? '—'}</td>
                <td className="px-2 py-2 tabular-nums">{c.lineas}</td>
                <td className="px-2 py-2 tabular-nums">{cop(c.subtotal)}</td>
                <td className="px-2 py-2">
                  <Insignia color={COLOR[c.estado]} texto={c.estado[0].toUpperCase() + c.estado.slice(1)} />
                </td>
              </tr>
            ))}
          </Tabla>
          <div className="flex justify-end gap-2 pt-3">
            <Boton variante="secundario" tamano="sm" disabled={pagina <= 1} onClick={() => setPagina((p) => p - 1)}>
              Anterior
            </Boton>
            <Boton variante="secundario" tamano="sm" disabled={lista.datos.items.length < TAMANO} onClick={() => setPagina((p) => p + 1)}>
              Siguiente
            </Boton>
          </div>
        </Tarjeta>
      )}
      <Modal abierto={abierta !== null} titulo={abierta === 'nueva' ? 'Nueva compra' : 'Compra'} onCerrar={() => setAbierta(null)} ancho="max-w-4xl">
        {abierta !== null && (
          <DetalleCompra
            id={abierta === 'nueva' ? null : abierta}
            onCambio={() => void lista.recargar()}
            onCreada={(id) => setAbierta(id)}
          />
        )}
      </Modal>
    </>
  );
}

function DetalleCompra({ id, onCambio, onCreada }: { id: number | null; onCambio: () => void; onCreada: (id: number) => void }) {
  const { tiene } = useAuth();
  const gestionar = tiene('compras.gestionar');
  const compra = useCarga(() => (id ? apiAdmin<Compra>(`/admin/compras/${id}`) : Promise.resolve(null)), [id]);
  const provs = useCarga(() => apiAdmin<{ id: number; nombre: string; activo: boolean }[]>('/admin/proveedores'), []);
  if (compra.error) return <Alerta>{compra.error}</Alerta>;
  if (id && !compra.datos) return <Cargando />;
  const c = compra.datos;
  const editable = gestionar && (!c || c.estado === 'borrador');
  return (
    <>
      {c && (
        <div className="mb-4 flex flex-wrap items-center gap-3 text-sm">
          <span className="font-mono text-white">{c.codigo}</span>
          <Insignia color={COLOR[c.estado]} texto={c.estado[0].toUpperCase() + c.estado.slice(1)} />
          {c.recibida_at && <span className="text-gris-tec">Recibida el {fecha(c.recibida_at)}</span>}
          {c.asesor && <span className="text-gris-tec">Creada por {c.asesor}</span>}
        </div>
      )}
      {editable ? (
        <FormCompra
          key={c?.id ?? 'nueva'}
          compra={c}
          proveedores={(provs.datos ?? []).filter((p) => p.activo || p.id === c?.proveedor_id)}
          onGuardada={(nueva) => {
            onCambio();
            if (!id) onCreada(nueva.id);
            else void compra.recargar();
          }}
        />
      ) : (
        c && <VistaCompra c={c} />
      )}
      {c && gestionar && c.estado !== 'anulada' && (
        <Acciones
          c={c}
          onHecho={() => {
            onCambio();
            void compra.recargar();
          }}
        />
      )}
    </>
  );
}

function VistaCompra({ c }: { c: Compra }) {
  return (
    <div className="space-y-3 text-sm">
      <p>
        <span className="text-gris-tec">Proveedor:</span> {c.proveedor} · <span className="text-gris-tec">Factura:</span> {c.factura_proveedor ?? '—'} · <span className="text-gris-tec">Fecha:</span>{' '}
        {fecha(c.fecha_compra, false)}
      </p>
      <Tabla columnas={['Producto', 'Cantidad', 'Costo unitario', 'Subtotal']}>
        {c.lineas.map((l) => (
          <tr key={l.producto_id}>
            <td className="px-2 py-2">
              <span className="font-mono text-xs text-gris-tec">{l.sku}</span> {l.nombre}
            </td>
            <td className="px-2 py-2 tabular-nums">{l.cantidad}</td>
            <td className="px-2 py-2 tabular-nums">{cop(l.costo_unitario)}</td>
            <td className="px-2 py-2 tabular-nums">{cop(l.subtotal ?? 0)}</td>
          </tr>
        ))}
      </Tabla>
      <p className="text-right font-semibold text-white">Total {cop(c.subtotal)}</p>
      {c.notas && <p className="text-xs whitespace-pre-line text-gris-tec">{c.notas}</p>}
    </div>
  );
}

function FormCompra({ compra, proveedores, onGuardada }: { compra: Compra | null; proveedores: { id: number; nombre: string }[]; onGuardada: (c: Compra) => void }) {
  const [f, setF] = useState({
    proveedor_id: compra ? String(compra.proveedor_id) : '',
    factura_proveedor: compra?.factura_proveedor ?? '',
    fecha_compra: compra?.fecha_compra?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    notas: compra?.notas ?? '',
  });
  const [lineas, setLineas] = useState<{ producto_id: number; sku: string; nombre: string; cantidad: string; costo_unitario: string }[]>(
    compra?.lineas.map((l) => ({ ...l, cantidad: String(l.cantidad), costo_unitario: String(Number(l.costo_unitario)) })) ?? [],
  );
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);
  const total = lineas.reduce((s, l) => s + (Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0), 0);

  const guardar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrores({});
    setGuardando(true);
    try {
      const cuerpo = {
        proveedor_id: Number(f.proveedor_id) || undefined,
        factura_proveedor: f.factura_proveedor || null,
        fecha_compra: f.fecha_compra || undefined,
        notas: f.notas || null,
        lineas: lineas.map((l) => ({ producto_id: l.producto_id, cantidad: Number(l.cantidad), costo_unitario: Number(l.costo_unitario) })),
      };
      const r = compra ? await apiAdmin<Compra>(`/admin/compras/${compra.id}`, 'PUT', cuerpo) : await apiAdmin<Compra>('/admin/compras', 'POST', cuerpo);
      onGuardada(r);
    } catch (err) {
      setErrores(erroresPorCampo(err));
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form onSubmit={guardar} noValidate className="space-y-4">
      {error && <Alerta>{error}</Alerta>}
      <div className="grid gap-3 sm:grid-cols-3">
        <Selector etiqueta="Proveedor" value={f.proveedor_id} onChange={(e) => setF((x) => ({ ...x, proveedor_id: e.target.value }))} error={errores.proveedor_id} required>
          <option value="">Elige uno</option>
          {proveedores.map((p) => (
            <option key={p.id} value={p.id}>
              {p.nombre}
            </option>
          ))}
        </Selector>
        <Campo etiqueta="N.º de factura del proveedor (opcional)" value={f.factura_proveedor} onChange={(e) => setF((x) => ({ ...x, factura_proveedor: e.target.value }))} />
        <Campo etiqueta="Fecha de compra" type="date" value={f.fecha_compra} onChange={(e) => setF((x) => ({ ...x, fecha_compra: e.target.value }))} error={errores.fecha_compra} />
      </div>
      {proveedores.length === 0 && <Alerta tipo="aviso">Primero registra un proveedor en Inventario → Proveedores.</Alerta>}
      <div>
        <BuscadorProducto
          etiqueta="Agregar producto"
          excluir={lineas.map((l) => l.producto_id)}
          onElegir={(p) => setLineas((ls) => [...ls, { producto_id: p.id, sku: p.sku, nombre: p.nombre, cantidad: '1', costo_unitario: '' }])}
        />
        {errores.lineas && <p className="mt-1 text-xs text-red-300">{errores.lineas}</p>}
      </div>
      {lineas.length > 0 && (
        <Tabla columnas={['Producto', 'Cantidad', 'Costo unitario (COP)', 'Subtotal', '']}>
          {lineas.map((l, i) => {
            const cambiar = (k: 'cantidad' | 'costo_unitario') => (e: { target: { value: string } }) => setLineas((ls) => ls.map((x, j) => (j === i ? { ...x, [k]: e.target.value } : x)));
            return (
              <tr key={l.producto_id}>
                <td className="px-2 py-2">
                  <span className="font-mono text-xs text-gris-tec">{l.sku}</span> {l.nombre}
                  {(errores[`lineas.${i}.cantidad`] || errores[`lineas.${i}.costo_unitario`]) && (
                    <span className="block text-xs text-red-300">{errores[`lineas.${i}.cantidad`] ?? errores[`lineas.${i}.costo_unitario`]}</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  <input aria-label={`Cantidad de ${l.nombre}`} type="number" min="1" value={l.cantidad} onChange={cambiar('cantidad')} className="w-20 rounded-lg border border-white/15 bg-noche-900 px-2 py-1.5 text-sm" />
                </td>
                <td className="px-2 py-2">
                  <input aria-label={`Costo unitario de ${l.nombre}`} type="number" min="0" step="0.01" value={l.costo_unitario} onChange={cambiar('costo_unitario')} className="w-32 rounded-lg border border-white/15 bg-noche-900 px-2 py-1.5 text-sm" />
                </td>
                <td className="px-2 py-2 tabular-nums">{cop((Number(l.cantidad) || 0) * (Number(l.costo_unitario) || 0))}</td>
                <td className="px-2 py-2 text-right">
                  <Boton tamano="sm" variante="fantasma" onClick={() => setLineas((ls) => ls.filter((_, j) => j !== i))}>
                    Quitar
                  </Boton>
                </td>
              </tr>
            );
          })}
        </Tabla>
      )}
      <p className="text-right text-sm">
        Total: <span className="font-semibold text-white">{cop(total)}</span>
      </p>
      <AreaTexto etiqueta="Notas (opcional)" value={f.notas} onChange={(e) => setF((x) => ({ ...x, notas: e.target.value }))} />
      <div className="flex justify-end">
        <Boton type="submit" disabled={guardando}>
          {guardando ? 'Guardando…' : compra ? 'Guardar borrador' : 'Crear borrador'}
        </Boton>
      </div>
    </form>
  );
}

function Acciones({ c, onHecho }: { c: Compra; onHecho: () => void }) {
  const { tiene } = useAuth();
  const [costos, setCostos] = useState(false);
  const [motivo, setMotivo] = useState('');
  const [anulando, setAnulando] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const hacer = async (f: () => Promise<unknown>) => {
    setError(null);
    setOcupado(true);
    try {
      await f();
      setAnulando(false);
      onHecho();
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupado(false);
    }
  };
  return (
    <div className="mt-5 space-y-3 border-t border-white/10 pt-4">
      {error && <Alerta>{error}</Alerta>}
      {c.estado === 'borrador' && (
        <div className="flex flex-wrap items-center gap-3">
          <Boton disabled={ocupado} onClick={() => hacer(() => apiAdmin(`/admin/compras/${c.id}/recibir`, 'POST', { actualizar_costos: costos }))}>
            Marcar como recibida (sube el stock)
          </Boton>
          {tiene('precios.editar') && (
            <label className="flex items-center gap-2 text-sm">
              <input type="checkbox" className="h-4 w-4 accent-electrico-500" checked={costos} onChange={(e) => setCostos(e.target.checked)} />
              Actualizar el precio de compra de los productos con estos costos
            </label>
          )}
        </div>
      )}
      {anulando ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="min-w-64 flex-1">
            <Campo etiqueta="Motivo de la anulación" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
          </div>
          <Boton variante="peligro" disabled={ocupado || motivo.trim().length < 3} onClick={() => hacer(() => apiAdmin(`/admin/compras/${c.id}/anular`, 'POST', { motivo }))}>
            Confirmar anulación
          </Boton>
          <Boton variante="secundario" onClick={() => setAnulando(false)}>
            Cancelar
          </Boton>
        </div>
      ) : (
        <Boton variante="secundario" onClick={() => setAnulando(true)}>
          Anular compra
        </Boton>
      )}
      {c.estado === 'recibida' && <p className="text-xs text-gris-tec">Al anular una compra recibida se sacan sus unidades del inventario (si todavía están).</p>}
    </div>
  );
}
