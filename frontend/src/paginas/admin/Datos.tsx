import { useRef, useState } from 'react';
import { useAuth } from '../../api/auth';
import { apiAdmin, descargar, subirArchivo } from '../../api/cliente';
import { fecha } from '../../api/formato';
import { Pestanas } from '../../componentes/editor';
import { Alerta, Boton, Cargando, Insignia, Selector, Tabla, Tarjeta, mensajeError, useCarga } from '../../componentes/ui';
import { Titulo } from './Layout';

type Tipo = 'productos' | 'precios' | 'stock' | 'compatibilidades';
interface Importacion {
  id: number;
  tipo: Tipo;
  archivo_nombre: string;
  formato: string;
  estado: 'validando' | 'validada' | 'con_errores' | 'aplicada' | 'fallida' | 'descartada';
  modo: string | null;
  filas_total: number;
  filas_validas: number;
  filas_error: number;
  resumen: Record<string, unknown>;
  created_at: string;
  aplicada_at: string | null;
  asesor: string | null;
  errores?: { fila: number; columna: string | null; valor: string | null; mensaje: string }[];
  aplicadas?: number;
}

const TIPOS: { v: Tipo; t: string; ayuda: string }[] = [
  { v: 'productos', t: 'Productos', ayuda: 'Crea productos nuevos o actualiza los existentes por SKU. Solo se cambian las columnas que vengan en el archivo.' },
  { v: 'precios', t: 'Precios', ayuda: 'Actualiza precio de venta y/o de compra por SKU. Cada cambio queda en el historial de precios.' },
  { v: 'stock', t: 'Stock', ayuda: 'Fija la cantidad (conteo físico) o suma/resta una diferencia por SKU. Cada fila crea un movimiento con su motivo.' },
  { v: 'compatibilidades', t: 'Compatibilidades', ayuda: 'Relaciona repuestos con fabricante, modelo, versión y años. El fabricante y el modelo deben existir.' },
];
const ESTADO: Record<Importacion['estado'], { t: string; c: 'verde' | 'amarillo' | 'rojo' | 'gris' | 'azul' }> = {
  validando: { t: 'Validando', c: 'azul' },
  validada: { t: 'Lista para aplicar', c: 'verde' },
  con_errores: { t: 'Con errores', c: 'amarillo' },
  aplicada: { t: 'Aplicada', c: 'verde' },
  fallida: { t: 'Fallida', c: 'rojo' },
  descartada: { t: 'Descartada', c: 'gris' },
};

export default function Datos() {
  const { tiene } = useAuth();
  const puedeImportar = tiene('importaciones.aplicar');
  const puedeExportar = tiene('exportaciones.descargar');
  const [pestana, setPestana] = useState<'importar' | 'exportar'>(puedeImportar ? 'importar' : 'exportar');
  return (
    <>
      <Titulo descripcion="Carga masiva desde Excel o CSV y descarga del inventario. Toda importación se valida primero sin cambiar nada; tú decides si se aplica.">Importar y exportar</Titulo>
      {puedeImportar && puedeExportar && (
        <Pestanas
          opciones={[
            { v: 'importar', t: 'Importar' },
            { v: 'exportar', t: 'Exportar' },
          ]}
          valor={pestana}
          onCambiar={setPestana}
        />
      )}
      {pestana === 'importar' && puedeImportar ? <Importar /> : <Exportar />}
    </>
  );
}

