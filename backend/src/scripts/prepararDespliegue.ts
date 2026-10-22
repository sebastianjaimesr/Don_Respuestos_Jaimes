/**
 * Se ejecuta antes de arrancar el servidor en el hosting (Render, Railway...).
 * 1. Aplica las migraciones pendientes.
 * 2. Si CARGAR_DEMO=true, carga los datos FICTICIOS (el seed es idempotente).
 * 3. Si se definen ADMIN_EMAIL y ADMIN_PASSWORD y todavía no hay ningún administrador, lo crea.
 * Así no hace falta una consola en el servidor para el primer arranque.
 */
import { migrar } from './migrar';
import { cargarDemo } from './cargarDemo';
import { crearAsesor } from '../modulos/auth/servicio';
import { pool } from '../db';

async function main() {
  await migrar();
  if (process.env.CARGAR_DEMO === 'true') await cargarDemo();

  const { ADMIN_NOMBRE, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (ADMIN_EMAIL && ADMIN_PASSWORD) {
    const { rows } = await pool.query("SELECT 1 FROM asesores WHERE rol = 'admin' LIMIT 1");
    if (rows.length === 0) {
      // Si la contraseña no cumple las reglas, se avisa en el log pero el servidor igual arranca.
      try {
        const u = await crearAsesor({ nombre: ADMIN_NOMBRE ?? 'Administrador', email: ADMIN_EMAIL, password: ADMIN_PASSWORD, rol: 'admin' });
        console.log(`✔ Administrador creado: ${u.email}`);
      } catch (e) {
        console.error(`✘ No se creó el administrador: ${(e as Error).message}`);
      }
    }
  }
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
