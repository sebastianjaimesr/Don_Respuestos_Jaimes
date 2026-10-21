/**
 * Crea el primer usuario administrador.
 * Uso: ADMIN_NOMBRE="..." ADMIN_EMAIL="..." ADMIN_PASSWORD="..." npm run crear-admin
 * La contraseña se pasa por variable de entorno (no queda en el código ni en el historial de git).
 */
import { crearAsesor } from '../modulos/auth/servicio';
import { pool } from '../db';

async function main() {
  const { ADMIN_NOMBRE, ADMIN_EMAIL, ADMIN_PASSWORD } = process.env;
  if (!ADMIN_EMAIL || !ADMIN_PASSWORD) {
    throw new Error('Define ADMIN_EMAIL y ADMIN_PASSWORD (y opcionalmente ADMIN_NOMBRE)');
  }
  const u = await crearAsesor({ nombre: ADMIN_NOMBRE ?? 'Administrador', email: ADMIN_EMAIL, password: ADMIN_PASSWORD, rol: 'admin' });
  console.log(`✔ Administrador creado: ${u.email} (id ${u.id})`);
}

main()
  .catch((e) => {
    console.error(e.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
