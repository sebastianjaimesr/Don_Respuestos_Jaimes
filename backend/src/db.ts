import { Pool, PoolClient, types } from 'pg';
import { config } from './config';

// NUMERIC llega como string: así no perdemos precisión con el dinero.
// BIGINT (COUNT, BIGSERIAL) lo convertimos a número porque nuestros valores son pequeños.
types.setTypeParser(20, (v) => parseInt(v, 10));

export const pool = new Pool({ connectionString: config.DATABASE_URL, max: 10 });

export type Consultor = Pick<PoolClient, 'query'>;

/** Ejecuta `fn` dentro de una transacción. Si algo falla, hace ROLLBACK. */
export async function enTransaccion<T>(fn: (cliente: PoolClient) => Promise<T>): Promise<T> {
  const cliente = await pool.connect();
  try {
    await cliente.query('BEGIN');
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
