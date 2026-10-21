import { Consultor } from '../../db';
import { AppError } from '../../errores';
import { normalizarTelefono } from '../../utils/texto';

export interface DatosCliente {
  nombre: string;
  telefono: string;
  ciudad?: string | null;
  direccion?: string | null;
  email?: string | null;
}

/**
 * Crea o actualiza un cliente usando el teléfono como identificador único
 * (así no se duplican clientes que escriben varias veces).
 */
export async function upsertCliente(db: Consultor, datos: DatosCliente): Promise<number> {
  const telefono = normalizarTelefono(datos.telefono);
  if (!telefono) throw new AppError(400, 'TELEFONO_INVALIDO', 'El teléfono no es un número colombiano válido');
  const { rows } = await db.query<{ id: number }>(
    `INSERT INTO clientes (nombre, telefono, ciudad, direccion, email)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (telefono) DO UPDATE SET
       nombre = EXCLUDED.nombre,
       ciudad = COALESCE(EXCLUDED.ciudad, clientes.ciudad),
       direccion = COALESCE(EXCLUDED.direccion, clientes.direccion),
       email = COALESCE(EXCLUDED.email, clientes.email)
     RETURNING id`,
    [datos.nombre.trim(), telefono, datos.ciudad?.trim() || null, datos.direccion?.trim() || null, datos.email?.trim() || null],
  );
  return rows[0].id;
}
