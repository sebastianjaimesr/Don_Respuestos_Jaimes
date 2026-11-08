import { Pool, PoolClient, types } from 'pg';
import { config } from './config';

// NUMERIC llega como string: así no perdemos precisión con el dinero.
// BIGINT (COUNT, BIGSERIAL) lo convertimos a número porque nuestros valores son pequeños.
types.setTypeParser(20, (v) => parseInt(v, 10));

export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10 });

// Si PostgreSQL cierra una conexión inactiva (reinicio, mantenimiento del hosting), el pool la descarta
// y abre otra. Sin este manejador, ese evento tumbaría todo el servidor.
pool.on('error', (e) => console.error(`Conexión inactiva con PostgreSQL cerrada: ${e.message}`));

export type Consultor = Pick<PoolClient, 'query'>;

export interface OpcionesTransaccion {
  /** Asesor que hace el cambio: queda en la auditoría, el historial de precios y los movimientos. */
  usuarioId?: number | null;
  /** Origen de un cambio de precio: manual, importacion, compra, masivo, sistema. */
  origen?: 'manual' | 'importacion' | 'compra' | 'masivo' | 'sistema';
}

/** Ejecuta `fn` dentro de una transacción. Si algo falla, hace ROLLBACK. */
export async function enTransaccion<T>(fn: (cliente: PoolClient) => Promise<T>, opciones: OpcionesTransaccion = {}): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
    // set_config(..., true) vale solo para esta transacción: no se filtra a otras solicitudes del pool.
    if (opciones.usuarioId) await cliente.query("SELECT set_config('drj.usuario_id', $1, true)", [String(opciones.usuarioId)]);
    if (opciones.origen) await cliente.query("SELECT set_config('drj.origen', $1, true)", [opciones.origen]);
    const r = await fn(cliente);
    await cliente.query('COMMIT');
    return r;
  } catch (e) {
    await cliente.query('ROLLBACK').catch(() => undefined);
    throw e;
  } finally {
    cliente.release();
  }
}

/** Movimiento de inventario: la ÚNICA forma de cambiar la cantidad (la BD rechaza cualquier otra). */
export async function moverStock(
  db: Consultor,
  m: { productoId: number; tipo: 'entrada' | 'salida' | 'ajuste' | 'venta' | 'devolucion'; delta: number; motivo: string; pedidoId?: number | null; compraId?: number | null; asesorId?: number | null },
) {
  const { rows } = await db.query(
    // FROM fn(...) y no (fn(...)).*: esta última forma ejecuta la función una vez POR COLUMNA.
    'SELECT * FROM fn_mover_stock($1, $2, $3, $4, $5, $6, $7)',
    [m.productoId, m.tipo, m.delta, m.motivo, m.pedidoId ?? null, m.compraId ?? null, m.asesorId ?? null],
  );
  return rows[0] as { id: number; tipo: string; cantidad: number; cantidad_anterior: number; cantidad_nueva: number; motivo: string };
}
