import fs from 'node:fs';
import path from 'node:path';
import request from 'supertest';
import { pool } from '../src/db';
import { crearApp } from '../src/app';
import { crearAsesor } from '../src/modulos/auth/servicio';
import type { Rol } from '../src/middleware/auth';

export const app = crearApp();

const SEED = fs.readFileSync(path.resolve(__dirname, '../../database/seeds/demo_ficticio.sql'), 'utf8');
const CONFIG = fs.readFileSync(path.resolve(__dirname, '../../database/migrations/002_configuracion_negocio.sql'), 'utf8');

/** Borra todos los datos y vuelve a cargar configuración + datos ficticios. */
export async function reiniciarDatos() {
  const { rows } = await pool.query(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> 'schema_migraciones'`);
  await pool.query(`TRUNCATE ${rows.map((r) => `"${r.tablename}"`).join(', ')} RESTART IDENTITY CASCADE`);
  await pool.query(`ALTER SEQUENCE seq_codigo_pedido RESTART WITH 1; ALTER SEQUENCE seq_codigo_cotizacion RESTART WITH 1;`);
  await pool.query(CONFIG);
  await pool.query(SEED);
}

export async function idProducto(referencia: string): Promise<number> {
  const { rows } = await pool.query('SELECT id FROM productos WHERE referencia = $1', [referencia]);
  if (!rows[0]) throw new Error(`No existe ${referencia}`);
  return rows[0].id;
}

export async function stock(referencia: string): Promise<number> {
  const { rows } = await pool.query('SELECT i.cantidad FROM inventario i JOIN productos p ON p.id = i.producto_id WHERE p.referencia = $1', [referencia]);
  return rows[0].cantidad;
}

let n = 0;
export async function tokenCon(rol: Rol): Promise<string> {
  n += 1;
  const email = `${rol}${n}@prueba.local`;
  const password = 'ClavePrueba123';
  await crearAsesor({ nombre: `Usuario ${rol}`, email, password, rol });
  const r = await request(app).post('/api/auth/login').send({ email, password });
  return r.body.data.token;
}

export function pedidoBase(items: { producto_id: number; cantidad: number }[], extra: Record<string, unknown> = {}) {
  return {
    cliente: { nombre: 'Cliente Ficticio', telefono: '3001234567', ciudad: 'Bogotá' },
    items,
    entrega: { modalidad: 'recogida_tienda' },
    metodo_pago: 'efectivo',
    confirmado_por_cliente: true,
    clave_idempotencia: `prueba-${Math.random().toString(36).slice(2)}`,
    ...extra,
  };
}

/** Conversación de chat web: devuelve una función para enviar mensajes. */
export async function nuevoChat() {
  const r = await request(app).post('/api/chat/conversaciones');
  const id: string = r.body.data.conversacion_id;
  const enviar = async (cuerpo: string | Record<string, unknown>) => {
    const res = await request(app)
      .post(`/api/chat/conversaciones/${id}/mensajes`)
      .send(typeof cuerpo === 'string' ? { texto: cuerpo } : cuerpo);
    if (!res.body.ok) throw new Error(JSON.stringify(res.body));
    return res.body.data as { respuestas: { tipo: string; texto: string; acciones?: { etiqueta: string; accion: Record<string, unknown> }[]; datos?: any }[]; estado: string };
  };
  return { id, enviar };
}
