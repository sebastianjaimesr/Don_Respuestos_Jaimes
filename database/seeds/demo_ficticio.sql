-- =====================================================================
-- DATOS DE DEMOSTRACIÓN — 100 % FICTICIOS
-- ---------------------------------------------------------------------
-- * Todas las referencias empiezan por "DEMO-" y tienen es_demo = true.
-- * Precios, existencias y compatibilidades son INVENTADOS para pruebas.
-- * NO representan el inventario real de Don Repuestos Jaimes.
-- * Los nombres de fabricantes y modelos de motos son reales, pero los
--   años y las compatibilidades aquí cargadas NO están verificados contra
--   catálogos de fábrica.
-- * Se puede ejecutar varias veces: no duplica nada.
-- Para borrarlos: ver database/seeds/borrar_demo.sql
-- Requiere las migraciones 001–010 (fabricantes y categorías ya existen).
-- =====================================================================

BEGIN;

-- Marcas de repuesto. Las "originales" son las del fabricante de la moto.
INSERT INTO marcas_repuesto (nombre, fabricante_moto_id, es_demo)
SELECT v.nombre, f.id, v.demo
FROM (VALUES
  ('Yamaha',              'Yamaha', false),
  ('Honda',               'Honda',  false),
  ('Genérica Demo A',     NULL,     true),
  ('Genérica Demo B',     NULL,     true),
  ('Alternativa Demo C',  NULL,     true)
) AS v(nombre, fabricante, demo)
LEFT JOIN fabricantes_moto f ON f.nombre = v.fabricante
ON CONFLICT (nombre) DO NOTHING;

INSERT INTO proveedores (nombre, ciudad, notas, es_demo) VALUES
  ('Proveedor Demo S.A.S.', 'Bogotá', 'Proveedor ficticio para pruebas', true)
ON CONFLICT (nombre) DO NOTHING;

-- Modelos: los años de producción se dejan NULL porque no están verificados.
INSERT INTO modelos_motocicleta (fabricante_id, nombre, cilindraje_cc, alias, tipo_moto, es_demo)
SELECT f.id, v.nombre, v.cc, v.alias, v.tipo, v.demo
FROM (VALUES
  ('Yamaha', 'FZ 2.0',          150, ARRAY['fz 2.0','fz2.0','fz 2','fz2','fz 150','fz150','fz'], 'calle', false),
  ('Yamaha', 'FZ 25',           250, ARRAY['fz 25','fz25','fz 250','fz250','fz'], 'calle', false),
  ('Yamaha', 'NMAX',            155, ARRAY['nmax','n max','nmax 155'], 'scooter', false),
  ('Yamaha', 'XTZ 125',         125, ARRAY['xtz 125','xtz125','xtz'], 'enduro', false),
  ('Yamaha', 'XTZ 150',         150, ARRAY['xtz 150','xtz150','xtz'], 'enduro', false),
  ('Yamaha', 'YBR 125',         125, ARRAY['ybr 125','ybr125','ybr'], 'calle', false),
  ('Yamaha', 'BWS 125',         125, ARRAY['bws','bws 125','bws125','biwis','bwis'], 'scooter', false),
  ('Yamaha', 'Crypton',         115, ARRAY['crypton','cripton','crypton fi'], 'calle', false),
  ('Yamaha', 'MT-03',           321, ARRAY['mt 03','mt03','mt 3','mt3'], 'deportiva', false),
  ('Yamaha', 'R15',             155, ARRAY['r15','r 15','r15 v3','r15 v4'], 'deportiva', false),
  ('Honda',  'CB 190R',         184, ARRAY['cb 190','cb190','cb 190r','cb190r'], 'calle', true),
  ('Bajaj',  'Pulsar NS 200',   199, ARRAY['ns 200','ns200','pulsar ns 200','pulsar ns'], 'calle', true),
  ('AKT',    'NKD 125',         125, ARRAY['nkd','nkd 125','nkd125'], 'calle', true),
  ('Suzuki', 'GN 125',          125, ARRAY['gn 125','gn125','gn'], 'calle', true),
  ('TVS',    'Apache RTR 160',  160, ARRAY['apache','apache 160','rtr 160','apache rtr'], 'calle', true)
) AS v(fabricante, nombre, cc, alias, tipo, demo)
JOIN fabricantes_moto f ON f.nombre = v.fabricante
ON CONFLICT (fabricante_id, nombre) DO NOTHING;

