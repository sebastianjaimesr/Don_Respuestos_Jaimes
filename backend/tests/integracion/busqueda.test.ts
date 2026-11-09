import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { pool } from '../../src/db';
import { app, idProducto, reiniciarDatos } from '../helpers';

/** Cambios de rendimiento de la fase 8 (migración 014): mismos resultados, consultas con índice. */
beforeEach(reiniciarDatos);

const buscar = (q: Record<string, string | number>) => request(app).get('/api/catalogo/productos').query(q);
const skus = (r: request.Response) => r.body.data.items.map((p: { sku: string }) => p.sku);

describe('búsqueda del catálogo (fase 8)', () => {
  it('tolera errores de escritura con el vocabulario del catálogo, también en productos nuevos', async () => {
    expect(skus(await buscar({ q: 'pastiyas delanteras' })).length).toBeGreaterThan(0);
    // Un nombre nuevo alimenta el vocabulario con su trigger
    await pool.query(`UPDATE productos SET nombre = 'Guaya de embrague' WHERE sku = 'DEMO-CL-NKD125-AL'`);
    expect(skus(await buscar({ q: 'guayya' }))).toEqual(['DEMO-CL-NKD125-AL']);
    // Palabras de menos de 4 letras o sin parecido no hacen coincidir nada por error
    expect((await buscar({ q: 'xyzw' })).body.data.total).toBe(0);
  });

  it('el total y la página coinciden con los filtros, en el orden pedido', async () => {
    const todos = await buscar({ tamano: 60 });
    expect(todos.body.data.total).toBe(todos.body.data.items.length);
    const pag1 = await buscar({ orden: 'nombre', tamano: 5, pagina: 1 });
    const pag2 = await buscar({ orden: 'nombre', tamano: 5, pagina: 2 });
    const nombres = [...pag1.body.data.items, ...pag2.body.data.items].map((p: { nombre: string }) => p.nombre);
    expect(nombres).toEqual([...nombres].sort((a, b) => a.localeCompare(b, 'es')));
    expect(new Set([...skus(pag1), ...skus(pag2)]).size).toBe(10);
  });

  it('ordena y filtra por el precio CON promoción cuando hay promociones vigentes', async () => {
    const asc = (r: request.Response) => r.body.data.items.map((p: { precio: string | null }) => p.precio).filter(Boolean).map(Number);
    const sinPromo = asc(await buscar({ orden: 'precio_asc', tamano: 60 }));
    expect(sinPromo).toEqual([...sinPromo].sort((a, b) => a - b));

    // 90 % de descuento al amortiguador ($160.000 → $16.000): queda antes de las pastillas de $32.000
    const caro = await idProducto('DEMO-AM-GN125-GN'); // $160.000
    await pool.query(
      `INSERT INTO promociones (nombre, tipo_descuento, valor, alcance, producto_id, inicia_at, termina_at)
       VALUES ('Promo prueba', 'porcentaje', 90, 'producto', $1, now() - interval '1 hour', now() + interval '1 day')`,
      [caro],
    );
    const conPromo = await buscar({ orden: 'precio_asc', tamano: 60 });
    const lista = skus(conPromo);
    expect(lista.indexOf('DEMO-AM-GN125-GN')).toBeLessThan(lista.indexOf('DEMO-PF-FZ2-D-GN'));
    expect(asc(conPromo)).toEqual([...asc(conPromo)].sort((a, b) => a - b));
    expect(conPromo.body.data.items.find((p: { sku: string }) => p.sku === 'DEMO-AM-GN125-GN').precio).toBe('16000.00');
    const baratos = await buscar({ precio_max: 17000, tamano: 60 });
    expect(skus(baratos)).toContain('DEMO-AM-GN125-GN');
    expect(baratos.body.data.total).toBe(baratos.body.data.items.length);
  });
});
