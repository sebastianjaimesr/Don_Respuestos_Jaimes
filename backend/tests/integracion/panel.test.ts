import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../../src/db';
import { crearAsesor } from '../../src/modulos/auth/servicio';
import { registrarPedido } from '../../src/modulos/pedidos/servicio';
import { asegurarCategorias, invalidarCategorias } from '../../src/modulos/catalogo/categorias';
import { detectarCategoria } from '../../src/asistente/extraccion';
import { app, idProducto, pedidoBase, reiniciarDatos, stock, tokenCon } from '../helpers';

beforeEach(async () => {
  await reiniciarDatos();
  invalidarCategorias();
});

const auth = (t: string) => ({ Authorization: `Bearer ${t}` });
const idMarca = async (nombre: string) => (await pool.query('SELECT id FROM marcas_repuesto WHERE nombre = $1', [nombre])).rows[0].id as number;

/** Crea un rol personalizado con esos permisos y devuelve el token de un usuario con ese rol. */
async function tokenConPermisos(clave: string, permisos: string[]) {
  const admin = await tokenCon('admin');
  expect((await request(app).post('/api/admin/roles').set(auth(admin)).send({ clave, nombre: `Rol ${clave}` })).status).toBe(201);
  expect((await request(app).put(`/api/admin/roles/${clave}/permisos`).set(auth(admin)).send({ permisos })).status).toBe(200);
  const email = `${clave}@prueba.local`;
  await crearAsesor({ nombre: `Usuario ${clave}`, email, password: 'ClavePrueba123', rol: clave });
  return (await request(app).post('/api/auth/login').send({ email, password: 'ClavePrueba123' })).body.data.token as string;
}

async function proveedor(t: string) {
  const r = await request(app).post('/api/admin/proveedores').set(auth(t)).send({ nombre: 'Proveedor Ficticio', nit: '900123456-1' });
  expect(r.status).toBe(201);
  return r.body.data.id as number;
}

describe('sesión del panel con cookie', () => {
  it('el login deja una cookie HttpOnly y las escrituras exigen el token CSRF', async () => {
    await crearAsesor({ nombre: 'Admin Cookie', email: 'cookie@prueba.local', password: 'ClavePrueba123', rol: 'admin' });
    const agente = request.agent(app);
    const login = await agente.post('/api/auth/login').send({ email: 'cookie@prueba.local', password: 'ClavePrueba123' });
    expect(login.status).toBe(200);
    const cookie = String(login.headers['set-cookie']);
    expect(cookie).toMatch(/drj_panel=/);
    expect(cookie).toMatch(/HttpOnly/i);
    const csrf = login.body.data.csrf as string;

    // Lectura con la cookie: no necesita CSRF
    const yo = await agente.get('/api/auth/yo');
    expect(yo.body.data).toMatchObject({ nombre: 'Admin Cookie', rol: 'admin', csrf });

    // Escritura sin el token → 403; con el token → pasa
    const sin = await agente.post('/api/admin/proveedores').send({ nombre: 'Prov Sin Token' });
    expect(sin.status).toBe(403);
    expect(sin.body.error.codigo).toBe('CSRF_INVALIDO');
    const con = await agente.post('/api/admin/proveedores').set('X-CSRF-Token', csrf).send({ nombre: 'Prov Con Token' });
    expect(con.status).toBe(201);

    await agente.post('/api/auth/logout');
    expect((await agente.get('/api/auth/yo')).status).toBe(401);
  });
});

describe('permisos por rol', () => {
  it('el rol consulta puede ver pero no registrar compras', async () => {
    const t = await tokenCon('consulta');
    expect((await request(app).get('/api/admin/compras').set(auth(t))).status).toBe(200);
    const r = await request(app)
      .post('/api/admin/compras')
      .set(auth(t))
      .send({ proveedor_id: 1, lineas: [{ producto_id: 1, cantidad: 1, costo_unitario: 1000 }] });
    expect(r.status).toBe(403);
  });

  it('editar productos no basta para cambiar precios', async () => {
    const t = await tokenConPermisos('editor_fichas', ['catalogo.ver', 'productos.editar']);
    const id = await idProducto('DEMO-BJ-R15-GN');
    const base = {
      referencia: 'DEMO-BJ-R15-GN',
      nombre: 'Bujía (nombre corregido)',
      categoria: 'bujia',
      marca_id: await idMarca('Genérica Demo A'),
      precio: 15000,
    };
    const nombre = await request(app).put(`/api/admin/productos/${id}`).set(auth(t)).send(base);
    expect(nombre.status).toBe(200);
    expect(nombre.body.data.nombre).toBe('Bujía (nombre corregido)');
    const precio = await request(app).put(`/api/admin/productos/${id}`).set(auth(t)).send({ ...base, precio: 99000 });
    expect(precio.status).toBe(403);
    expect((await pool.query('SELECT precio FROM productos WHERE id = $1', [id])).rows[0].precio).toBe('15000.00');
  });

  it('los permisos del rol administrador no se pueden cambiar', async () => {
    const t = await tokenCon('admin');
    const r = await request(app).put('/api/admin/roles/admin/permisos').set(auth(t)).send({ permisos: [] });
    expect(r.status).toBe(400);
  });
});

