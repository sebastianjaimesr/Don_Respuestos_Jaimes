-- =====================================================================
-- Catálogo SINTÉTICO para medir la búsqueda (docs/ARQUITECTURA.md § 7).
-- Solo para una base de pruebas (por ejemplo drj_bench). NUNCA en producción:
-- crea productos ficticios SINT-* marcados es_demo = true.
-- Parámetro: \set n 50000 (por defecto lo pasa el script medir-busqueda).
-- =====================================================================
\if :{?n}
\else
  \set n 50000
\endif

BEGIN;

INSERT INTO marcas_repuesto (nombre, es_demo)
SELECT 'Sintética ' || i, true FROM generate_series(1, 40) i
ON CONFLICT (nombre) DO NOTHING;

CREATE TEMP TABLE _hojas AS SELECT id, nombre, row_number() OVER (ORDER BY id) AS k FROM categorias WHERE padre_id IS NOT NULL;
CREATE TEMP TABLE _marcas AS SELECT id, row_number() OVER (ORDER BY id) AS k FROM marcas_repuesto WHERE nombre LIKE 'Sintética %';
CREATE TEMP TABLE _modelos AS SELECT id, row_number() OVER (ORDER BY id) AS k FROM modelos_motocicleta;

INSERT INTO productos (sku, referencia, nombre, descripcion, categoria_id, marca_id, tipo, precio, precio_compra, es_demo)
SELECT 'SINT-' || lpad(g::text, 6, '0'),
       'SR' || (100000 + g),
       h.nombre || ' ' || (ARRAY['reforzado','premium','estándar','sport','heavy duty','económico','racing','touring'])[1 + g % 8] || ' ' || (g % 997),
       'Producto sintético para pruebas de rendimiento. ' || h.nombre || ' compatible con varias motos.',
       h.id, m.id,
       CASE WHEN g % 5 = 0 THEN 'alternativo' ELSE 'generico' END,
       CASE WHEN g % 20 = 0 THEN NULL ELSE 5000 + (g * 7919) % 400000 END,
       NULL, true
FROM generate_series(1, :n) g
JOIN _hojas h ON h.k = 1 + g % (SELECT count(*) FROM _hojas)
JOIN _marcas m ON m.k = 1 + g % (SELECT count(*) FROM _marcas)
ON CONFLICT (sku) DO NOTHING;

INSERT INTO inventario (producto_id, cantidad, stock_minimo)
SELECT p.id, (p.id * 31) % 25, 2 FROM productos p WHERE p.sku LIKE 'SINT-%'
ON CONFLICT (producto_id) DO NOTHING;

-- 1 a 3 compatibilidades verificadas por producto
INSERT INTO compatibilidades (producto_id, modelo_id, anio_desde, anio_hasta, verificada, fuente)
SELECT p.id, mo.id, 2008 + (p.id + r) % 8, 2016 + (p.id + r) % 9, true, 'Sintético (pruebas de rendimiento)'
FROM productos p
CROSS JOIN generate_series(0, 2) r
JOIN _modelos mo ON mo.k = 1 + (p.id * 13 + r * 7) % (SELECT count(*) FROM _modelos)
WHERE p.sku LIKE 'SINT-%' AND r <= p.id % 3
  AND NOT EXISTS (SELECT 1 FROM compatibilidades c WHERE c.producto_id = p.id AND c.modelo_id = mo.id);

COMMIT;
ANALYZE productos; ANALYZE inventario; ANALYZE compatibilidades;
SELECT count(*) AS productos_sinteticos FROM productos WHERE sku LIKE 'SINT-%';

-- Opcional: 5 promociones vigentes para medir el caso con descuentos (-v promos=1).
\if :{?promos}
INSERT INTO promociones (nombre, tipo_descuento, valor, alcance, marca_id, categoria_id, inicia_at, termina_at)
SELECT 'SINT promoción ' || i, CASE WHEN i % 2 = 0 THEN 'porcentaje' ELSE 'valor' END, CASE WHEN i % 2 = 0 THEN 10 ELSE 2000 END,
       CASE WHEN i <= 3 THEN 'marca' ELSE 'categoria' END,
       CASE WHEN i <= 3 THEN (SELECT id FROM marcas_repuesto WHERE nombre = 'Sintética ' || i) END,
       CASE WHEN i > 3 THEN (SELECT id FROM categorias WHERE padre_id IS NOT NULL ORDER BY id OFFSET i LIMIT 1) END,
       now() - interval '1 day', now() + interval '30 days'
FROM generate_series(1, 5) i;
\endif
