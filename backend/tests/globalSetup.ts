import { Client } from 'pg';
import { migrar } from '../src/scripts/migrar';

/** Deja la base de pruebas limpia y con el esquema actual antes de correr las pruebas. */
export default async function () {
  const url = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/drj_test';
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query('DROP SCHEMA IF EXISTS public CASCADE; CREATE SCHEMA public;');
  await c.end();
  await migrar(url, true);
}
