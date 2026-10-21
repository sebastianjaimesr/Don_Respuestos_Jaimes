import { pool } from '../../db';

export interface ItemConfig {
  clave: string;
  valor: unknown;
  descripcion: string;
  confirmado: boolean;
}

export async function obtenerConfiguracion(): Promise<Record<string, ItemConfig>> {
  const { rows } = await pool.query<ItemConfig>('SELECT clave, valor, descripcion, confirmado FROM configuracion_negocio ORDER BY clave');
  return Object.fromEntries(rows.map((r) => [r.clave, r]));
}

/** Valor solo si el propietario lo confirmó; si no, null (pendiente). */
export async function valorConfirmado<T = unknown>(clave: string): Promise<T | null> {
  const { rows } = await pool.query<{ valor: T; confirmado: boolean }>(
    'SELECT valor, confirmado FROM configuracion_negocio WHERE clave = $1',
    [clave],
  );
  const r = rows[0];
  return r && r.confirmado && r.valor !== null ? r.valor : null;
}

/** Costo de envío confirmado (número) o null si no está confirmado. */
export async function costoEnvioConfirmado(ciudad?: string | null): Promise<number | null> {
  const v = await valorConfirmado<unknown>('costo_envio');
  if (typeof v === 'number' && v >= 0) return v;
  // Tabla por ciudad: { "bogota": 15000, "default": 20000 }
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    const tabla = v as Record<string, number>;
    const clave = (ciudad ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const valor = tabla[clave] ?? tabla['default'];
    return typeof valor === 'number' && valor >= 0 ? valor : null;
  }
  return null;
}

/** Información pública: los datos no confirmados se marcan como pendientes. */
export async function informacionPublica() {
  const cfg = await obtenerConfiguracion();
  const publicas = ['nombre', 'pais', 'moneda', 'horario', 'direccion', 'ciudades_envio', 'transportadoras', 'costo_envio', 'medios_pago', 'contacto_humano'];
  return Object.fromEntries(
    publicas
      .filter((k) => cfg[k])
      .map((k) => [k, { valor: cfg[k].confirmado ? cfg[k].valor : null, confirmado: cfg[k].confirmado, descripcion: cfg[k].descripcion }]),
  );
}