describe('compras a proveedores', () => {
  it('recibir suma stock con movimientos ligados a la compra; anular los saca', async () => {
    const t = await tokenCon('admin');
    const prov = await proveedor(t);
    const bujia = await idProducto('DEMO-BJ-R15-GN');
    const antes = await stock('DEMO-BJ-R15-GN');
    const c = await request(app)
      .post('/api/admin/compras')
      .set(auth(t))
      .send({ proveedor_id: prov, factura_proveedor: 'F-001', lineas: [{ producto_id: bujia, cantidad: 10, costo_unitario: 8000.5 }] });
    expect(c.status).toBe(201);
    expect(c.body.data).toMatchObject({ estado: 'borrador', subtotal: '80005.00' });
    expect(await stock('DEMO-BJ-R15-GN')).toBe(antes); // el borrador no toca el stock

    const rec = await request(app).post(`/api/admin/compras/${c.body.data.id}/recibir`).set(auth(t)).send({ actualizar_costos: true });
    expect(rec.status).toBe(200);
    expect(rec.body.data.estado).toBe('recibida');
    expect(await stock('DEMO-BJ-R15-GN')).toBe(antes + 10);
    const mov = await pool.query('SELECT tipo, cantidad, compra_id FROM movimientos_inventario WHERE producto_id = $1 ORDER BY id DESC LIMIT 1', [bujia]);
    expect(mov.rows[0]).toMatchObject({ tipo: 'entrada', compra_id: c.body.data.id });
    const hist = await pool.query('SELECT precio_compra_nuevo, origen FROM historial_precios WHERE producto_id = $1 ORDER BY id DESC LIMIT 1', [bujia]);
    expect(hist.rows[0]).toEqual({ precio_compra_nuevo: '8000.50', origen: 'compra' });

    // Recibida: ya no se edita ni se recibe dos veces
    expect((await request(app).post(`/api/admin/compras/${c.body.data.id}/recibir`).set(auth(t)).send({})).status).toBe(409);

    const an = await request(app).post(`/api/admin/compras/${c.body.data.id}/anular`).set(auth(t)).send({ motivo: 'Factura equivocada' });
    expect(an.status).toBe(200);
    expect(an.body.data.estado).toBe('anulada');
    expect(await stock('DEMO-BJ-R15-GN')).toBe(antes);
  });

  it('no deja anular una compra cuyas unidades ya se vendieron', async () => {
    const t = await tokenCon('admin');
    const prov = await proveedor(t);
    const kit = await idProducto('DEMO-KA-YBR-GN'); // 1 unidad en stock
    const c = await request(app).post('/api/admin/compras').set(auth(t)).send({ proveedor_id: prov, lineas: [{ producto_id: kit, cantidad: 2, costo_unitario: 90000 }] });
    await request(app).post(`/api/admin/compras/${c.body.data.id}/recibir`).set(auth(t)).send({});
    expect(await stock('DEMO-KA-YBR-GN')).toBe(3);
    await registrarPedido(pedidoBase([{ producto_id: kit, cantidad: 2 }]));
    const an = await request(app).post(`/api/admin/compras/${c.body.data.id}/anular`).set(auth(t)).send({ motivo: 'Prueba' });
    expect(an.status).toBe(409);
    expect(an.body.error.codigo).toBe('STOCK_INSUFICIENTE');
    expect(await stock('DEMO-KA-YBR-GN')).toBe(1);
  });
});

describe('precios masivos', () => {
  it('la vista previa no cambia nada; aplicar deja historial con origen "masivo"', async () => {
    const t = await tokenCon('admin');
    const cuerpo = { filtros: { categoria: 'bujia' }, modo: 'porcentaje', valor: 10, redondeo: 'cien' };
    const prev = await request(app).post('/api/admin/precios/masivo').set(auth(t)).send(cuerpo);
    expect(prev.status).toBe(200);
    expect(prev.body.data.aplicado).toBe(false);
    const nuevos = Object.fromEntries(prev.body.data.productos.map((p: { sku: string; precio_nuevo: string }) => [p.sku, p.precio_nuevo]));
    expect(nuevos).toEqual({ 'DEMO-BJ-XTZ125-OR': '24200.00', 'DEMO-BJ-R15-GN': '16500.00' });
    expect((await pool.query(`SELECT precio FROM productos WHERE sku = 'DEMO-BJ-R15-GN'`)).rows[0].precio).toBe('15000.00');

    const ap = await request(app).post('/api/admin/precios/masivo').set(auth(t)).send({ ...cuerpo, aplicar: true });
    expect(ap.body.data).toMatchObject({ aplicado: true, total: 2 });
    const id = await idProducto('DEMO-BJ-R15-GN');
    const h = await request(app).get(`/api/admin/productos/${id}/precios`).set(auth(t));
    expect(h.body.data[0]).toMatchObject({ precio_anterior: '15000.00', precio_nuevo: '16500.00', origen: 'masivo' });
  });

  it('exige al menos un filtro y no inventa precios para productos sin precio', async () => {
    const t = await tokenCon('admin');
    expect((await request(app).post('/api/admin/precios/masivo').set(auth(t)).send({ modo: 'valor', valor: 1000 })).status).toBe(400);
    const r = await request(app).post('/api/admin/precios/masivo').set(auth(t)).send({ filtros: { categoria: 'filtro_aire' }, modo: 'valor', valor: 1000, aplicar: true });
    expect(r.body.data.productos.map((p: { sku: string }) => p.sku)).toEqual(['DEMO-FAI-NS200-GN']);
    expect((await pool.query(`SELECT precio FROM productos WHERE sku = 'DEMO-FAI-NMX-OR'`)).rows[0].precio).toBeNull();
  });
});

