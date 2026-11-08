import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router';
import { tienda, type ModeloMoto } from '../api/tienda';
import { useDatos, useTienda } from './estado';
import { Boton, cx } from './ui';

const ANIO_ACTUAL = new Date().getFullYear();

/** "¿Qué moto tienes?": marca → modelo → año. Lleva al catálogo con solo lo compatible. */
export function SelectorMoto({ className, compacto = false, alElegir }: { className?: string; compacto?: boolean; alElegir?: () => void }) {
  const { moto, elegirMoto } = useTienda();
  const navegar = useNavigate();
  const fabricantes = useDatos(() => tienda.fabricantes(), []);
  const [fabricanteId, setFabricanteId] = useState<number | ''>(moto?.fabricanteId ?? '');
  const [modelos, setModelos] = useState<ModeloMoto[]>([]);
  const [modeloId, setModeloId] = useState<number | ''>(moto?.modeloId ?? '');
  const [anio, setAnio] = useState<number | ''>(moto?.anio ?? '');
  const [cargandoModelos, setCargandoModelos] = useState(false);

  useEffect(() => {
    if (!fabricanteId) return setModelos([]);
    let vivo = true;
    setCargandoModelos(true);
    tienda
      .modelos(fabricanteId)
      .then((m) => vivo && setModelos(m))
      .catch(() => vivo && setModelos([]))
      .finally(() => vivo && setCargandoModelos(false));
    return () => {
      vivo = false;
    };
  }, [fabricanteId]);

  const modelo = modelos.find((m) => m.id === modeloId);
  // Años del modelo si están registrados; si no, un rango razonable (no se valida aquí la compatibilidad: eso lo hace el catálogo)
  const anios = useMemo(() => {
    const desde = modelo?.anio_inicio ?? ANIO_ACTUAL - 30;
    const hasta = Math.min(modelo?.anio_fin ?? ANIO_ACTUAL + 1, ANIO_ACTUAL + 1);
    return Array.from({ length: Math.max(0, hasta - desde + 1) }, (_, i) => hasta - i);
  }, [modelo]);

  const ver = () => {
    const fab = fabricantes.datos?.find((f) => f.id === fabricanteId);
    if (!fab || !modelo) return;
    elegirMoto({ fabricanteId: fab.id, fabricante: fab.nombre, modeloId: modelo.id, modelo: modelo.nombre, anio: anio || null });
    alElegir?.();
    navegar(`/catalogo?fabricante=${fab.id}&modelo=${modelo.id}${anio ? `&anio=${anio}` : ''}`);
  };

  const sel = 'w-full rounded-xl border border-white/10 bg-noche-900/80 px-3 py-3 text-[15px] text-white focus:border-electrico-400 focus:outline-none focus:ring-2 focus:ring-electrico-500/30 disabled:opacity-50';
  return (
    <div className={cx('grid gap-2.5', compacto ? 'sm:grid-cols-3' : 'sm:grid-cols-[1fr_1fr_0.7fr_auto]', className)}>
      <label className="sr-only" htmlFor="sel-marca">
        Marca de la moto
      </label>
      <select
        id="sel-marca"
        className={sel}
        value={fabricanteId}
        onChange={(e) => {
          setFabricanteId(e.target.value ? Number(e.target.value) : '');
          setModeloId('');
          setAnio('');
        }}
      >
        <option value="">{fabricantes.cargando ? 'Cargando marcas…' : 'Marca'}</option>
        {fabricantes.datos?.map((f) => (
          <option key={f.id} value={f.id} disabled={f.modelos === 0}>
            {f.nombre}
            {f.modelos === 0 ? ' (pronto)' : ''}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="sel-modelo">
        Modelo
      </label>
      <select id="sel-modelo" className={sel} value={modeloId} disabled={!fabricanteId || cargandoModelos} onChange={(e) => setModeloId(e.target.value ? Number(e.target.value) : '')}>
        <option value="">{cargandoModelos ? 'Cargando…' : 'Modelo'}</option>
        {modelos.map((m) => (
          <option key={m.id} value={m.id}>
            {m.nombre}
            {m.cilindraje_cc ? ` · ${m.cilindraje_cc} cc` : ''}
          </option>
        ))}
      </select>
      <label className="sr-only" htmlFor="sel-anio">
        Año
      </label>
      <select id="sel-anio" className={sel} value={anio} disabled={!modeloId} onChange={(e) => setAnio(e.target.value ? Number(e.target.value) : '')}>
        <option value="">Año</option>
        {anios.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      <Boton onClick={ver} disabled={!modelo} className={cx('py-3', compacto && 'sm:col-span-3')}>
        Ver repuestos
      </Boton>
      {fabricantes.error && <p className="text-xs text-rose-300 sm:col-span-full">No pudimos cargar las marcas. Revisa tu conexión e intenta de nuevo.</p>}
    </div>
  );
}