function Importar() {
  const [tipo, setTipo] = useState<Tipo>('productos');
  const [actual, setActual] = useState<Importacion | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const archivo = useRef<HTMLInputElement>(null);
  const historial = useCarga(() => apiAdmin<{ items: Importacion[] }>('/admin/importaciones?tamano=15'), []);
  const def = TIPOS.find((t) => t.v === tipo)!;

  const hacer = async (f: () => Promise<Importacion>) => {
    setError(null);
    setOcupado(true);
    try {
      setActual(await f());
      void historial.recargar();
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupado(false);
    }
  };
  const validar = () => {
    const a = archivo.current?.files?.[0];
    if (!a) return setError('Elige un archivo .xlsx o .csv');
    if (a.size > 5 * 1024 * 1024) return setError('El archivo supera 5 MB');
    void hacer(() => subirArchivo<Importacion>(`/admin/importaciones?tipo=${tipo}&archivo=${encodeURIComponent(a.name)}`, a));
  };

  return (
    <div className="space-y-4">
      <Tarjeta titulo="1. Elige qué vas a cargar">
        <div className="grid gap-3 sm:grid-cols-[220px_1fr] sm:items-end">
          <Selector
            etiqueta="Tipo de importación"
            value={tipo}
            onChange={(e) => {
              setTipo(e.target.value as Tipo);
              setActual(null);
            }}
          >
            {TIPOS.map((t) => (
              <option key={t.v} value={t.v}>
                {t.t}
              </option>
            ))}
          </Selector>
          <p className="text-sm text-gris-tec">{def.ayuda}</p>
        </div>
        <div className="mt-3 flex flex-wrap gap-2 text-sm">
          <span className="text-gris-tec">Plantilla:</span>
          <Boton tamano="sm" variante="secundario" onClick={() => descargar(`/admin/importaciones/plantillas/${tipo}?formato=xlsx`, `plantilla-${tipo}.xlsx`).catch((e) => setError(mensajeError(e)))}>
            Excel
          </Boton>
          <Boton tamano="sm" variante="secundario" onClick={() => descargar(`/admin/importaciones/plantillas/${tipo}?formato=csv`, `plantilla-${tipo}.csv`).catch((e) => setError(mensajeError(e)))}>
            CSV
          </Boton>
        </div>
      </Tarjeta>

      <Tarjeta titulo="2. Sube el archivo y valídalo">
        <p className="mb-3 text-sm text-gris-tec">
          Excel (.xlsx) o CSV separado por punto y coma, máximo 5 MB. Los precios se pueden escribir como en Colombia: <span className="font-mono">15.000</span> = quince mil.
        </p>
        <div className="flex flex-wrap items-center gap-3">
          <input
            ref={archivo}
            type="file"
            accept=".xlsx,.csv,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            aria-label="Archivo a importar"
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-white/10 file:px-3 file:py-2 file:text-sm file:text-white"
          />
          <Boton disabled={ocupado} onClick={validar}>
            {ocupado ? 'Procesando…' : 'Validar (no cambia nada)'}
          </Boton>
        </div>
      </Tarjeta>

      {error && <Alerta>{error}</Alerta>}
      {actual && <ResultadoImportacion imp={actual} ocupado={ocupado} hacer={hacer} />}

      <Tarjeta titulo="Importaciones recientes">
        {!historial.datos ? (
          <Cargando />
        ) : (
          <Tabla columnas={['#', 'Tipo', 'Archivo', 'Filas', 'Estado', 'Usuario', 'Fecha']} vacio={!historial.datos.items.length} amplia>
            {historial.datos.items.map((i) => (
              <tr key={i.id} className="cursor-pointer hover:bg-white/[0.04]" onClick={() => hacer(() => apiAdmin<Importacion>(`/admin/importaciones/${i.id}`))}>
                <td className="px-2 py-2 tabular-nums">{i.id}</td>
                <td className="px-2 py-2 capitalize">{i.tipo}</td>
                <td className="px-2 py-2 text-xs">{i.archivo_nombre}</td>
                <td className="px-2 py-2 text-xs tabular-nums">
                  {i.filas_validas}/{i.filas_total} válidas
                </td>
                <td className="px-2 py-2">
                  <Insignia color={ESTADO[i.estado].c} texto={ESTADO[i.estado].t} />
                </td>
                <td className="px-2 py-2 text-xs">{i.asesor ?? '—'}</td>
                <td className="px-2 py-2 text-xs">{fecha(i.created_at)}</td>
              </tr>
            ))}
          </Tabla>
        )}
      </Tarjeta>
    </div>
  );
}