-- Productos ficticios
INSERT INTO productos (sku, referencia, nombre, descripcion, categoria_id, posicion, marca_id, tipo, precio, precio_compra, destacado, proveedor_id, es_demo)
SELECT v.sku, v.sku, v.nombre, v.descripcion, c.id, v.posicion, m.id, v.tipo, v.precio, v.costo, v.destacado,
       (SELECT id FROM proveedores WHERE nombre = 'Proveedor Demo S.A.S.'), true
FROM (VALUES
  ('DEMO-PF-FZ2-D-OR',  'Pastillas de freno delanteras', 'Juego de pastillas para freno de disco delantero.', 'pastillas_freno', 'delantero', 'Yamaha', 'original', 68000, 47000, true),
  ('DEMO-PF-FZ2-D-GN',  'Pastillas de freno delanteras', 'Alternativa genérica, compuesto semimetálico.',     'pastillas_freno', 'delantero', 'Genérica Demo A', 'generico', 32000, 19000, false),
  ('DEMO-PF-FZ2-T-OR',  'Pastillas de freno traseras',   'Juego de pastillas para freno de disco trasero.',   'pastillas_freno', 'trasero',   'Yamaha', 'original', 59000, NULL, false),
  ('DEMO-FA-FZ2-OR',    'Filtro de aceite',              'Filtro de aceite tipo cartucho.',                   'filtro_aceite',   NULL, 'Yamaha', 'original', 18000, NULL, false),
  ('DEMO-FA-FZ25-OR',   'Filtro de aceite',              'Filtro de aceite tipo cartucho.',                   'filtro_aceite',   NULL, 'Yamaha', 'original', 21000, NULL, false),
  ('DEMO-FAI-NMX-OR',   'Filtro de aire',                'Elemento filtrante de aire.',                       'filtro_aire',     NULL, 'Yamaha', 'original', NULL,  NULL, false),
  ('DEMO-KA-YBR-GN',    'Kit de arrastre',               'Piñón, corona y cadena.',                           'kit_arrastre',    NULL, 'Genérica Demo B', 'generico', 145000, 98000, true),
  ('DEMO-BJ-XTZ125-OR', 'Bujía',                         'Bujía estándar.',                                   'bujia',           NULL, 'Yamaha', 'original', 22000, NULL, false),
  ('DEMO-BJ-R15-GN',    'Bujía',                         'Bujía genérica de reemplazo.',                      'bujia',           NULL, 'Genérica Demo A', 'generico', 15000, NULL, false),
  ('DEMO-LL-BWS-T-GN',  'Llanta trasera',                'Llanta trasera para scooter.',                      'llanta',          'trasero', 'Genérica Demo B', 'generico', 120000, NULL, false),
  ('DEMO-AC-20W50-OR',  'Aceite de motor 4T 20W50 (1 L)','Aceite para motor 4 tiempos.',                      'aceite_motor',    NULL, 'Yamaha', 'original', 35000, 26000, true),
  ('DEMO-BB-CRY-GN',    'Bombillo de farola',            'Bombillo halógeno de farola.',                      'bombillo',        NULL, 'Genérica Demo A', 'generico', 9000, NULL, false),
  ('DEMO-PF-MT03-D-OR', 'Pastillas de freno delanteras', 'Juego de pastillas delanteras.',                    'pastillas_freno', 'delantero', 'Yamaha', 'original', 165000, NULL, false),
  -- Multimarca
  ('DEMO-PF-CB190-D-OR','Pastillas de freno delanteras', 'Juego de pastillas delanteras.',                    'pastillas_freno', 'delantero', 'Honda', 'original', 72000, NULL, true),
  ('DEMO-FAI-NS200-GN', 'Filtro de aire',                'Elemento filtrante de aire de reemplazo.',          'filtro_aire',     NULL, 'Genérica Demo A', 'generico', 28000, NULL, false),
  ('DEMO-CL-NKD125-AL', 'Discos de clutch',              'Juego de discos de clutch.',                        'clutch',          NULL, 'Alternativa Demo C', 'alternativo', 54000, NULL, false),
  ('DEMO-AM-GN125-GN',  'Amortiguador trasero',          'Par de amortiguadores traseros.',                   'amortiguador',    NULL, 'Genérica Demo B', 'generico', 160000, NULL, false),
  ('DEMO-BT-APACHE-GN', 'Batería 12V',                   'Batería sellada 12 V.',                             'bateria',         NULL, 'Genérica Demo A', 'generico', 115000, NULL, false)
) AS v(sku, nombre, descripcion, categoria, posicion, marca, tipo, precio, costo, destacado)
JOIN categorias c ON c.slug = v.categoria
JOIN marcas_repuesto m ON m.nombre = v.marca
ON CONFLICT DO NOTHING;