describe('categorías administrables', () => {
  it('un sinónimo nuevo lo entiende el asistente y la búsqueda pública', async () => {
    const t = await tokenCon('admin');
    const arbol = await request(app).get('/api/admin/categorias/arbol').set(auth(t));
    expect(arbol.status).toBe(200);
    const fila = (await pool.query(`SELECT id, nombre, sinonimos, requiere_posicion, es_seguridad FROM categorias WHERE slug = 'bujia'`)).rows[0];
    const padre = (await pool.query(`SELECT g.slug FROM categorias c JOIN categorias g ON g.id = c.padre_id WHERE c.slug = 'bujia'`)).rows[0]?.slug ?? null;
    const r = await request(app)
      .put(`/api/admin/categorias/${fila.id}`)
      .set(auth(t))
      .send({ nombre: fila.nombre, padre, sinonimos: [...fila.sinonimos, 'chispero'], requiere_posicion: fila.requiere_posicion, es_seguridad: fila.es_seguridad });
    expect(r.status).toBe(200);

    await asegurarCategorias();
    expect(detectarCategoria('necesito un chispero para la moto')).toEqual({ tipo: 'encontrada', clave: 'bujia' });
    const busqueda = await request(app).get('/api/catalogo/productos').query({ q: 'chispero' });
    expect(busqueda.body.data.items.map((p: { sku: string }) => p.sku).sort()).toEqual(['DEMO-BJ-R15-GN', 'DEMO-BJ-XTZ125-OR']);
  });
});

describe('productos y pagos', () => {
  it('borra un producto sin historial; uno con movimientos solo se puede desactivar', async () => {
    const t = await tokenCon('admin');
    const nuevo = await request(app)
      .post('/api/admin/productos')
      .set(auth(t))
      .send({ referencia: 'DEMO-NUEVO-1', nombre: 'Producto de prueba', categoria: 'bujia', marca_id: await idMarca('Genérica Demo A'), precio: null });
    expect(nuevo.status).toBe(201);
    expect((await request(app).delete(`/api/admin/productos/${nuevo.body.data.id}`).set(auth(t))).status).toBe(200);

    const conHistorial = await idProducto('DEMO-BJ-R15-GN');
    await registrarPedido(pedidoBase([{ producto_id: conHistorial, cantidad: 1 }]));
    const del = await request(app).delete(`/api/admin/productos/${conHistorial}`).set(auth(t));
    expect(del.status).toBe(409);
    expect(del.body.error.codigo).toBe('PRODUCTO_CON_HISTORIAL');
    const est = await request(app).patch(`/api/admin/productos/${conHistorial}/estado`).set(auth(t)).send({ activo: false });
    expect(est.body.data).toMatchObject({ activo: false });
  });

  it('el pago queda confirmado solo cuando lo aprobado cubre el total', async () => {
    const t = await tokenCon('vendedor');
    const p = await registrarPedido(pedidoBase([{ producto_id: await idProducto('DEMO-BB-CRY-GN'), cantidad: 2 }])); // $18.000
    const pagar = (monto: number, estado: string, referencia: string) =>
      request(app).post(`/api/admin/pedidos/${p.codigo}/pagos`).set(auth(t)).send({ monto, metodo: 'nequi', referencia, estado });

    expect((await pagar(10000, 'aprobado', 'NQ-1')).body.data).toMatchObject({ estado_pago: 'pendiente' });
    expect((await pagar(8000, 'rechazado', 'NQ-2')).body.data).toMatchObject({ estado_pago: 'pendiente' });
    expect((await pagar(8000, 'aprobado', 'NQ-3')).body.data).toMatchObject({ estado_pago: 'confirmado' });
    const lista = await request(app).get(`/api/admin/pedidos/${p.codigo}/pagos`).set(auth(t));
    expect(lista.body.data).toHaveLength(3);
  });
});
