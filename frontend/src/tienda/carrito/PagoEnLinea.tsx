import { useEffect, useState } from 'react';
import { cop } from '../../api/formato';
import { tienda, type OpcionesPago } from '../../api/tienda';
import { Boton, mensajeError } from '../ui';

let opcionesCache: Promise<OpcionesPago> | null = null;
/** Si la tienda tiene pago en línea activo (lo decide el servidor según sus llaves). */
export function useOpcionesPago() {
  const [o, setO] = useState<OpcionesPago | null>(null);
  useEffect(() => {
    let vivo = true;
    opcionesCache ??= tienda.opcionesPago().catch((e) => {
      opcionesCache = null;
      throw e;
    });
    opcionesCache.then((r) => (vivo ? setO(r) : undefined)).catch(() => (vivo ? setO({ en_linea: false, proveedor: null, modo_pruebas: false }) : undefined));
    return () => {
      vivo = false;
    };
  }, []);
  return o;
}

/**
 * Botón para pagar en Wompi. Solo aparece si el pago en línea está activo, el pago
 * sigue pendiente y el total es definitivo (sin envío por confirmar). El pedido NO se
 * marca como pagado al volver de Wompi: lo marca el aviso firmado que Wompi envía al servidor.
 */
export function PagoEnLinea({ codigo, telefono, estadoPago, total, totalDefinitivo }: { codigo: string; telefono: string; estadoPago: string; total: string; totalDefinitivo: boolean }) {
  const op = useOpcionesPago();
  const [error, setError] = useState<string | null>(null);
  const [yendo, setYendo] = useState(false);
  if (!op?.en_linea || estadoPago !== 'pendiente') return null;
  if (!totalDefinitivo) {
    return <p className="mt-4 rounded-xl bg-white/[0.04] p-3 text-sm text-gris-tec">Cuando un asesor te confirme el costo del envío podrás pagar en línea desde “Consultar mi pedido”.</p>;
  }
  const pagar = async () => {
    setError(null);
    setYendo(true);
    try {
      const r = await tienda.pagoEnLinea(codigo, telefono);
      window.location.assign(r.url);
    } catch (e) {
      setError(mensajeError(e));
      setYendo(false);
    }
  };
  return (
    <div className="mt-6 space-y-2">
      <Boton onClick={pagar} cargando={yendo} className="w-full py-3 sm:w-auto sm:px-8">
        Pagar {cop(total)} en línea
      </Boton>
      <p className="text-xs text-gris-tec">
        Te llevamos a Wompi (tarjeta, PSE, Nequi y otros). No guardamos datos de tu tarjeta.
        {op.modo_pruebas && ' Modo de pruebas: no se cobra dinero real.'}
      </p>
      {error && (
        <p role="alert" className="text-sm text-rose-300">
          {error}
        </p>
      )}
    </div>
  );
}
