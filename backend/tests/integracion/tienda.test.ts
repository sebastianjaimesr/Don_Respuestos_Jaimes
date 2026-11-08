import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../../src/db';
import { app, idProducto, reiniciarDatos, stock } from '../helpers';

beforeEach(reiniciarDatos);

const skus = (r: request.Response) => r.body.data.items.map((p: { sku: string }) => p.sku).sort();
const idDe = async (tabla: string, nombre: string) => (await pool.query(`SELECT id FROM ${tabla} WHERE nombre = $1`, [nombre])).rows[0].id as number;
const cliente = { nombre: 'Cliente Ficticio', telefono: '3001234567', ciudad: 'Bogotá' };
const checkoutBase = { cliente, entrega: { modalidad: 'recogida_tienda' }, metodo_pago: 'efectivo', confirmado_por_cliente: true };

describe('catálogo público', () => {
  it('busca por texto sin tildes, con raíces y con errores de digitación', async () => {
    const pastillas = await request(app).get('/api/catalogo/productos').query({ q: 'pastillas freno', tamano: 60 });
    expect(pastillas.status).toBe(200);
    expect(skus(pastillas)).toEqual(['DEMO-PF-CB190-D-OR', 'DEMO-PF-FZ2-D-GN', 'DEMO-PF-FZ2-D-OR', 'DEMO-PF-FZ2-T-OR', 'DEMO-PF-MT03-D-OR']);
    const typo = await request(app).get('/api/catalogo/productos').query({ q: 'bugia' });
    expect(skus(typo)).toEqual(['DEMO-BJ-R15-GN', 'DEMO-BJ-XTZ125-OR']);
    const exacto = await request(app).get('/api/catalogo/productos').query({ q: 'demo-ka-ybr-gn' });
    expect(exacto.body.data.items[0].sku).toBe('DEMO-KA-YBR-GN');
  });

  it('filtra por moto solo con compatibilidades verificadas y respeta el año', async () => {
    const xtz = await idDe('modelos_motocicleta', 'XTZ 125');
    const en2018 = await request(app).get('/api/catalogo/productos').query({ modelo: xtz, anio: 2018 });
    expect(skus(en2018)).toEqual(['DEMO-AC-20W50-OR', 'DEMO-BJ-XTZ125-OR']);
    // La bujía solo está registrada hasta 2020
    const en2022 = await request(app).get('/api/catalogo/productos').query({ modelo: xtz, anio: 2022 });
    expect(skus(en2022)).toEqual(['DEMO-AC-20W50-OR']);
    // La bujía de la R15 tiene la compatibilidad SIN verificar: no aparece al filtrar por esa moto
    const r15 = await request(app).get('/api/catalogo/productos').query({ modelo: await idDe('modelos_motocicleta', 'R15') });
    expect(r15.body.data.total).toBe(0);
    const honda = await request(app).get('/api/catalogo/productos').query({ fabricante: await idDe('fabricantes_moto', 'Honda') });
    expect(skus(honda)).toEqual(['DEMO-PF-CB190-D-OR']);
  });

  it('un grupo de categorías incluye sus categorías; lo inactivo no aparece; el precio sin confirmar se marca', async () => {
    const frenos = await request(app).get('/api/catalogo/productos').query({ categoria: 'filtros', tamano: 60 });
    expect(skus(frenos)).toEqual(['DEMO-FA-FZ2-OR', 'DEMO-FA-FZ25-OR', 'DEMO-FAI-NMX-OR', 'DEMO-FAI-NS200-GN']);
    const nmax = frenos.body.data.items.find((p: { sku: string }) => p.sku === 'DEMO-FAI-NMX-OR');
    expect(nmax).toMatchObject({ precio: null, precio_confirmado: false });
    await pool.query(`UPDATE productos SET activo = false WHERE sku = 'DEMO-FA-FZ25-OR'`);
    expect(skus(await request(app).get('/api/catalogo/productos').query({ categoria: 'filtro_aceite' }))).toEqual(['DEMO-FA-FZ2-OR']);
  });

  it('detalle por slug con compatibilidades, advertencia de seguridad y relacionados', async () => {
    const { rows } = await pool.query(`SELECT slug FROM productos WHERE sku = 'DEMO-PF-FZ2-D-OR'`);
    const d = await request(app).get(`/api/catalogo/productos/${rows[0].slug}`);
    expect(d.status).toBe(200);
    expect(d.body.data).toMatchObject({ sku: 'DEMO-PF-FZ2-D-OR', marca: 'Yamaha', tipo: 'original', advertencia_seguridad: true, grupo: { clave: 'frenos' } });
    expect(d.body.data.compatibilidades[0]).toMatchObject({ fabricante: 'Yamaha', modelo: 'FZ 2.0', verificada: true });
    const rel = await request(app).get(`/api/catalogo/productos/${rows[0].slug}/relacionados`);
    expect(rel.body.data.map((p: { sku: string }) => p.sku)).toContain('DEMO-PF-FZ2-D-GN');
    expect((await request(app).get('/api/catalogo/productos/no-existe')).status).toBe(404);
  });

  it('destacados solo con precio confirmado; sugerencias de productos, motos y categorías', async () => {
    const dest = await request(app).get('/api/catalogo/destacados');
    expect(dest.body.data.every((p: { precio: string | null }) => p.precio !== null)).toBe(true);
    expect(dest.body.data.length).toBeGreaterThan(0);
    const s = await request(app).get('/api/catalogo/sugerencias').query({ q: 'fz' });
    expect(s.body.data.motos.map((m: { nombre: string }) => m.nombre)).toEqual(expect.arrayContaining(['FZ 2.0', 'FZ 25']));
    const c = await request(app).get('/api/catalogo/sugerencias').query({ q: 'clutch' });
    expect(c.body.data.categorias.map((x: { clave: string }) => x.clave)).toContain('clutch');
  });
});

