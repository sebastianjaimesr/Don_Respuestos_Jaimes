-- =====================================================================
-- DATOS DE DEMOSTRACIÓN — 100 % FICTICIOS
-- ---------------------------------------------------------------------
-- * Todas las referencias empiezan por "DEMO-" y tienen es_demo = true.
-- * Precios, existencias y compatibilidades son INVENTADOS para pruebas.
-- * NO representan el inventario real de Don Repuestos Jaimes.
-- * Los nombres de modelos Yamaha son reales, pero los años y las
--   compatibilidades aquí cargadas NO están verificados contra catálogos.
-- Para borrarlos: ver database/seeds/borrar_demo.sql
-- =====================================================================

BEGIN;

INSERT INTO marcas (nombre, tipo, es_demo) VALUES
  ('Yamaha', 'original', false),
  ('Genérica Demo A', 'generico', true),
  ('Genérica Demo B', 'generico', true)
ON CONFLICT (nombre) DO NOTHING;

-- Modelos: los años se dejan NULL porque no están verificados.
INSERT INTO modelos_motocicleta (nombre, cilindraje_cc, alias, es_demo) VALUES
  ('FZ 2.0',   150, ARRAY['fz 2.0','fz2.0','fz 2','fz2','fz 150','fz150','fz'], false),
  ('FZ 25',    250, ARRAY['fz 25','fz25','fz 250','fz250','fz'], false),
  ('NMAX',     155, ARRAY['nmax','n max','nmax 155'], false),
  ('XTZ 125',  125, ARRAY['xtz 125','xtz125','xtz'], false),
  ('XTZ 150',  150, ARRAY['xtz 150','xtz150','xtz'], false),
  ('YBR 125',  125, ARRAY['ybr 125','ybr125','ybr'], false),
  ('BWS 125',  125, ARRAY['bws','bws 125','bws125','biwis','bwis'], false),
  ('Crypton',  115, ARRAY['crypton','cripton','crypton fi'], false),
  ('MT-03',    321, ARRAY['mt 03','mt03','mt 3','mt3'], false),
  ('R15',      155, ARRAY['r15','r 15','r15 v3','r15 v4'], false)
ON CONFLICT (fabricante, nombre) DO NOTHING;

-- Productos ficticios
WITH m AS (SELECT id, nombre FROM marcas)
INSERT INTO productos (referencia, nombre, descripcion, categoria, posicion, marca_id, tipo, precio, es_demo) VALUES
  ('DEMO-PF-FZ2-D-OR', 'Pastillas de freno delanteras', 'Juego de pastillas para freno de disco delantero.', 'pastillas_freno', 'delantero', (SELECT id FROM m WHERE nombre='Yamaha'), 'original', 68000, true),
  ('DEMO-PF-FZ2-D-GN', 'Pastillas de freno delanteras', 'Alternativa genérica, compuesto semimetálico.', 'pastillas_freno', 'delantero', (SELECT id FROM m WHERE nombre='Genérica Demo A'), 'generico', 32000, true),
  ('DEMO-PF-FZ2-T-OR', 'Pastillas de freno traseras', 'Juego de pastillas para freno de disco trasero.', 'pastillas_freno', 'trasero', (SELECT id FROM m WHERE nombre='Yamaha'), 'original', 59000, true),
  ('DEMO-FA-FZ2-OR',   'Filtro de aceite', 'Filtro de aceite tipo cartucho.', 'filtro_aceite', NULL, (SELECT id FROM m WHERE nombre='Yamaha'), 'original', 18000, true),
  ('DEMO-FA-FZ25-OR',  'Filtro de aceite', 'Filtro de aceite tipo cartucho.', 'filtro_aceite', NULL, (SELECT id FROM m WHERE nombre='Yamaha'), 'original', 21000, true),
  ('DEMO-FAI-NMX-OR',  'Filtro de aire', 'Elemento filtrante de aire.', 'filtro_aire', NULL, (SELECT id FROM m WHERE nombre='Yamaha'), 'original', NULL, true),
  ('DEMO-KA-YBR-GN',   'Kit de arrastre', 'Piñón, corona y cadena.', 'kit_arrastre', NULL, (SELECT id FROM m WHERE nombre='Genérica Demo B'), 'generico', 145000, true),
  ('DEMO-BJ-XTZ125-OR','Bujía', 'Bujía estándar.', 'bujia', NULL, (SELECT id FROM m WHERE nombre='Yamaha'), 'original', 22000, true),
  ('DEMO-BJ-R15-GN',   'Bujía', 'Bujía genérica de reemplazo.', 'bujia', NULL, (SELECT id FROM m WHERE nombre='Genérica Demo A'), 'generico', 15000, true),
  ('DEMO-LL-BWS-T-GN', 'Llanta trasera', 'Llanta trasera para scooter.', 'llanta', 'trasero', (SELECT id FROM m WHERE nombre='Genérica Demo B'), 'generico', 120000, true),
  ('DEMO-AC-20W50-OR', 'Aceite de motor 4T 20W50 (1 L)', 'Aceite para motor 4 tiempos.', 'aceite_motor', NULL, (SELECT id FROM m WHERE nombre='Yamaha'), 'original', 35000, true),
  ('DEMO-BB-CRY-GN',   'Bombillo de farola', 'Bombillo halógeno de farola.', 'bombillo', NULL, (SELECT id FROM m WHERE nombre='Genérica Demo A'), 'generico', 9000, true),
  ('DEMO-PF-MT03-D-OR','Pastillas de freno delanteras', 'Juego de pastillas delanteras.', 'pastillas_freno', 'delantero', (SELECT id FROM m WHERE nombre='Yamaha'), 'original', 165000, true)
