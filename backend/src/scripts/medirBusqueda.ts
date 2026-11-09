/**
 * Mide la búsqueda del catálogo (docs/ARQUITECTURA.md § 7: meta < 150 ms con 50.000 productos).
 *
 * Solo LEE. Úsalo contra una base de pruebas con el catálogo sintético:
 *   psql "$DATABASE_URL" -v n=50000 -f ../database/benchmarks/catalogo_sintetico.sql
 *   DATABASE_URL=... JWT_SECRET=... npm run medir-busqueda
 *
 * Cada búsqueda se ejecuta como en la tienda (lista + total), con la caché de
 * PostgreSQL ya caliente. Reporta mediana (p50), p95 y máximo en milisegundos.
 */
import { pool } from '../db';
import { esquemaFiltros, listarProductos } from '../modulos/catalogo/publico';

const META_MS = 150;
const REPETICIONES = Number(process.env.REPETICIONES ?? 15);

const CASOS: { nombre: string; filtros: Record<string, string | number> }[] = [
  { nombre: 'Portada del catálogo (sin filtros)', filtros: {} },
  { nombre: 'Texto: "pastillas de freno"', filtros: { q: 'pastillas de freno' } },
  { nombre: 'Texto con error: "pastiyas"', filtros: { q: 'pastiyas' } },
  { nombre: 'Texto con error: "bugia"', filtros: { q: 'bugia' } },
  { nombre: 'SKU exacto', filtros: { q: 'SINT-012345' } },
  { nombre: 'Texto que no existe', filtros: { q: 'zzzz inexistente' } },
  { nombre: 'Categoría (grupo frenos)', filtros: { categoria: 'frenos' } },
  { nombre: 'Moto: modelo 1 + año 2018', filtros: { modelo: 1, anio: 2018 } },
  { nombre: 'Moto + texto: modelo 1, 2018, "filtro"', filtros: { modelo: 1, anio: 2018, q: 'filtro' } },
  { nombre: 'Precio máximo + disponibles', filtros: { precio_max: 50000, disponible: 'true' } },
  { nombre: 'Orden por precio, página 50', filtros: { orden: 'precio_asc', pagina: 50 } },
  { nombre: 'Categoría + orden por precio', filtros: { categoria: 'frenos', orden: 'precio_asc' } },
  { nombre: 'Moto + orden por precio', filtros: { modelo: 1, anio: 2018, orden: 'precio_desc' } },
];

const percentil = (xs: number[], p: number) => xs[Math.min(xs.length - 1, Math.floor((p / 100) * xs.length))];

async function main() {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM productos WHERE activo`);
  const promos = await pool.query(`SELECT count(*)::int AS n FROM promociones WHERE activo AND now() >= inicia_at AND now() < termina_at`);
  console.log(`Productos activos en la base: ${rows[0].n} · promociones vigentes: ${promos.rows[0].n}\n`);
  let fallas = 0;
  for (const caso of CASOS) {
    const f = esquemaFiltros.parse(caso.filtros);
    await listarProductos(f); // calienta caché y planes
    const tiempos: number[] = [];
    let total = 0;
    for (let i = 0; i < REPETICIONES; i++) {
      const t0 = performance.now();
      const r = await listarProductos(f);
      tiempos.push(performance.now() - t0);
      total = r.total;
    }
    tiempos.sort((a, b) => a - b);
    const p95 = percentil(tiempos, 95);
    const ok = p95 < META_MS;
    if (!ok) fallas++;
    console.log(
      `${ok ? '✔' : '✘'} ${caso.nombre.padEnd(44)} p50 ${percentil(tiempos, 50).toFixed(0).padStart(4)} ms · p95 ${p95.toFixed(0).padStart(4)} ms · máx ${tiempos[tiempos.length - 1].toFixed(0).padStart(4)} ms · ${total} resultados`,
    );
  }
  console.log(`\n${fallas ? `✘ ${fallas} búsquedas superan ${META_MS} ms en p95` : `✔ Todas las búsquedas quedan por debajo de ${META_MS} ms en p95`}`);
  await pool.end();
  process.exitCode = fallas ? 1 : 0;
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exitCode = 1;
});