describe('carrito en el servidor y checkout', () => {
  it('recalcula precios y valida stock y precio confirmado', async () => {
    const c = (await request(app).post('/api/carritos')).body.data;
    const pf = await idProducto('DEMO-PF-FZ2-D-OR');
    const r = await request(app).put(`/api/carritos/${c.id}/items/${pf}`).send({ cantidad: 2 });
    expect(r.body.data).toMatchObject({ subtotal: '136000.00', listo_para_pedido: true });
    expect((await request(app).put(`/api/carritos/${c.id}/items/${pf}`).send({ cantidad: 6 })).body.error.codigo).toBe('STOCK_INSUFICIENTE');
    expect((await request(app).put(`/api/carritos/${c.id}/items/${await idProducto('DEMO-FAI-NMX-OR')}`).send({ cantidad: 1 })).body.error.codigo).toBe('PRECIO_NO_CONFIRMADO');
    expect((await request(app).put(`/api/carritos/${c.id}/items/${await idProducto('DEMO-FA-FZ2-OR')}`).send({ cantidad: 1 })).body.error.codigo).toBe('AGOTADO');
    // Si el precio cambia, el carrito muestra el nuevo (el navegador nunca fija el precio)
    await pool.query(`UPDATE productos SET precio = 70000 WHERE id = $1`, [pf]);
    expect((await request(app).get(`/api/carritos/${c.id}`)).body.data.subtotal).toBe('140000.00');
    // Si el stock baja por debajo de lo que lleva, el carrito lo señala y no deja pedir
    await pool.query(`SELECT fn_mover_stock($1, 'salida', -4, 'prueba')`, [pf]);
    const tras = (await request(app).get(`/api/carritos/${c.id}`)).body.data;
    expect(tras).toMatchObject({ listo_para_pedido: false, items: [{ problema: 'stock_insuficiente', disponibles: 1 }] });
  });

  it('el checkout registra el pedido web, descuenta stock, es idempotente y no marca pagos', async () => {
    const c = (await request(app).post('/api/carritos')).body.data;
    await request(app).put(`/api/carritos/${c.id}/items/${await idProducto('DEMO-BJ-XTZ125-OR')}`).send({ cantidad: 3 });
    expect((await request(app).post(`/api/carritos/${c.id}/checkout`).send({ ...checkoutBase, confirmado_por_cliente: false })).status).toBe(400);
    const r = await request(app).post(`/api/carritos/${c.id}/checkout`).send(checkoutBase);
    expect(r.status).toBe(201);
    expect(r.body.data.pedido).toMatchObject({ estado: 'registrado', estado_pago: 'pendiente', total: '66000.00' });
    // Sin número confirmado por el dueño, no se inventa un enlace de WhatsApp
    expect(r.body.data.whatsapp).toBeNull();
    expect(await stock('DEMO-BJ-XTZ125-OR')).toBe(7);
    const otra = await request(app).post(`/api/carritos/${c.id}/checkout`).send(checkoutBase);
    expect(otra.status).toBe(200);
    expect(otra.body.data.pedido).toMatchObject({ codigo: r.body.data.pedido.codigo, idempotente: true });
    expect(await stock('DEMO-BJ-XTZ125-OR')).toBe(7);
    const fila = await pool.query('SELECT canal, carrito_id FROM pedidos WHERE codigo = $1', [r.body.data.pedido.codigo]);
    expect(fila.rows[0]).toEqual({ canal: 'web', carrito_id: c.id });
    expect((await request(app).put(`/api/carritos/${c.id}/items/${await idProducto('DEMO-BJ-XTZ125-OR')}`).send({ cantidad: 1 })).body.error.codigo).toBe('CARRITO_CERRADO');
  });

  it('con el número de WhatsApp confirmado, devuelve el enlace con el resumen real', async () => {
    await pool.query(`UPDATE configuracion_negocio SET valor = '"573001112233"', confirmado = true WHERE clave = 'whatsapp_ventas'`);
    const c = (await request(app).post('/api/carritos')).body.data;
    await request(app).put(`/api/carritos/${c.id}/items/${await idProducto('DEMO-BB-CRY-GN')}`).send({ cantidad: 2 });
    const r = await request(app).post(`/api/carritos/${c.id}/checkout`).send(checkoutBase);
    const url = new URL(r.body.data.whatsapp);
    expect(url.origin + url.pathname).toBe('https://wa.me/573001112233');
    expect(url.searchParams.get('text')).toContain(r.body.data.pedido.codigo);
    expect(url.searchParams.get('text')).toContain('Total: $18.000');
  });
});

