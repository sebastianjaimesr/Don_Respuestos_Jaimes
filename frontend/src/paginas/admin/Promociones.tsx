import { useState, type FormEvent } from 'react';
import { useAuth } from '../../api/auth';
import { apiAdmin, qs } from '../../api/cliente';
import { cop, fecha } from '../../api/formato';
import { BuscadorProducto } from '../../componentes/BuscadorProducto';
import { aCuerpo, aTexto, CamposFormulario, type DefCampo } from '../../componentes/editor';
import { Alerta, Boton, Cargando, Insignia, Modal, Selector, Tabla, Tarjeta, erroresPorCampo, mensajeError, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Promo {
  id: number;
  nombre: string;
  descripcion: string | null;
  tipo_descuento: 'porcentaje' | 'valor';
  valor: string;
  alcance: 'producto' | 'categoria' | 'marca';
  producto_id: number | null;
  producto_sku: string | null;
  categoria: string | null;
  marca_id: number | null;
  marca: string | null;
  inicia_at: string;
  termina_at: string;
  activo: boolean;
  estado: 'vigente' | 'programada' | 'vencida' | 'inactiva';
  productos_con_esta_promocion: number;
}

const COLOR: Record<Promo['estado'], 'verde' | 'azul' | 'gris' | 'amarillo'> = { vigente: 'verde', programada: 'azul', vencida: 'gris', inactiva: 'amarillo' };

export default function Promociones() {
  const { tiene } = useAuth();
  const editar = tiene('precios.editar');
  const [estado, setEstado] = useState('');
  const lista = useCarga(() => apiAdmin<Promo[]>(`/admin/promociones${qs({ estado })}`), [estado]);
  const [editor, setEditor] = useState<Promo | null | undefined>(undefined);

  return (
    <>
      <Titulo
        descripcion="El descuento se aplica igual en la tienda, el carrito, el asistente y el pedido. Si un producto tiene varias promociones vigentes, se usa la de mejor precio para el cliente. Los productos sin precio confirmado nunca reciben promoción."
        acciones={editar && <Boton onClick={() => setEditor(null)}>Nueva promoción</Boton>}
      >
        Promociones
      </Titulo>
      <div className="mb-3 w-48">
        <Selector etiqueta="Estado" value={estado} onChange={(e) => setEstado(e.target.value)}>
          <option value="">Todas</option>
          <option value="vigente">Vigentes</option>
          <option value="programada">Programadas</option>
          <option value="vencida">Vencidas</option>
          <option value="inactiva">Inactivas</option>
        </Selector>
      </div>
      {lista.error && <Alerta>{lista.error}</Alerta>}
      {!lista.datos ? (
        <Cargando />
      ) : (
        <Tarjeta>
          <Tabla columnas={['Promoción', 'Descuento', 'Aplica a', 'Vigencia', 'Productos', 'Estado', '']} vacio={!lista.datos.length} amplia>
            {lista.datos.map((p) => (
              <tr key={p.id}>
                <td className="px-2 py-2 font-medium text-white">{p.nombre}</td>
                <td className="px-2 py-2 tabular-nums">{p.tipo_descuento === 'porcentaje' ? `${Number(p.valor)} %` : cop(p.valor)}</td>
                <td className="px-2 py-2">{p.alcance === 'producto' ? `Producto ${p.producto_sku}` : p.alcance === 'categoria' ? `Categoría ${p.categoria}` : `Marca ${p.marca}`}</td>
                <td className="px-2 py-2 text-xs">
                  {fecha(p.inicia_at)}
                  <br />
                  {fecha(p.termina_at)}
                </td>
                <td className="px-2 py-2 tabular-nums" title="Productos donde esta es hoy la mejor promoción">
                  {p.productos_con_esta_promocion}
                </td>
                <td className="px-2 py-2">
                  <Insignia color={COLOR[p.estado]} texto={p.estado[0].toUpperCase() + p.estado.slice(1)} />
                </td>
                <td className="px-2 py-2 text-right">
                  {editar && (
                    <Boton tamano="sm" variante="fantasma" onClick={() => setEditor(p)}>
                      Editar
                    </Boton>
                  )}
                </td>
              </tr>
            ))}
          </Tabla>
        </Tarjeta>
      )}
      <Modal abierto={editor !== undefined} titulo={editor ? 'Editar promoción' : 'Nueva promoción'} onCerrar={() => setEditor(undefined)}>
        {editor !== undefined && (
          <FormPromo
            promo={editor}
            onListo={async () => {
              setEditor(undefined);
              await lista.recargar();
            }}
            onCancelar={() => setEditor(undefined)}
          />
        )}
      </Modal>
    </>
  );
}

function FormPromo({ promo, onListo, onCancelar }: { promo: Promo | null; onListo: () => void; onCancelar: () => void }) {
  const cats = useCarga(() => apiAdmin<{ clave: string; etiqueta: string }[]>('/admin/categorias'), []);
  const marcas = useCarga(() => apiAdmin<{ id: number; nombre: string }[]>('/admin/marcas'), []);
  const campos: DefCampo[] = [
    { k: 'nombre', etiqueta: 'Nombre visible para el cliente', requerido: true, ancho: true, placeholder: 'Ej.: Semana del frenado' },
    {
      k: 'tipo_descuento',
      etiqueta: 'Tipo de descuento',
      tipo: 'select',
      requerido: true,
      opciones: [
        { v: 'porcentaje', t: 'Porcentaje (%)' },
        { v: 'valor', t: 'Valor fijo (COP)' },
      ],
    },
    { k: 'valor', etiqueta: 'Descuento', tipo: 'dinero', requerido: true, ayuda: 'Porcentaje máximo 90' },
    {
      k: 'alcance',
      etiqueta: 'Aplica a',
      tipo: 'select',
      requerido: true,
      opciones: [
        { v: 'producto', t: 'Un producto' },
        { v: 'categoria', t: 'Una categoría' },
        { v: 'marca', t: 'Una marca' },
      ],
    },
    { k: 'categoria', etiqueta: 'Categoría', tipo: 'select', requerido: true, opciones: (cats.datos ?? []).map((c) => ({ v: c.clave, t: c.etiqueta })), visible: (v) => v.alcance === 'categoria' },
    { k: 'marca_id', etiqueta: 'Marca', tipo: 'select', numerico: true, requerido: true, opciones: (marcas.datos ?? []).map((m) => ({ v: String(m.id), t: m.nombre })), visible: (v) => v.alcance === 'marca' },
    { k: 'inicia_at', etiqueta: 'Empieza', tipo: 'fecha_hora', requerido: true, ayuda: 'Hora de Colombia' },
    { k: 'termina_at', etiqueta: 'Termina', tipo: 'fecha_hora', requerido: true },
    { k: 'descripcion', etiqueta: 'Descripción interna', tipo: 'area' },
    { k: 'activo', etiqueta: 'Activa', tipo: 'bool' },
  ];
  const [v, setV] = useState(() => aTexto(campos, (promo as unknown as Record<string, unknown>) ?? { tipo_descuento: 'porcentaje', alcance: 'producto' }));
  const [producto, setProducto] = useState<{ id: number; sku: string; nombre?: string } | null>(promo?.producto_id ? { id: promo.producto_id, sku: promo.producto_sku ?? '' } : null);
  const [errores, setErrores] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [guardando, setGuardando] = useState(false);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setErrores({});
    const c = aCuerpo(campos, v);
    if (v.alcance === 'producto') {
      if (!producto) return setErrores({ producto_id: 'Elige el producto' });
      c.producto_id = producto.id;
    }
    for (const k of ['categoria', 'marca_id', 'producto_id']) if (c[k] === null || c[k] === '') delete c[k];
    setGuardando(true);
    try {
      await apiAdmin(promo ? `/admin/promociones/${promo.id}` : '/admin/promociones', promo ? 'PUT' : 'POST', c);
      onListo();
    } catch (err) {
      setErrores(erroresPorCampo(err));
      setError(mensajeError(err));
    } finally {
      setGuardando(false);
    }
  };

  return (
    <form onSubmit={enviar} noValidate className="grid gap-3 sm:grid-cols-2">
      {error && (
        <div className="sm:col-span-2">
          <Alerta>{error}</Alerta>
        </div>
      )}
      <CamposFormulario campos={campos} v={v} set={(k, x) => setV((o) => ({ ...o, [k]: x }))} errores={errores} />
      {v.alcance === 'producto' && (
        <div className="sm:col-span-2">
          {producto ? (
            <p className="flex items-center justify-between rounded-lg border border-white/10 px-3 py-2 text-sm">
              <span>
                <span className="font-mono text-xs text-gris-tec">{producto.sku}</span> {producto.nombre}
              </span>
              <Boton tamano="sm" variante="fantasma" onClick={() => setProducto(null)}>
                Cambiar
              </Boton>
            </p>
          ) : (
            <BuscadorProducto onElegir={(p) => setProducto(p)} />
          )}
          {errores.producto_id && <p className="mt-1 text-xs text-red-300">{errores.producto_id}</p>}
        </div>
      )}
      <div className="flex justify-end gap-2 sm:col-span-2">
        <Boton variante="secundario" onClick={onCancelar}>
          Cancelar
        </Boton>
        <Boton type="submit" disabled={guardando}>
          {guardando ? 'Guardando…' : 'Guardar'}
        </Boton>
      </div>
    </form>
  );
}