function ResultadoImportacion({ imp, ocupado, hacer }: { imp: Importacion; ocupado: boolean; hacer: (f: () => Promise<Importacion>) => Promise<void> }) {
  const [modo, setModo] = useState<'solo_validas' | 'todo_o_nada'>('solo_validas');
  const pendiente = imp.estado === 'validada' || imp.estado === 'con_errores';
  return (
    <Tarjeta
      titulo={
        <span className="flex flex-wrap items-center gap-2">
          3. Resultado de la importación #{imp.id} <Insignia color={ESTADO[imp.estado].c} texto={ESTADO[imp.estado].t} />
        </span>
      }
    >
      <div className="grid grid-cols-3 gap-3 text-center">
        {[
          ['Filas', imp.filas_total, 'text-white'],
          ['Válidas', imp.filas_validas, 'text-emerald-300'],
          ['Con error', imp.filas_error, imp.filas_error ? 'text-amber-300' : 'text-white'],
        ].map(([t, n, c]) => (
          <div key={t as string} className="rounded-xl bg-white/[0.03] p-3">
            <p className={`text-2xl font-semibold tabular-nums ${c}`}>{n}</p>
            <p className="text-xs text-gris-tec">{t}</p>
          </div>
        ))}
      </div>
      {imp.estado === 'aplicada' && (
        <div className="mt-3">
          <Alerta tipo="exito">
            Aplicada{imp.aplicadas !== undefined ? `: ${imp.aplicadas} filas` : ''}
            {imp.aplicada_at ? ` el ${fecha(imp.aplicada_at)}` : ''}. Los cambios quedaron en la auditoría y el historial de precios.
          </Alerta>
        </div>
      )}
      {!!imp.errores?.length && (
        <div className="mt-4">
          <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
            <h3 className="text-sm font-semibold text-white">Errores encontrados</h3>
            <Boton tamano="sm" variante="secundario" onClick={() => descargar(`/admin/importaciones/${imp.id}/errores.csv`, `errores-${imp.id}.csv`)}>
              Descargar todos los errores (CSV)
            </Boton>
          </div>
          <Tabla columnas={['Fila', 'Columna', 'Valor', 'Problema']} amplia>
            {imp.errores.slice(0, 50).map((e, i) => (
              <tr key={i}>
                <td className="px-2 py-1.5 tabular-nums">{e.fila}</td>
                <td className="px-2 py-1.5 font-mono text-xs">{e.columna ?? '—'}</td>
                <td className="max-w-48 truncate px-2 py-1.5 text-xs">{e.valor ?? '—'}</td>
                <td className="px-2 py-1.5 text-xs">{e.mensaje}</td>
              </tr>
            ))}
          </Tabla>
          {imp.filas_error > 50 && <p className="pt-2 text-xs text-gris-tec">Se muestran los primeros 50. Descarga el CSV para verlos todos.</p>}
        </div>
      )}
      {pendiente && (
        <div className="mt-4 space-y-3 border-t border-white/10 pt-4">
          <fieldset className="space-y-2 text-sm">
            <legend className="mb-1 font-semibold text-white">¿Cómo aplicar?</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="modo" className="mt-1 accent-electrico-500" checked={modo === 'solo_validas'} onChange={() => setModo('solo_validas')} />
              <span>
                Aplicar solo las filas válidas <span className="text-gris-tec">— las filas con error se saltan.</span>
              </span>
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="modo" className="mt-1 accent-electrico-500" checked={modo === 'todo_o_nada'} onChange={() => setModo('todo_o_nada')} />
              <span>
                Todo o nada <span className="text-gris-tec">— si alguna fila falla, no se aplica ninguna.</span>
              </span>
            </label>
          </fieldset>
          <div className="flex flex-wrap gap-2">
            <Boton disabled={ocupado || imp.filas_validas === 0 || (modo === 'todo_o_nada' && imp.filas_error > 0)} onClick={() => hacer(() => apiAdmin<Importacion>(`/admin/importaciones/${imp.id}/aplicar`, 'POST', { modo }))}>
              Aplicar {modo === 'solo_validas' ? `${imp.filas_validas} filas` : 'todo'}
            </Boton>
            <Boton variante="secundario" disabled={ocupado} onClick={() => hacer(() => apiAdmin<Importacion>(`/admin/importaciones/${imp.id}/descartar`, 'POST', {}))}>
              Descartar
            </Boton>
          </div>
          {modo === 'todo_o_nada' && imp.filas_error > 0 && <p className="text-xs text-amber-200">Corrige los errores y vuelve a subir el archivo, o aplica solo las válidas.</p>}
        </div>
      )}
    </Tarjeta>
  );
}

function Exportar() {
  const cats = useCarga(() => apiAdmin<{ clave: string; etiqueta: string }[]>('/admin/categorias'), []);
  const [f, setF] = useState({ formato: 'xlsx', activo: '', categoria: '' });
  const [error, setError] = useState<string | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const exportar = async () => {
    setError(null);
    setOcupado(true);
    try {
      const p = new URLSearchParams({ formato: f.formato });
      if (f.activo) p.set('activo', f.activo);
      if (f.categoria) p.set('categoria', f.categoria);
      await descargar(`/admin/exportaciones/inventario?${p}`, `inventario.${f.formato}`);
    } catch (e) {
      setError(mensajeError(e));
    } finally {
      setOcupado(false);
    }
  };
  return (
    <Tarjeta titulo="Exportar inventario">
      <p className="mb-3 text-sm text-gris-tec">Productos con precio, costo, stock, ubicación y estado. El archivo sirve también como base para volver a importar.</p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Selector etiqueta="Formato" value={f.formato} onChange={(e) => setF((x) => ({ ...x, formato: e.target.value }))}>
          <option value="xlsx">Excel (.xlsx)</option>
          <option value="csv">CSV</option>
        </Selector>
        <Selector etiqueta="Productos" value={f.activo} onChange={(e) => setF((x) => ({ ...x, activo: e.target.value }))}>
          <option value="">Todos</option>
          <option value="true">Solo activos</option>
          <option value="false">Solo inactivos</option>
        </Selector>
        <Selector etiqueta="Categoría" value={f.categoria} onChange={(e) => setF((x) => ({ ...x, categoria: e.target.value }))}>
          <option value="">Todas</option>
          {cats.datos?.map((c) => (
            <option key={c.clave} value={c.clave}>
              {c.etiqueta}
            </option>
          ))}
        </Selector>
      </div>
      <div className="mt-4">
        <Boton disabled={ocupado} onClick={exportar}>
          {ocupado ? 'Preparando…' : 'Descargar'}
        </Boton>
      </div>
      {error && (
        <div className="mt-3">
          <Alerta>{error}</Alerta>
        </div>
      )}
    </Tarjeta>
  );
}