-- Inventario ficticio: se crea en 0 y las unidades entran con un movimiento
-- (así la bitácora cuadra con el stock y pasa por fn_mover_stock).
INSERT INTO inventario (producto_id, cantidad, stock_minimo, ubicacion, tiempo_abastecimiento_dias)
SELECT p.id, 0, v.minimo, v.ubicacion, v.dias
FROM (VALUES
  ('DEMO-PF-FZ2-D-OR',  2, 'Estante A1', NULL),
  ('DEMO-PF-FZ2-D-GN',  2, 'Estante A1', NULL),
  ('DEMO-PF-FZ2-T-OR',  2, 'Estante A2', NULL),
  ('DEMO-FA-FZ2-OR',    3, 'Estante B1', 5),      -- AGOTADO con abastecimiento conocido
  ('DEMO-FA-FZ25-OR',   3, 'Estante B1', NULL),
  ('DEMO-FAI-NMX-OR',   2, 'Estante B2', NULL),   -- precio faltante
  ('DEMO-KA-YBR-GN',    1, 'Bodega',     NULL),   -- última unidad
  ('DEMO-BJ-XTZ125-OR', 4, 'Cajón C3',   NULL),
  ('DEMO-BJ-R15-GN',    4, 'Cajón C3',   NULL),
  ('DEMO-LL-BWS-T-GN',  2, 'Bodega',     NULL),   -- stock bajo
  ('DEMO-AC-20W50-OR',  6, 'Vitrina',    NULL),
  ('DEMO-BB-CRY-GN',    4, 'Cajón D1',   NULL),
  ('DEMO-PF-MT03-D-OR', 1, 'Estante A3', NULL),
  ('DEMO-PF-CB190-D-OR',2, 'Estante A4', NULL),
  ('DEMO-FAI-NS200-GN', 2, 'Estante B3', NULL),
  ('DEMO-CL-NKD125-AL', 2, 'Cajón C4',   NULL),
  ('DEMO-AM-GN125-GN',  1, 'Bodega',     NULL),
  ('DEMO-BT-APACHE-GN', 2, 'Estante E1', NULL)
) AS v(sku, minimo, ubicacion, dias)
JOIN productos p ON p.sku = v.sku
ON CONFLICT (producto_id) DO NOTHING;

