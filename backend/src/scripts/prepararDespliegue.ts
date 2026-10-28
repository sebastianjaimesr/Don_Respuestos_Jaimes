/**
 * Se ejecuta antes de arrancar el servidor en el hosting (Render, Railway...).
 * 1. Aplica las migraciones pendientes.
 * 2. Si CARGAR_DEMO=true, carga los datos FICTICIOS (el seed es idempotente).
 * 3. Si se definen ADMIN_EMAIL y ADMIN_PASSWORD y todavía no hay ningún administrador, lo crea.
 * 4. Si además ADMIN_RESTABLECER=true, deja ese correo como administrador activo con esa contraseña
 *    (sirve para recuperar el acceso). Después de entrar, vuelve a poner ADMIN_RESTABLECER=false.
 * Así no hace falta una consola en el servidor para el primer arranque.
 */
import { migrar } from './migrar';
import { cargarDemo } from './cargarDemo';
import bcrypt from 'bcryptjs';
import { crearAsesor, validarPassword } from '../modulos/auth/servicio';
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
    } else if (process.env.ADMIN_RESTABLECER === 'true') {
      try {
        validarPassword(ADMIN_PASSWORD);
        const hash = await bcrypt.hash(ADMIN_PASSWORD, 12);
        const email = ADMIN_EMAIL.trim().toLowerCase();
        const { rowCount } = await pool.query("UPDATE asesores SET password_hash = $2, rol = 'admin', activo = true WHERE email = $1", [email, hash]);
        if (rowCount) console.log(`✔ Acceso restablecido para ${email}. Vuelve a poner ADMIN_RESTABLECER=false.`);
        else {
          await crearAsesor({ nombre: ADMIN_NOMBRE ?? 'Administrador', email, password: ADMIN_PASSWORD, rol: 'admin' });
          console.log(`✔ Administrador creado: ${email}. Vuelve a poner ADMIN_RESTABLECER=false.`);
        }
      } catch (e) {
        console.error(`✘ No se restableció el acceso: ${(e as Error).message}`);
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
