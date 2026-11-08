import { useState } from 'react';
import { useAuth } from '../../api/auth';
import { apiAdmin } from '../../api/cliente';
import { EditorModal, EstadoActivo, type DefCampo } from '../../componentes/editor';
import { Alerta, Boton, Cargando, InsigniaDemo, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Fabricante {
  id: number;
  nombre: string;
  slug: string;
  alias: string[];
  logo_url: string | null;
  orden: number;
  activo: boolean;
  modelos: number;
}
interface Modelo {
  id: number;
  fabricante_id: number;
  fabricante: string;
  nombre: string;
  cilindraje_cc: number | null;
  anio_inicio: number | null;
  anio_fin: number | null;
  alias: string[];
  activo: boolean;
  es_demo: boolean;
}
interface Version {
  id: number;
  modelo_id: number;
  nombre: string;
  cilindraje_cc: number | null;
  anio_desde: number | null;
  anio_hasta: number | null;
  alias: string[];
  activo: boolean;
  es_demo: boolean;
}

const CAMPOS_FABRICANTE: DefCampo[] = [
  { k: 'nombre', etiqueta: 'Nombre', requerido: true },
  { k: 'orden', etiqueta: 'Orden en la tienda', tipo: 'numero', requerido: true, ayuda: 'Menor número = aparece primero' },
  { k: 'alias', etiqueta: 'Alias', tipo: 'lista', ayuda: 'Otras formas de escribirlo (ej. "yamaja"): ayudan a la búsqueda', ancho: true },
  { k: 'logo_url', etiqueta: 'URL del logo', ayuda: 'Debe empezar por https://', ancho: true },
  { k: 'activo', etiqueta: 'Activo', tipo: 'bool' },
];
const camposModelo = (fabricantes: Fabricante[]): DefCampo[] => [
  { k: 'fabricante_id', etiqueta: 'Fabricante', tipo: 'select', numerico: true, requerido: true, opciones: fabricantes.map((f) => ({ v: String(f.id), t: f.nombre })) },
  { k: 'nombre', etiqueta: 'Modelo', requerido: true, placeholder: 'Ej.: NKD 125' },
  { k: 'cilindraje_cc', etiqueta: 'Cilindraje (cc)', tipo: 'numero' },
  { k: 'anio_inicio', etiqueta: 'Año desde', tipo: 'numero' },
  { k: 'anio_fin', etiqueta: 'Año hasta', tipo: 'numero', ayuda: 'Vacío si se sigue fabricando' },
  { k: 'alias', etiqueta: 'Alias', tipo: 'lista', ayuda: 'Ej.: "nkd", "nkd125"', ancho: true },
  { k: 'activo', etiqueta: 'Activo', tipo: 'bool' },
];
const CAMPOS_VERSION: DefCampo[] = [
  { k: 'nombre', etiqueta: 'Versión', requerido: true, placeholder: 'Ej.: FI, Carburada, ABS' },
  { k: 'cilindraje_cc', etiqueta: 'Cilindraje (cc)', tipo: 'numero' },
  { k: 'anio_desde', etiqueta: 'Año desde', tipo: 'numero' },
  { k: 'anio_hasta', etiqueta: 'Año hasta', tipo: 'numero' },
  { k: 'alias', etiqueta: 'Alias', tipo: 'lista', ancho: true },
  { k: 'activo', etiqueta: 'Activo', tipo: 'bool' },
];

const anios = (a: number | null, b: number | null) => (a || b ? `${a ?? '¿?'}–${b ?? 'hoy'}` : '—');

/** Fabricantes → modelos → versiones. Es la base de las compatibilidades. */
export default function Motos() {
  const { tiene } = useAuth();
  const editar = tiene('productos.editar');
  const fabs = useCarga(() => apiAdmin<Fabricante[]>('/admin/fabricantes'), []);
  const modelos = useCarga(() => apiAdmin<Modelo[]>('/admin/modelos'), []);
  const [fabSel, setFabSel] = useState<number | null>(null);
  const [modSel, setModSel] = useState<number | null>(null);
  const versiones = useCarga(() => (modSel ? apiAdmin<Version[]>(`/admin/versiones?modelo_id=${modSel}`) : Promise.resolve([])), [modSel]);
  const [editor, setEditor] = useState<{ tipo: 'fab' | 'mod' | 'ver'; fila: Record<string, unknown> | null } | null>(null);

  if (fabs.error) return <Alerta>{fabs.error}</Alerta>;
  if (!fabs.datos || !modelos.datos) return <Cargando />;
  const fab = fabs.datos.find((f) => f.id === fabSel) ?? null;
  const delFab = modelos.datos.filter((m) => !fabSel || m.fabricante_id === fabSel);
  const mod = modelos.datos.find((m) => m.id === modSel) ?? null;

  const guardar = (tipo: 'fab' | 'mod' | 'ver', fila: Record<string, unknown> | null) => async (c: Record<string, unknown>) => {
    const id = fila?.id as number | undefined;
    if (tipo === 'fab') await apiAdmin(id ? `/admin/fabricantes/${id}` : '/admin/fabricantes', id ? 'PUT' : 'POST', c);
    if (tipo === 'mod') await apiAdmin(id ? `/admin/modelos/${id}` : '/admin/modelos', id ? 'PUT' : 'POST', c);
    if (tipo === 'ver') await apiAdmin(id ? `/admin/versiones/${id}` : '/admin/versiones', id ? 'PUT' : 'POST', { ...c, modelo_id: modSel });
    await Promise.all([fabs.recargar(), modelos.recargar(), versiones.recargar()]);
  };

  const fila = 'cursor-pointer hover:bg-white/[0.04]';
  const sel = 'bg-electrico-500/10';
  return (
    <>
      <Titulo descripcion="Las compatibilidades de cada repuesto se registran contra estos modelos y versiones. Lo que no esté aquí no se puede marcar como compatible.">Motos</Titulo>
      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)]">
        <Tarjeta
          titulo={`Fabricantes (${fabs.datos.length})`}
          acciones={
            editar && (
              <Boton tamano="sm" onClick={() => setEditor({ tipo: 'fab', fila: null })}>
                Nuevo
              </Boton>
            )
          }
        >
          <Tabla columnas={['Fabricante', 'Modelos', 'Estado', '']}>
            {fabs.datos.map((f) => (
              <tr
                key={f.id}
                className={`${fila} ${f.id === fabSel ? sel : ''}`}
                onClick={() => {
                  setFabSel(f.id === fabSel ? null : f.id);
                  setModSel(null);
                }}
              >
                <td className="px-2 py-2 font-medium text-white">{f.nombre}</td>
                <td className="px-2 py-2 tabular-nums">{f.modelos}</td>
                <td className="px-2 py-2">
                  <EstadoActivo activo={f.activo} />
                </td>
                <td className="px-2 py-2 text-right">
                  {editar && (
                    <Boton
                      tamano="sm"
                      variante="fantasma"
                      onClick={(e) => {
                        e.stopPropagation();
                        setEditor({ tipo: 'fab', fila: f as unknown as Record<string, unknown> });
                      }}
                    >
                      Editar
                    </Boton>
                  )}
                </td>
              </tr>
            ))}
          </Tabla>
        </Tarjeta>

        <div className="space-y-4">
          <Tarjeta
            titulo={fab ? `Modelos de ${fab.nombre} (${delFab.length})` : `Todos los modelos (${delFab.length})`}
            acciones={
              editar && (
                <Boton tamano="sm" onClick={() => setEditor({ tipo: 'mod', fila: fabSel ? { fabricante_id: fabSel } : null })}>
                  Nuevo modelo
                </Boton>
              )
            }
          >
            <Tabla columnas={['Modelo', 'cc', 'Años', 'Estado', '']} vacio={!delFab.length} amplia>
              {delFab.map((m) => (
                <tr key={m.id} className={`${fila} ${m.id === modSel ? sel : ''}`} onClick={() => setModSel(m.id === modSel ? null : m.id)}>
                  <td className="px-2 py-2">
                    <span className="font-medium text-white">{m.nombre}</span>
                    {!fabSel && <span className="ml-1 text-xs text-gris-tec">· {m.fabricante}</span>} {m.es_demo && <InsigniaDemo />}
                    {m.alias.length > 0 && <span className="block text-xs text-gris-tec">Alias: {m.alias.join(', ')}</span>}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{m.cilindraje_cc ?? '—'}</td>
                  <td className="px-2 py-2 tabular-nums">{anios(m.anio_inicio, m.anio_fin)}</td>
                  <td className="px-2 py-2">
                    <EstadoActivo activo={m.activo} />
                  </td>
                  <td className="px-2 py-2 text-right">
                    {editar && (
                      <Boton
                        tamano="sm"
                        variante="fantasma"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditor({ tipo: 'mod', fila: m as unknown as Record<string, unknown> });
                        }}
                      >
                        Editar
                      </Boton>
                    )}
                  </td>
                </tr>
              ))}
            </Tabla>
          </Tarjeta>

          {mod && (
            <Tarjeta
              titulo={`Versiones de ${mod.fabricante} ${mod.nombre}`}
              acciones={
                editar && (
                  <Boton tamano="sm" onClick={() => setEditor({ tipo: 'ver', fila: null })}>
                    Nueva versión
                  </Boton>
                )
              }
            >
              <p className="mb-2 text-xs text-gris-tec">Úsalas cuando un repuesto solo sirve para una variante del modelo (por ejemplo inyección vs. carburador).</p>
              {versiones.cargando ? (
                <Cargando />
              ) : (
                <Tabla columnas={['Versión', 'cc', 'Años', 'Estado', '']} vacio={!versiones.datos?.length}>
                  {versiones.datos?.map((v) => (
                    <tr key={v.id}>
                      <td className="px-2 py-2 font-medium text-white">
                        {v.nombre} {v.es_demo && <InsigniaDemo />}
                      </td>
                      <td className="px-2 py-2 tabular-nums">{v.cilindraje_cc ?? '—'}</td>
                      <td className="px-2 py-2 tabular-nums">{anios(v.anio_desde, v.anio_hasta)}</td>
                      <td className="px-2 py-2">
                        <EstadoActivo activo={v.activo} />
                      </td>
                      <td className="px-2 py-2 text-right">
                        {editar && (
                          <Boton tamano="sm" variante="fantasma" onClick={() => setEditor({ tipo: 'ver', fila: v as unknown as Record<string, unknown> })}>
                            Editar
                          </Boton>
                        )}
                      </td>
                    </tr>
                  ))}
                </Tabla>
              )}
            </Tarjeta>
          )}
        </div>
      </div>

      {editor && (
        <EditorModal
          abierto
          titulo={`${editor.fila?.id ? 'Editar' : 'Nuevo'} ${editor.tipo === 'fab' ? 'fabricante' : editor.tipo === 'mod' ? 'modelo' : 'versión'}`}
          campos={editor.tipo === 'fab' ? CAMPOS_FABRICANTE : editor.tipo === 'mod' ? camposModelo(fabs.datos) : CAMPOS_VERSION}
          fila={editor.fila ?? (editor.tipo === 'fab' ? { orden: 100 } : null)}
          onCerrar={() => setEditor(null)}
          guardar={guardar(editor.tipo, editor.fila)}
        />
      )}
    </>
  );
}
