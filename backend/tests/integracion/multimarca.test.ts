import fs from 'node:fs';
import path from 'node:path';
import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../../src/db';
import { buscarRepuesto, disponibilidadPorReferencia } from '../../src/modulos/catalogo/servicio';
import { app, idProducto, reiniciarDatos, stock, tokenCon } from '../helpers';

beforeEach(reiniciarDatos);

const SEED = fs.readFileSync(path.resolve(__dirname, '../../../database/seeds/demo_ficticio.sql'), 'utf8');
const BORRAR = fs.readFileSync(path.resolve(__dirname, '../../../database/seeds/borrar_demo.sql'), 'utf8');
const idMarca = async (nombre: string) => (await pool.query('SELECT id FROM marcas_repuesto WHERE nombre = $1', [nombre])).rows[0].id as number;
const idCategoria = async (slug: string) => (await pool.query('SELECT id FROM categorias WHERE slug = $1', [slug])).rows[0].id as number;

describe('modelo de datos multimarca', () => {
  it('los fabricantes y las categorías base vienen en las migraciones', async () => {
    const f = await pool.query('SELECT nombre FROM fabricantes_moto ORDER BY orden');
    expect(f.rows.map((r) => r.nombre)).toEqual([
      'Yamaha', 'Honda', 'Suzuki', 'Bajaj', 'AKT', 'TVS', 'Hero', 'Kawasaki', 'KTM', 'BMW Motorrad', 'Kymco', 'Royal Enfield', 'Victory',
    ]);
    const arbol = await request(app).get('/api/categorias/arbol');
    expect(arbol.status).toBe(200);
    const frenos = arbol.body.data.find((g: { clave: string }) => g.clave === 'frenos');
    expect(frenos.categorias.map((c: { clave: string }) => c.clave)).toEqual(['pastillas_freno', 'bandas_freno', 'disco_freno']);
  });

  it('el chat público lista los modelos con su fabricante', async () => {
    const r = await request(app).get('/api/modelos');
    expect(r.body.data).toEqual(expect.arrayContaining([{ id: expect.any(Number), nombre: 'CB 190R', fabricante: 'Honda' }]));
  });

  it('"original" solo existe con la marca del fabricante de la moto', async () => {
    const generica = await idMarca('Genérica Demo A');
    const bujia = await idCategoria('bujia');
    await expect(
      pool.query(`INSERT INTO productos (referencia, nombre, categoria_id, marca_id, tipo, precio) VALUES ('X-2', 'X', $1, $2, 'original', 1)`, [bujia, generica]),
    ).rejects.toThrow(/original debe ser de la marca de un fabricante/);
    // Una marca con productos no puede cambiar de original a no original
    await expect(pool.query(`UPDATE marcas_repuesto SET fabricante_moto_id = NULL WHERE nombre = 'Yamaha'`)).rejects.toThrow(/ya tiene productos/);
  });

  it('el SKU y el slug se generan solos y son únicos', async () => {
    const { rows } = await pool.query(
      `INSERT INTO productos (referencia, nombre, categoria_id, marca_id, tipo, precio) VALUES ('ab 123 x', 'Bujía Iridio', $1, $2, 'generico', 1) RETURNING sku, slug`,
      [await idCategoria('bujia'), await idMarca('Genérica Demo A')],
    );
    expect(rows[0]).toEqual({ sku: 'AB-123-X', slug: 'bujia-iridio-ab-123-x' });
  });

  it('la búsqueda acepta SKU, referencia con espacios o en minúsculas', async () => {
    expect((await disponibilidadPorReferencia('demo-pf-fz2-d-or')).referencia).toBe('DEMO-PF-FZ2-D-OR');
  });

  it('pedir "genérico" incluye también los alternativos (todo lo que no es original)', async () => {
    const r = await buscarRepuesto({ modelo: 'nkd 125', anio: 2020, repuesto: 'clutch', tipo: 'generico' });
    expect(r.resultados.map((p) => [p.referencia, p.tipo])).toEqual([['DEMO-CL-NKD125-AL', 'alternativo']]);
    const orig = await buscarRepuesto({ modelo: 'nkd 125', anio: 2020, repuesto: 'clutch', tipo: 'original' });
    expect(orig.estado).toBe('sin_resultados');
  });

  it('la búsqueda de texto ignora tildes y mayúsculas', async () => {
    const { rows } = await pool.query(
      `SELECT sku FROM productos WHERE busqueda @@ plainto_tsquery('spanish', f_normalizar($1)) ORDER BY sku`,
      ['BUJIA'],
    );
    expect(rows.map((r) => r.sku)).toEqual(['DEMO-BJ-R15-GN', 'DEMO-BJ-XTZ125-OR']);
  });
});