ON CONFLICT DO NOTHING;

-- Inventario ficticio
INSERT INTO inventario (producto_id, cantidad, stock_minimo, ubicacion, tiempo_abastecimiento_dias)
SELECT p.id, v.cantidad, v.minimo, v.ubicacion, v.dias
FROM (VALUES
  ('DEMO-PF-FZ2-D-OR', 5, 2, 'Estante A1', NULL),
  ('DEMO-PF-FZ2-D-GN', 3, 2, 'Estante A1', NULL),
  ('DEMO-PF-FZ2-T-OR', 4, 2, 'Estante A2', NULL),
  ('DEMO-FA-FZ2-OR',   0, 3, 'Estante B1', 5),      -- AGOTADO con abastecimiento conocido
  ('DEMO-FA-FZ25-OR',  7, 3, 'Estante B1', NULL),
  ('DEMO-FAI-NMX-OR',  6, 2, 'Estante B2', NULL),   -- precio faltante
  ('DEMO-KA-YBR-GN',   1, 1, 'Bodega',     NULL),   -- última unidad
  ('DEMO-BJ-XTZ125-OR',10, 4, 'Cajón C3',  NULL),
  ('DEMO-BJ-R15-GN',   8, 4, 'Cajón C3',   NULL),
  ('DEMO-LL-BWS-T-GN', 2, 2, 'Bodega',     NULL),   -- stock bajo
  ('DEMO-AC-20W50-OR', 20, 6, 'Vitrina',   NULL),
  ('DEMO-BB-CRY-GN',   12, 4, 'Cajón D1',  NULL),
  ('DEMO-PF-MT03-D-OR',2, 1, 'Estante A3', NULL)
) AS v(ref, cantidad, minimo, ubicacion, dias)
JOIN productos p ON p.referencia = v.ref
ON CONFLICT (producto_id) DO NOTHING;

-- Compatibilidades ficticias
INSERT INTO compatibilidades (producto_id, modelo_id, anio_desde, anio_hasta, verificada, fuente, notas)
SELECT p.id, mo.id, v.desde, v.hasta, v.verificada, v.fuente, v.notas
FROM (VALUES
  ('DEMO-PF-FZ2-D-OR', 'FZ 2.0', 2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-PF-FZ2-D-GN', 'FZ 2.0', 2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-PF-FZ2-T-OR', 'FZ 2.0', 2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-FA-FZ2-OR',   'FZ 2.0', 2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-FA-FZ25-OR',  'FZ 25',  2017, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-FAI-NMX-OR',  'NMAX',   2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-KA-YBR-GN',   'YBR 125',2010, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-BJ-XTZ125-OR','XTZ 125',2015, 2020, true,  'Catálogo de demostración (ficticio)', 'Solo hasta 2020 en este ejemplo'),
  ('DEMO-BJ-R15-GN',   'R15',    2017, 2024, false, NULL, 'Compatibilidad sin verificar: requiere asesor'),
  ('DEMO-LL-BWS-T-GN', 'BWS 125',2010, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-AC-20W50-OR', 'FZ 2.0', 2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-AC-20W50-OR', 'YBR 125',2010, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-AC-20W50-OR', 'XTZ 125',2015, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-BB-CRY-GN',   'Crypton',2012, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-PF-MT03-D-OR','MT-03',  2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL)
) AS v(ref, modelo, desde, hasta, verificada, fuente, notas)
JOIN productos p ON p.referencia = v.ref
JOIN modelos_motocicleta mo ON mo.nombre = v.modelo
ON CONFLICT DO NOTHING;

-- Movimiento inicial (entrada) para que la bitácora cuadre con el stock
INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, motivo)
SELECT i.producto_id, 'entrada', i.cantidad, 0, i.cantidad, 'Carga inicial de datos de demostración (ficticio)'
FROM inventario i JOIN productos p ON p.id = i.producto_id
WHERE p.es_demo AND i.cantidad > 0
  AND NOT EXISTS (SELECT 1 FROM movimientos_inventario mv WHERE mv.producto_id = i.producto_id);

COMMIT;
