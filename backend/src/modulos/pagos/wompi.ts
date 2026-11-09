import { createHash, timingSafeEqual } from 'node:crypto';
import type { EstadoPasarela, EventoPago, IntencionPago, PasarelaPagos } from './pasarela';

/**
 * Wompi (Bancolombia), Web Checkout + eventos firmados.
 * Documentación: https://docs.wompi.co/docs/colombia/widget-checkout-web/
 * y https://docs.wompi.co/docs/colombia/eventos/
 */
export interface LlavesWompi {
  llavePublica: string;
  secretoIntegridad: string;
  secretoEventos: string;
}

const URL_CHECKOUT = 'https://checkout.wompi.co/p/';

const sha256 = (texto: string) => createHash('sha256').update(texto, 'utf8').digest('hex');

/** Firma de integridad: SHA256("<referencia><monto en centavos><moneda><secreto de integridad>"). */
export function firmaIntegridad(referencia: string, montoCentavos: number, moneda: string, secreto: string) {
  return sha256(`${referencia}${montoCentavos}${moneda}${secreto}`);
}

function iguales(a: string, b: string) {
  const x = Buffer.from(a.toLowerCase());
  const y = Buffer.from(b.toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
}

/** Lee "transaction.amount_in_cents" dentro de `data`. */
function valorEn(obj: unknown, ruta: string): unknown {
  return ruta.split('.').reduce<unknown>((o, k) => (o && typeof o === 'object' ? (o as Record<string, unknown>)[k] : undefined), obj);
}

const ESTADOS: Record<string, EstadoPasarela> = {
  APPROVED: 'aprobado',
  DECLINED: 'rechazado',
  VOIDED: 'rechazado',
  ERROR: 'rechazado',
  PENDING: 'pendiente',
};

export function crearWompi(llaves: LlavesWompi): PasarelaPagos {
  return {
    nombre: 'wompi',
    crearIntencion({ referencia, monto_centavos, url_retorno }): IntencionPago {
      const q = new URLSearchParams({
        'public-key': llaves.llavePublica,
        currency: 'COP',
        'amount-in-cents': String(monto_centavos),
        reference: referencia,
        'signature:integrity': firmaIntegridad(referencia, monto_centavos, 'COP', llaves.secretoIntegridad),
      });
      if (url_retorno) q.set('redirect-url', url_retorno);
      return { proveedor: 'wompi', url: `${URL_CHECKOUT}?${q}`, referencia, monto_centavos };
    },

    /**
     * Checksum = SHA256(valores de signature.properties, en orden + timestamp + secreto de eventos).
     * Si no coincide, el evento no viene de Wompi y se descarta.
     */
    verificarEvento(cuerpo, encabezadoChecksum): EventoPago | null {
      if (!cuerpo || typeof cuerpo !== 'object') return null;
      const e = cuerpo as { event?: unknown; data?: unknown; timestamp?: unknown; signature?: { properties?: unknown; checksum?: unknown } };
      const props = e.signature?.properties;
      const checksum = typeof e.signature?.checksum === 'string' ? e.signature.checksum : encabezadoChecksum;
      if (!Array.isArray(props) || !props.length || typeof checksum !== 'string' || (typeof e.timestamp !== 'number' && typeof e.timestamp !== 'string')) return null;
      const valores = props.map((p) => valorEn(e.data, String(p)));
      if (valores.some((v) => v === undefined || v === null || typeof v === 'object')) return null;
      const esperado = sha256(`${valores.join('')}${e.timestamp}${llaves.secretoEventos}`);
      if (!iguales(esperado, checksum)) return null;
      if (encabezadoChecksum && !iguales(esperado, encabezadoChecksum)) return null;

      if (e.event !== 'transaction.updated') return null;
      const t = valorEn(e.data, 'transaction') as Record<string, unknown> | undefined;
      // Las propiedades firmadas deben cubrir lo que usamos: si no, alguien podría cambiarlas.
      for (const req of ['transaction.id', 'transaction.status', 'transaction.amount_in_cents']) {
        if (!props.includes(req)) return null;
      }
      if (!t || typeof t.reference !== 'string' || typeof t.status !== 'string' || typeof t.amount_in_cents !== 'number') return null;
      return {
        proveedor: 'wompi',
        referencia: t.reference,
        transaccion: String(t.id),
        estado: ESTADOS[t.status] ?? 'pendiente',
        monto_centavos: t.amount_in_cents,
        moneda: typeof t.currency === 'string' ? t.currency : 'COP',
        metodo: typeof t.payment_method_type === 'string' ? t.payment_method_type.toLowerCase() : null,
        payload: cuerpo,
      };
    },
  };
}
