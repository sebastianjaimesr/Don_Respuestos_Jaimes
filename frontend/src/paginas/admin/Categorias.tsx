import { useState } from 'react';
import { useAuth } from '../../api/auth';
import { apiAdmin } from '../../api/cliente';
import { EditorModal, EstadoActivo, Pestanas, type DefCampo } from '../../componentes/editor';
import { Alerta, Boton, Cargando, Insignia, InsigniaDemo, Tabla, Tarjeta, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

interface Categoria {
  id: number;
  slug: string;
  nombre: string;
  padre: string | null;
  descripcion: string | null;
  sinonimos: string[];
  requiere_posicion: boolean;
  es_seguridad: boolean;
  es_mantenimiento: boolean;
  orden: number;
  activo: boolean;
  productos: number;
}
interface Marca {
  id: number;
  nombre: string;
  tipo: 'original' | 'generico';
  fabricante_moto_id: number | null;
  fabricante_moto: string | null;
  activo: boolean;
  es_demo: boolean;
}

const camposCategoria = (grupos: Categoria[], esGrupo: boolean): DefCampo[] => [
  { k: 'nombre', etiqueta: 'Nombre', requerido: true },
  { k: 'slug', etiqueta: 'Clave', ayuda: 'Minúsculas y guion bajo. Si la dejas vacía se genera del nombre. Se usa en las URL y en las importaciones.' },
  ...(esGrupo ? [] : [{ k: 'padre', etiqueta: 'Grupo', tipo: 'select' as const, requerido: true, opciones: grupos.map((g) => ({ v: g.slug, t: g.nombre })) }]),
  { k: 'orden', etiqueta: 'Orden', tipo: 'numero', requerido: true },
  { k: 'sinonimos', etiqueta: 'Sinónimos', tipo: 'lista', ancho: true, ayuda: 'Palabras con las que la gente busca esta categoría (ej. "bandas", "zapatas")' },
  { k: 'descripcion', etiqueta: 'Descripción', tipo: 'area' },
  ...(esGrupo
    ? []
    : [
        { k: 'requiere_posicion', etiqueta: 'Pide posición (delantero / trasero)', tipo: 'bool' as const },
        { k: 'es_seguridad', etiqueta: 'Pieza de seguridad (muestra aviso)', tipo: 'bool' as const },
        { k: 'es_mantenimiento', etiqueta: 'Mantenimiento periódico', tipo: 'bool' as const },
      ]),
  { k: 'activo', etiqueta: 'Activa', tipo: 'bool' },
];

const camposMarca = (fabricantes: { id: number; nombre: string }[]): DefCampo[] => [
  { k: 'nombre', etiqueta: 'Nombre de la marca', requerido: true },
  {
    k: 'fabricante_moto_id',
    etiqueta: 'Es la marca original de',
    tipo: 'select',
    numerico: true,
    opciones: fabricantes.map((f) => ({ v: String(f.id), t: f.nombre })),
    ayuda: 'Solo si es la marca del fabricante de la moto (repuesto original). Déjalo vacío para marcas genéricas o alternativas.',
  },
  { k: 'activo', etiqueta: 'Activa', tipo: 'bool' },
];

export default function Categorias() {
  const [pestana, setPestana] = useState<'categorias' | 'marcas'>('categorias');
  return (
    <>
      <Titulo descripcion="Las categorías ordenan el catálogo y la búsqueda. La marca define si un repuesto es original (marca del fabricante de la moto) o genérico/alternativo.">
        Categorías y marcas
      </Titulo>
      <Pestanas
        opciones={[
          { v: 'categorias', t: 'Categorías' },
          { v: 'marcas', t: 'Marcas de repuesto' },
        ]}
        valor={pestana}
        onCambiar={setPestana}
      />
      {pestana === 'categorias' ? <ArbolCategorias /> : <Marcas />}
    </>
  );
}

function ArbolCategorias() {
  const { tiene } = useAuth();
  const editar = tiene('productos.editar');
  const cats = useCarga(() => apiAdmin<Categoria[]>('/admin/categorias/arbol'), []);
  const [editor, setEditor] = useState<{ fila: Record<string, unknown> | null; grupo: boolean } | null>(null);
  if (cats.error) return <Alerta>{cats.error}</Alerta>;
  if (!cats.datos) return <Cargando />;
  const grupos = cats.datos.filter((c) => !c.padre);
  const hijos = (slug: string) => cats.datos!.filter((c) => c.padre === slug);

  const guardar = async (c: Record<string, unknown>) => {
    const id = editor?.fila?.id as number | undefined;
    const cuerpo: Record<string, unknown> = { ...c, padre: editor?.grupo ? null : c.padre };
    if (!cuerpo.slug) delete cuerpo.slug;
    await apiAdmin(id ? `/admin/categorias/${id}` : '/admin/categorias', id ? 'PUT' : 'POST', cuerpo);
    await cats.recargar();
  };

  return (
    <>
      {editar && (
        <div className="mb-3 flex flex-wrap gap-2">
          <Boton onClick={() => setEditor({ fila: { orden: 100 }, grupo: false })}>Nueva categoría</Boton>
          <Boton variante="secundario" onClick={() => setEditor({ fila: { orden: 100 }, grupo: true })}>
            Nuevo grupo
          </Boton>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {grupos.map((g) => (
          <Tarjeta
            key={g.id}
            titulo={
              <span className="flex items-center gap-2">
                {g.nombre} {!g.activo && <Insignia color="gris" texto="Inactivo" />}
              </span>
            }
            acciones={
              editar && (
                <Boton tamano="sm" variante="fantasma" onClick={() => setEditor({ fila: g as unknown as Record<string, unknown>, grupo: true })}>
                  Editar grupo
                </Boton>
              )
            }
          >
            <Tabla columnas={['Categoría', 'Productos', 'Marcas', '']} vacio={!hijos(g.slug).length}>
              {hijos(g.slug).map((c) => (
                <tr key={c.id} className={c.activo ? '' : 'opacity-60'}>
                  <td className="px-2 py-2">
                    <span className="font-medium text-white">{c.nombre}</span> <span className="font-mono text-xs text-gris-tec">{c.slug}</span>
                    {c.sinonimos.length > 0 && <span className="block text-xs text-gris-tec">Sinónimos: {c.sinonimos.join(', ')}</span>}
                  </td>
                  <td className="px-2 py-2 tabular-nums">{c.productos}</td>
                  <td className="px-2 py-2">
                    <span className="flex flex-wrap gap-1">
                      {c.es_seguridad && <Insignia color="rojo" texto="Seguridad" />}
                      {c.requiere_posicion && <Insignia color="azul" texto="Posición" />}
                      {c.es_mantenimiento && <Insignia color="verde" texto="Mantenimiento" />}
                      {!c.activo && <Insignia color="gris" texto="Inactiva" />}
                    </span>
                  </td>
                  <td className="px-2 py-2 text-right">
                    {editar && (
                      <Boton tamano="sm" variante="fantasma" onClick={() => setEditor({ fila: c as unknown as Record<string, unknown>, grupo: false })}>
                        Editar
                      </Boton>
                    )}
                  </td>
                </tr>
              ))}
            </Tabla>
          </Tarjeta>
        ))}
      </div>
      {editor && (
        <EditorModal
          abierto
          titulo={`${editor.fila?.id ? 'Editar' : 'Nuevo'} ${editor.grupo ? 'grupo' : 'categoría'}`}
          campos={camposCategoria(grupos, editor.grupo)}
          fila={editor.fila}
          onCerrar={() => setEditor(null)}
          guardar={guardar}
        />
      )}
    </>
  );
}

function Marcas() {
  const { tiene } = useAuth();
  const editar = tiene('productos.editar');
  const marcas = useCarga(() => apiAdmin<Marca[]>('/admin/marcas'), []);
  const fabs = useCarga(() => apiAdmin<{ id: number; nombre: string }[]>('/admin/fabricantes'), []);
  const [editor, setEditor] = useState<Record<string, unknown> | null | undefined>(undefined);
  if (marcas.error) return <Alerta>{marcas.error}</Alerta>;
  if (!marcas.datos) return <Cargando />;
  const guardar = async (c: Record<string, unknown>) => {
    const id = editor?.id as number | undefined;
    if (id) await apiAdmin(`/admin/marcas/${id}`, 'PUT', c);
    else await apiAdmin('/admin/marcas', 'POST', { nombre: c.nombre, tipo: c.fabricante_moto_id ? 'original' : 'generico', fabricante_moto_id: c.fabricante_moto_id });
    await marcas.recargar();
  };
  return (
    <Tarjeta
      titulo={`Marcas (${marcas.datos.length})`}
      acciones={
        editar && (
          <Boton tamano="sm" onClick={() => setEditor(null)}>
            Nueva marca
          </Boton>
        )
      }
    >
      <Tabla columnas={['Marca', 'Tipo', 'Estado', '']} vacio={!marcas.datos.length}>
        {marcas.datos.map((m) => (
          <tr key={m.id}>
            <td className="px-2 py-2 font-medium text-white">
              {m.nombre} {m.es_demo && <InsigniaDemo />}
            </td>
            <td className="px-2 py-2">{m.fabricante_moto ? <Insignia color="azul" texto={`Original ${m.fabricante_moto}`} /> : <Insignia color="gris" texto="Genérica / alternativa" />}</td>
            <td className="px-2 py-2">
              <EstadoActivo activo={m.activo} />
            </td>
            <td className="px-2 py-2 text-right">
              {editar && (
                <Boton tamano="sm" variante="fantasma" onClick={() => setEditor(m as unknown as Record<string, unknown>)}>
                  Editar
                </Boton>
              )}
            </td>
          </tr>
        ))}
      </Tabla>
      {editor !== undefined && (
        <EditorModal abierto titulo={editor?.id ? 'Editar marca' : 'Nueva marca'} campos={camposMarca(fabs.datos ?? [])} fila={editor} onCerrar={() => setEditor(undefined)} guardar={guardar} />
      )}
    </Tarjeta>
  );
}