describe('cuentas de cliente', () => {
  const registro = { nombre: 'Ana Ficticia', email: 'ana@prueba.local', telefono: '3109876543', password: 'ClaveSegura123' };

  it('registro con cookie HttpOnly; las escrituras exigen el token CSRF', async () => {
    const agente = request.agent(app);
    const r = await agente.post('/api/clientes/registro').send(registro);
    expect(r.status).toBe(201);
    expect(String(r.headers['set-cookie'])).toMatch(/drj_cliente=.*HttpOnly/);
    const csrf = r.body.data.csrf;
    expect((await agente.get('/api/clientes/yo')).body.data).toMatchObject({ cliente: { email: 'ana@prueba.local' }, csrf });
    const pf = await idProducto('DEMO-PF-FZ2-D-OR');
    expect((await agente.put(`/api/clientes/yo/favoritos/${pf}`)).body.error.codigo).toBe('CSRF_INVALIDO');
    const fav = await agente.put(`/api/clientes/yo/favoritos/${pf}`).set('X-CSRF-Token', csrf);
    expect(fav.body.data.map((f: { producto_id: number }) => f.producto_id)).toEqual([pf]);
    expect((await request(app).post('/api/clientes/registro').send(registro)).body.error.codigo).toBe('CUENTA_EXISTENTE');
    expect((await request(app).post('/api/clientes/sesion').send({ email: registro.email, password: 'otra-clave-1' })).status).toBe(401);
  });

  it('el historial solo muestra pedidos desde la apertura de la cuenta (protege compras anteriores con ese teléfono)', async () => {
    // Pedido anterior por el chat con el mismo teléfono
    const anon = (await request(app).post('/api/carritos')).body.data;
    await request(app).put(`/api/carritos/${anon.id}/items/${await idProducto('DEMO-BB-CRY-GN')}`).send({ cantidad: 1 });
    const viejo = await request(app).post(`/api/carritos/${anon.id}/checkout`).send({ ...checkoutBase, cliente: { ...cliente, telefono: registro.telefono } });
    await pool.query(`UPDATE pedidos SET created_at = now() - interval '1 day' WHERE codigo = $1`, [viejo.body.data.pedido.codigo]);

    const agente = request.agent(app);
    const csrf = (await agente.post('/api/clientes/registro').send(registro)).body.data.csrf;
    const carrito = (await agente.post('/api/carritos').set('X-CSRF-Token', csrf)).body.data;
    // Un carrito de la cuenta no se abre sin la sesión
    expect((await request(app).get(`/api/carritos/${carrito.id}`)).status).toBe(404);
    await agente.put(`/api/carritos/${carrito.id}/items/${await idProducto('DEMO-AC-20W50-OR')}`).set('X-CSRF-Token', csrf).send({ cantidad: 1 });
    const nuevo = await agente.post(`/api/carritos/${carrito.id}/checkout`).set('X-CSRF-Token', csrf).send({ ...checkoutBase, cliente: { ...cliente, telefono: '3000000000' } });
    expect(nuevo.status).toBe(201);
    const hist = (await agente.get('/api/clientes/yo/pedidos')).body.data.map((p: { codigo: string }) => p.codigo);
    expect(hist).toEqual([nuevo.body.data.pedido.codigo]);
    expect((await agente.get(`/api/clientes/yo/pedidos/${viejo.body.data.pedido.codigo}`)).status).toBe(404);
    // Con sesión, el pedido queda en la cuenta aunque escriba otro teléfono en el formulario
    const tel = await pool.query('SELECT cl.telefono FROM pedidos pe JOIN clientes cl ON cl.id = pe.cliente_id WHERE pe.codigo = $1', [nuevo.body.data.pedido.codigo]);
    expect(tel.rows[0].telefono).toBe(registro.telefono);
  });

  it('al iniciar sesión fusiona el carrito anónimo con el de la cuenta', async () => {
    const anon = (await request(app).post('/api/carritos')).body.data;
    const bj = await idProducto('DEMO-BJ-XTZ125-OR');
    await request(app).put(`/api/carritos/${anon.id}/items/${bj}`).send({ cantidad: 2 });
    const agente = request.agent(app);
    const csrf = (await agente.post('/api/clientes/registro').send(registro)).body.data.csrf;
    const f = await agente.post('/api/clientes/yo/carrito/fusionar').set('X-CSRF-Token', csrf).send({ carrito_id: anon.id });
    expect(f.body.data.items).toMatchObject([{ producto_id: bj, cantidad: 2 }]);
    expect((await pool.query('SELECT estado FROM carritos WHERE id = $1', [anon.id])).rows[0].estado).toBe('abandonado');
  });
});