SELECT count(*) AS movimientos_iniciales FROM (
SELECT fn_mover_stock(p.id, 'entrada', v.cantidad, 'Carga inicial de datos de demostración (ficticio)')
FROM (VALUES
  ('DEMO-PF-FZ2-D-OR', 5), ('DEMO-PF-FZ2-D-GN', 3), ('DEMO-PF-FZ2-T-OR', 4), ('DEMO-FA-FZ25-OR', 7),
  ('DEMO-FAI-NMX-OR', 6), ('DEMO-KA-YBR-GN', 1), ('DEMO-BJ-XTZ125-OR', 10), ('DEMO-BJ-R15-GN', 8),
  ('DEMO-LL-BWS-T-GN', 2), ('DEMO-AC-20W50-OR', 20), ('DEMO-BB-CRY-GN', 12), ('DEMO-PF-MT03-D-OR', 2),
  ('DEMO-PF-CB190-D-OR', 4), ('DEMO-FAI-NS200-GN', 6), ('DEMO-CL-NKD125-AL', 3), ('DEMO-AM-GN125-GN', 2),
  ('DEMO-BT-APACHE-GN', 5)
) AS v(sku, cantidad)
JOIN productos p ON p.sku = v.sku
WHERE NOT EXISTS (SELECT 1 FROM movimientos_inventario mv WHERE mv.producto_id = p.id)
) AS cargados;

-- Compatibilidades ficticias
INSERT INTO compatibilidades (producto_id, modelo_id, anio_desde, anio_hasta, verificada, fuente, notas)
SELECT p.id, mo.id, v.desde, v.hasta, v.verificada, v.fuente, v.notas
FROM (VALUES
  ('DEMO-PF-FZ2-D-OR',  'Yamaha', 'FZ 2.0',  2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-PF-FZ2-D-GN',  'Yamaha', 'FZ 2.0',  2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-PF-FZ2-T-OR',  'Yamaha', 'FZ 2.0',  2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-FA-FZ2-OR',    'Yamaha', 'FZ 2.0',  2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-FA-FZ25-OR',   'Yamaha', 'FZ 25',   2017, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-FAI-NMX-OR',   'Yamaha', 'NMAX',    2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-KA-YBR-GN',    'Yamaha', 'YBR 125', 2010, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-BJ-XTZ125-OR', 'Yamaha', 'XTZ 125', 2015, 2020, true,  'Catálogo de demostración (ficticio)', 'Solo hasta 2020 en este ejemplo'),
  ('DEMO-BJ-R15-GN',    'Yamaha', 'R15',     2017, 2024, false, NULL, 'Compatibilidad sin verificar: requiere asesor'),
  ('DEMO-LL-BWS-T-GN',  'Yamaha', 'BWS 125', 2010, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-AC-20W50-OR',  'Yamaha', 'FZ 2.0',  2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-AC-20W50-OR',  'Yamaha', 'YBR 125', 2010, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-AC-20W50-OR',  'Yamaha', 'XTZ 125', 2015, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-BB-CRY-GN',    'Yamaha', 'Crypton', 2012, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-PF-MT03-D-OR', 'Yamaha', 'MT-03',   2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-PF-CB190-D-OR','Honda',  'CB 190R', 2016, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-FAI-NS200-GN', 'Bajaj',  'Pulsar NS 200', 2015, 2024, true, 'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-CL-NKD125-AL', 'AKT',    'NKD 125', 2012, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-AM-GN125-GN',  'Suzuki', 'GN 125',  2008, 2024, true,  'Catálogo de demostración (ficticio)', NULL),
  ('DEMO-BT-APACHE-GN', 'TVS',    'Apache RTR 160', 2018, 2024, true, 'Catálogo de demostración (ficticio)', NULL)
) AS v(sku, fabricante, modelo, desde, hasta, verificada, fuente, notas)
JOIN productos p ON p.sku = v.sku
JOIN fabricantes_moto f ON f.nombre = v.fabricante
JOIN modelos_motocicleta mo ON mo.fabricante_id = f.id AND mo.nombre = v.modelo
ON CONFLICT DO NOTHING;

COMMIT;