describe('inventario protegido y auditoría', () => {
  it('la cantidad solo cambia con un movimiento registrado', async () => {
    const id = await idProducto('DEMO-PF-FZ2-D-OR');
    await expect(pool.query('UPDATE inventario SET cantidad = 99 WHERE producto_id = $1', [id])).rejects.toThrow(/solo cambia con un movimiento/);
    expect(await stock('DEMO-PF-FZ2-D-OR')).toBe(5);
    const { rows } = await pool.query(`SELECT * FROM fn_mover_stock($1, 'ajuste', -2, 'Conteo físico')`, [id]);
    expect(rows[0]).toMatchObject({ cantidad: -2, cantidad_anterior: 5, cantidad_nueva: 3 });
    expect(await stock('DEMO-PF-FZ2-D-OR')).toBe(3);
  });

  it('un cambio de precio desde el panel queda en el historial y en la auditoría con su autor', async () => {
    const token = await tokenCon('admin');
    const asesor = (await pool.query(`SELECT id FROM asesores WHERE rol = 'admin' ORDER BY id DESC LIMIT 1`)).rows[0].id;
    const id = await idProducto('DEMO-PF-FZ2-D-OR');
    const r = await request(app)
      .put(`/api/admin/productos/${id}`)
      .set('Authorization', `Bearer ${token}`)
      .send({ referencia: 'DEMO-PF-FZ2-D-OR', nombre: 'Pastillas de freno delanteras', categoria: 'pastillas_freno', marca_id: await idMarca('Yamaha'), precio: 70000 });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ categoria: 'pastillas_freno', tipo: 'original' });
    const h = await pool.query('SELECT precio_anterior, precio_nuevo, origen, asesor_id FROM historial_precios WHERE producto_id = $1', [id]);
    expect(h.rows).toEqual([{ precio_anterior: '68000.00', precio_nuevo: '70000.00', origen: 'manual', asesor_id: asesor }]);
    const a = await pool.query(`SELECT cambios, asesor_id FROM auditoria WHERE tabla = 'productos' AND registro_id = $1 AND accion = 'UPDATE'`, [String(id)]);
    expect(a.rows[0]).toMatchObject({ asesor_id: asesor, cambios: { precio: { antes: 68000, despues: 70000 } } });
  });

  it('un movimiento del panel queda firmado por el asesor', async () => {
    const token = await tokenCon('vendedor');
    const id = await idProducto('DEMO-KA-YBR-GN');
    const r = await request(app)
      .post(`/api/admin/inventario/${id}/movimientos`)
      .set('Authorization', `Bearer ${token}`)
      .send({ tipo: 'ajuste', cantidad_nueva: 4, motivo: 'Conteo físico' });
    expect(r.status).toBe(201);
    expect(r.body.data).toMatchObject({ tipo: 'ajuste', cantidad: 3, cantidad_anterior: 1, cantidad_nueva: 4, asesor_id: expect.any(Number) });
  });

  it('el panel crea marcas originales solo para fabricantes registrados', async () => {
    const auth = { Authorization: `Bearer ${await tokenCon('admin')}` };
    const ok = await request(app).post('/api/admin/marcas').set(auth).send({ nombre: 'Bajaj', tipo: 'original' });
    expect(ok.status).toBe(201);
    expect(ok.body.data).toMatchObject({ tipo: 'original', fabricante_moto_id: expect.any(Number) });
    const mal = await request(app).post('/api/admin/marcas').set(auth).send({ nombre: 'Marca Inventada', tipo: 'original' });
    expect(mal.body.error.codigo).toBe('FABRICANTE_REQUERIDO');
  });

  it('roles y permisos: el vendedor mueve inventario pero no edita productos', async () => {
    const { rows } = await pool.query(`SELECT permiso FROM rol_permisos WHERE rol = 'vendedor' ORDER BY permiso`);
    const permisos = rows.map((r) => r.permiso);
    expect(permisos).toContain('inventario.mover');
    expect(permisos).not.toContain('productos.editar');
  });
});

describe('datos de demostración', () => {
  it('cargarlos dos veces no duplica nada y se pueden borrar por completo', async () => {
    const contar = async () =>
      (await pool.query(`SELECT (SELECT count(*) FROM productos) p, (SELECT count(*) FROM movimientos_inventario) m, (SELECT sum(cantidad) FROM inventario) s`)).rows[0];
    const antes = await contar();
    await pool.query(SEED);
    expect(await contar()).toEqual(antes);
    await pool.query(BORRAR);
    const r = await pool.query(`SELECT (SELECT count(*) FROM productos WHERE es_demo) p, (SELECT count(*) FROM modelos_motocicleta WHERE es_demo) m`);
    expect(r.rows[0]).toEqual({ p: 0, m: 0 });
  });
});
