/** Carga los datos de demostración FICTICIOS (database/seeds/demo_ficticio.sql). */
import fs from 'node:fs';
import path from 'node:path';
import { Client } from 'pg';
import 'dotenv/config';

export async function cargarDemo(url = process.env.DATABASE_URL, silencioso = false) {
  if (!url) throw new Error('Falta DATABASE_URL');
  const sql = fs.readFileSync(path.resolve(__dirname, '../../../database/seeds/demo_ficticio.sql'), 'utf8');
  const cliente = new Client({ connectionString: url });
  await cliente.connect();
  try {
    await cliente.query(sql);
    if (!silencioso) console.log('✔ Datos de demostración FICTICIOS cargados (referencias DEMO-*).');
  } finally {
    await cliente.end();
  }
}

if (require.main === module) {
  cargarDemo().catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
}
