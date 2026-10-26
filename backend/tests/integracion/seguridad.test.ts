import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import http from 'node:http';
import { Client } from 'pg';
import request from 'supertest';
import { pool } from '../../src/db';
import { firmar, verificarFirma } from '../../src/utils/firma';
import { app, idProducto, nuevoChat, reiniciarDatos, stock, tokenCon } from '../helpers';

beforeEach(reiniciarDatos);
afterEach(() => vi.restoreAllMocks());

const SECRETO = 'webhook-secreto-solo-para-pruebas-0123456789';
const firmado = (cuerpo: object) => {
  const raw = JSON.stringify(cuerpo);
  const ts = Math.floor(Date.now() / 1000).toString();
  return { raw, headers: { 'content-type': 'application/json', 'x-drj-timestamp': ts, 'x-drj-firma': firmar(SECRETO, ts, raw) } };
};

describe('[15] autorización por roles en el backend', () => {
  it('sin sesión no se puede tocar el inventario', async () => {
    const id = await idProducto('DEMO-PF-FZ2-D-OR');
    const r = await request(app).post(`/api/admin/inventario/${id}/movimientos`).send({ tipo: 'entrada', cantidad: 5, motivo: 'intento' });
    expect(r.status).toBe(401);
  });

  it('un usuario de solo consulta no puede cambiar inventario ni precios', async () => {
    const token = await tokenCon('consulta');
    const id = await idProducto('DEMO-PF-FZ2-D-OR');
    const mov = await request(app).post(`/api/admin/inventario/${id}/movimientos`).set('Authorization', `Bearer ${token}`).send({ tipo: 'salida', cantidad: 5, motivo: 'robo' });
    expect(mov.status).toBe(403);
    expect(mov.body.error.codigo).toBe('SIN_PERMISOS');
    expect(await stock('DEMO-PF-FZ2-D-OR')).toBe(5);
    // Sí puede leer
    expect((await request(app).get('/api/admin/productos').set('Authorization', `Bearer ${token}`)).status).toBe(200);
  });

  it('un vendedor mueve inventario pero no cambia precios', async () => {
    const token = await tokenCon('vendedor');
    const id = await idProducto('DEMO-PF-FZ2-D-OR');
    const mov = await request(app).post(`/api/admin/inventario/${id}/movimientos`).set('Authorization', `Bearer ${token}`).send({ tipo: 'entrada', cantidad: 4, motivo: 'Compra a proveedor' });
    expect(mov.status).toBe(201);
    expect(await stock('DEMO-PF-FZ2-D-OR')).toBe(9);
    const precio = await request(app)
      .put(`/api/admin/productos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ referencia: 'DEMO-PF-FZ2-D-OR', nombre: 'x', categoria: 'pastillas_freno', marca_id: 1, precio: 1 });
    expect(precio.status).toBe(403);
  });

  it('el administrador gestiona productos; no se permite inventario negativo', async () => {
    const token = await tokenCon('admin');
    const auth = { Authorization: `Bearer ${token}` };
    const marca = (await pool.query(`SELECT id FROM marcas WHERE nombre = 'Yamaha'`)).rows[0].id;
    const nuevo = await request(app)
      .post('/api/admin/productos')
      .set(auth)
      .send({ referencia: 'test-001', nombre: 'Bujía prueba', categoria: 'bujia', marca_id: marca, precio: 25000 });
    expect(nuevo.status).toBe(201);
    expect(nuevo.body.data).toMatchObject({ referencia: 'TEST-001', tipo: 'original' });
    const sal = await request(app).post(`/api/admin/inventario/${nuevo.body.data.id}/movimientos`).set(auth).send({ tipo: 'salida', cantidad: 1, motivo: 'prueba' });
    expect(sal.status).toBe(409);
    expect(sal.body.error.codigo).toBe('INVENTARIO_NEGATIVO');
    const dup = await request(app).post('/api/admin/productos').set(auth).send({ referencia: 'TEST-001 ', nombre: 'Otra', categoria: 'bujia', marca_id: marca, precio: 1 });
    expect(dup.status).toBe(409);
  });

  it('un usuario desactivado pierde el acceso de inmediato', async () => {
    const token = await tokenCon('vendedor');
    await pool.query(`UPDATE asesores SET activo = false WHERE rol = 'vendedor'`);
    expect((await request(app).get('/api/admin/pedidos').set('Authorization', `Bearer ${token}`)).status).toBe(401);
  });

  it('login con credenciales incorrectas responde 401 genérico', async () => {
    const r = await request(app).post('/api/auth/login').send({ email: 'nadie@x.co', password: 'malamala' });
    expect(r.status).toBe(401);
    expect(r.body.error.codigo).toBe('CREDENCIALES_INVALIDAS');
  });
});

describe('webhooks e integraciones', () => {
  it('rechaza mensajes de n8n sin firma o con firma inválida', async () => {
    const sin = await request(app).post('/api/integraciones/mensaje').send({ canal: 'whatsapp', canal_usuario_id: '573001', texto: 'hola' });
    expect(sin.status).toBe(401);
    const { raw, headers } = firmado({ canal: 'whatsapp', canal_usuario_id: '573001', texto: 'hola' });
    const alterado = await request(app).post('/api/integraciones/mensaje').set(headers).send(raw.replace('hola', 'adios'));
    expect(alterado.status).toBe(401);
  });

  it('acepta mensajes firmados y mantiene la conversación por usuario del canal', async () => {
    const enviar = async (texto: string) => {
      const { raw, headers } = firmado({ canal: 'whatsapp', canal_usuario_id: '573001112233', texto });
      return request(app).post('/api/integraciones/mensaje').set(headers).send(raw);
    };
    const r1 = await enviar('pastillas delanteras fz 2.0');
    expect(r1.status).toBe(200);
    expect(r1.body.data.texto_respuesta).toMatch(/De qué año/);
    const r2 = await enviar('2019');
    expect(r2.body.data.conversacion_id).toBe(r1.body.data.conversacion_id);
    expect(r2.body.data.texto_respuesta).toMatch(/DEMO-PF-FZ2-D-OR/);
  });

  it('crear pedidos por API exige firma o sesión de personal', async () => {
    const r = await request(app).post('/api/pedidos').send({});
    expect(r.status).toBe(401);
  });

  it('[14c] notifica al asesor por n8n solo cuando hay canal configurado y la firma es válida', async () => {
    let recibido: { cuerpo: string; ts: string; firma: string } | null = null;
    const servidor = http.createServer((req, res) => {
      let cuerpo = '';
      req.on('data', (c) => (cuerpo += c));
      req.on('end', () => {
        recibido = { cuerpo, ts: String(req.headers['x-drj-timestamp']), firma: String(req.headers['x-drj-firma']) };
        res.writeHead(200, { 'content-type': 'application/json' }).end('{"recibido":true}');
      });
    });
    await new Promise<void>((ok) => servidor.listen(4599, '127.0.0.1', ok));
    try {
      const { enviar, id } = await nuevoChat();
      const r = await enviar('necesito un asesor');
      expect(r.respuestas[0].texto).toMatch(/Ya quedó notificado/);
      expect(recibido).not.toBeNull();
      expect(verificarFirma(SECRETO, recibido!.ts, recibido!.cuerpo, recibido!.firma)).toBe(true);
      expect(JSON.parse(recibido!.cuerpo)).toMatchObject({ evento: 'escalamiento_creado', motivo: 'solicitud_cliente', conversacion_id: id });
      const t = (await pool.query('SELECT notificado, canal_notificacion FROM transferencias_atencion')).rows[0];
      expect(t).toEqual({ notificado: true, canal_notificacion: 'n8n' });
    } finally {
      await new Promise((ok) => servidor.close(ok));
    }
  });

  it('cuando un asesor toma la conversación, el asistente deja de responder y el asesor puede escribir', async () => {
    const token = await tokenCon('vendedor');
    const { enviar, id } = await nuevoChat();
    await enviar('quiero hablar con una persona');
    const tid = (await pool.query('SELECT id FROM transferencias_atencion')).rows[0].id;
    await request(app).patch(`/api/admin/transferencias/${tid}`).set('Authorization', `Bearer ${token}`).send({ estado: 'en_atencion' });
    const r = await request(app).post(`/api/chat/conversaciones/${id}/mensajes`).send({ texto: 'hola?' });
    expect(r.body.data).toMatchObject({ asesor_atendiendo: true, respuestas: [] });
    const m = await request(app).post(`/api/admin/transferencias/${tid}/mensajes`).set('Authorization', `Bearer ${token}`).send({ texto: 'Hola, soy Carlos.' });
    expect(m.body.data.entregado).toBe('chat_web');
    const nuevos = await request(app).get(`/api/chat/conversaciones/${id}/mensajes`);
    expect(nuevos.body.data.mensajes.at(-1)).toMatchObject({ rol: 'asesor', contenido: 'Hola, soy Carlos.' });
  });
});

describe('[13] error de base de datos', () => {
  it('la API responde un error genérico sin exponer detalles internos', async () => {
    vi.spyOn(pool, 'query').mockRejectedValue(Object.assign(new Error('connection terminated: password=supersecreto'), { code: '57P01' }));
    const r = await request(app).get('/api/repuestos/buscar').query({ modelo: 'NMAX', anio: 2020, repuesto: 'bujia' });
    expect(r.status).toBe(500);
    expect(r.body.error.codigo).toBe('ERROR_INTERNO');
    expect(JSON.stringify(r.body)).not.toMatch(/supersecreto|connection/);
  });

  it('el asistente no inventa datos si la base falla durante la búsqueda', async () => {
    const { enviar } = await nuevoChat();
    await enviar('bujía para nmax');
    const original = pool.query.bind(pool);
    vi.spyOn(pool, 'query').mockImplementation(((sql: unknown, ...rest: unknown[]) => {
      if (typeof sql === 'string' && sql.includes('FROM productos p')) return Promise.reject(new Error('BD caída'));
      return (original as (...a: unknown[]) => unknown)(sql, ...rest);
    }) as typeof pool.query);
    const r = await enviar('2020');
    expect(r.respuestas[0].tipo).toBe('error');
    expect(r.respuestas[0].texto).toMatch(/problema técnico/);
    expect(r.respuestas[0].texto).not.toMatch(/\$/);
  });

  it('el servidor sigue vivo si PostgreSQL cierra las conexiones inactivas', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    await Promise.all([pool.query('SELECT 1'), pool.query('SELECT 1')]);
    const admin = new Client({ connectionString: process.env.DATABASE_URL });
    await admin.connect();
    try {
      await admin.query('SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = current_database() AND pid <> pg_backend_pid()');
    } finally {
      await admin.end();
    }
    await new Promise((r) => setTimeout(r, 300));
    const r = await request(app).get('/api/salud');
    expect(r.status).toBe(200);
    expect(r.body.data.base_datos).toBe('ok');
  });

  it('salud informa cuando la base de datos no responde', async () => {
    vi.spyOn(pool, 'query').mockRejectedValue(new Error('down'));
    const r = await request(app).get('/api/salud');
    expect(r.status).toBe(503);
  });
});
