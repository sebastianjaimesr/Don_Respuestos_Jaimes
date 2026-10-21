/**
 * Ejecuta las migraciones SQL de database/migrations en orden.
 * Cada archivo se aplica una sola vez (se registra en schema_migraciones).
 */
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'dotenv/config';

export async function migrar(url = process.env.DATABASE_URL, silencioso = false) {
  if (!url) throw new Error('Falta DATABASE_URL');
  const dir = path.resolve(__dirname, '../../../database/migrations');
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query('CREATE TABLE IF NOT EXISTS schema_migraciones (archivo TEXT PRIMARY KEY, aplicada_en TIMESTAMPTZ NOT NULL DEFAULT now())');
    const aplicadas = new Set((await cliente.query('SELECT archivo FROM schema_migraciones')).rows.map((r) => r.archivo));
    const archivos = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();
    for (const archivo of archivos) {
      if (aplicadas.has(archivo)) continue;
      const sql = fs.readFileSync(path.join(dir, archivo), 'utf8');
      await cliente.query('BEGIN');
      try {
        await cliente.query(sql);
        await cliente.query('INSERT INTO schema_migraciones (archivo) VALUES ($1)', [archivo]);
        await cliente.query('COMMIT');
        if (!silencioso) console.log(`✔ Migración aplicada: ${archivo}`);
      } catch (e) {
        await cliente.query('ROLLBACK');
        throw new Error(`Falló la migración ${archivo}: ${(e as Error).message}`);
      }
    }
    if (!silencioso) console.log('Base de datos al día.');
  } finally {
    await cliente.end();
  }
}

if (require.main === module) {
  migrar().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
