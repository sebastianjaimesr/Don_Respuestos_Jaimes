-- =====================================================================
-- 003 — Catálogo multimarca
-- * Fabricantes de motos, modelos ligados a su fabricante y versiones.
-- * Categorías administrables en árbol (Frenos › Pastillas…) con sinónimos.
-- * Marcas de repuesto: "original" ya no es un tipo de marca sino la marca
--   del propio fabricante de la moto (Yamaha, Honda…).
-- * Productos: SKU, código de barras, precio de compra, margen, proveedor,
--   especificaciones, destacado y tipo "alternativo".
-- * Compatibilidad por versión (opcional).
-- Los datos existentes se conservan y se transforman.
-- =====================================================================

-- ---------------------------------------------------------------------
-- Fabricantes de motos
-- ---------------------------------------------------------------------
CREATE TABLE fabricantes_moto (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(60) NOT NULL,
  slug        VARCHAR(60) NOT NULL,
  alias       TEXT[] NOT NULL DEFAULT '{}',
  logo_url    VARCHAR(600),
  orden       SMALLINT NOT NULL DEFAULT 100,
  activo      BOOLEAN NOT NULL DEFAULT true,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_fabricantes_nombre UNIQUE (nombre),
  CONSTRAINT uq_fabricantes_slug UNIQUE (slug),
  CONSTRAINT ck_fabricantes_slug CHECK (slug ~ '^[a-z0-9-]+$')
);

INSERT INTO fabricantes_moto (nombre, slug, alias, orden) VALUES
  ('Yamaha',        'yamaha',        '{}', 1),
  ('Honda',         'honda',         '{}', 2),
  ('Suzuki',        'suzuki',        '{}', 3),
  ('Bajaj',         'bajaj',         '{}', 4),
  ('AKT',           'akt',           ARRAY['ak t','akt motos'], 5),
  ('TVS',           'tvs',           '{}', 6),
  ('Hero',          'hero',          ARRAY['hero motocorp'], 7),
  ('Kawasaki',      'kawasaki',      '{}', 8),
  ('KTM',           'ktm',           '{}', 9),
  ('BMW Motorrad',  'bmw-motorrad',  ARRAY['bmw'], 10),
  ('Kymco',         'kymco',         '{}', 11),
  ('Royal Enfield', 'royal-enfield', ARRAY['royal'], 12),
  ('Victory',       'victory',       '{}', 13)
ON CONFLICT DO NOTHING;

-- Cualquier fabricante que ya existiera como texto en los modelos
INSERT INTO fabricantes_moto (nombre, slug)
SELECT DISTINCT m.fabricante, trim(both '-' from regexp_replace(lower(unaccent(m.fabricante)), '[^a-z0-9]+', '-', 'g'))
FROM modelos_motocicleta m
ON CONFLICT DO NOTHING;

-- ---------------------------------------------------------------------
-- Modelos: fabricante pasa de texto a FK
-- ---------------------------------------------------------------------
ALTER TABLE modelos_motocicleta ADD COLUMN fabricante_id INTEGER REFERENCES fabricantes_moto (id) ON DELETE RESTRICT;
UPDATE modelos_motocicleta m SET fabricante_id = f.id FROM fabricantes_moto f WHERE f.nombre = m.fabricante;
ALTER TABLE modelos_motocicleta ALTER COLUMN fabricante_id SET NOT NULL;
ALTER TABLE modelos_motocicleta DROP CONSTRAINT uq_modelo_fabricante_nombre;
ALTER TABLE modelos_motocicleta DROP COLUMN fabricante;
ALTER TABLE modelos_motocicleta ADD CONSTRAINT uq_modelo_fabricante_nombre UNIQUE (fabricante_id, nombre);
ALTER TABLE modelos_motocicleta ADD COLUMN tipo_moto VARCHAR(12)
  CHECK (tipo_moto IN ('calle', 'scooter', 'enduro', 'deportiva', 'touring', 'otro'));
CREATE INDEX ix_modelos_fabricante ON modelos_motocicleta (fabricante_id) WHERE activo;

-- ---------------------------------------------------------------------
-- Versiones de un modelo (cuando cambian piezas entre variantes)
-- ---------------------------------------------------------------------
CREATE TABLE versiones_moto (
  id             SERIAL PRIMARY KEY,
  modelo_id      INTEGER NOT NULL REFERENCES modelos_motocicleta (id) ON DELETE CASCADE,
  nombre         VARCHAR(60) NOT NULL,
  cilindraje_cc  INTEGER CHECK (cilindraje_cc IS NULL OR cilindraje_cc > 0),
  anio_desde     SMALLINT CHECK (anio_desde IS NULL OR anio_desde BETWEEN 1950 AND 2100),
  anio_hasta     SMALLINT CHECK (anio_hasta IS NULL OR anio_hasta BETWEEN 1950 AND 2100),
  alias          TEXT[] NOT NULL DEFAULT '{}',
  activo         BOOLEAN NOT NULL DEFAULT true,
  es_demo        BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_version_modelo_nombre UNIQUE (modelo_id, nombre),
  CONSTRAINT uq_version_id_modelo UNIQUE (id, modelo_id),
  CONSTRAINT ck_version_anios CHECK (anio_desde IS NULL OR anio_hasta IS NULL OR anio_desde <= anio_hasta)
);

-- ---------------------------------------------------------------------
-- Categorías en árbol (dos niveles: grupo › categoría)
-- Los productos se asignan a categorías hoja. Si el cliente nombra un grupo
-- ("los frenos"), el asistente pregunta cuál de sus categorías necesita.
-- sinonimos: normalizados (minúsculas, sin tildes).
-- ---------------------------------------------------------------------
CREATE TABLE categorias (
  id                 SERIAL PRIMARY KEY,
  padre_id           INTEGER REFERENCES categorias (id) ON DELETE RESTRICT,
  slug               VARCHAR(40) NOT NULL,
  nombre             VARCHAR(80) NOT NULL,
  descripcion        TEXT,
  sinonimos          TEXT[] NOT NULL DEFAULT '{}',
  requiere_posicion  BOOLEAN NOT NULL DEFAULT false,
  es_seguridad       BOOLEAN NOT NULL DEFAULT false,
  es_mantenimiento   BOOLEAN NOT NULL DEFAULT false,
  icono              VARCHAR(40),
  orden              SMALLINT NOT NULL DEFAULT 100,
  activo             BOOLEAN NOT NULL DEFAULT true,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_categorias_slug UNIQUE (slug),
  CONSTRAINT ck_categorias_slug CHECK (slug ~ '^[a-z0-9_]+$'),
  CONSTRAINT ck_categorias_padre CHECK (padre_id IS NULL OR padre_id <> id)
);
CREATE INDEX ix_categorias_padre ON categorias (padre_id, orden) WHERE activo;
CREATE TRIGGER tg_categorias_updated BEFORE UPDATE ON categorias
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

-- Grupos
INSERT INTO categorias (slug, nombre, sinonimos, icono, orden) VALUES
  ('motor',         'Motor',              ARRAY['motor','repuestos de motor','partes de motor'], 'motor', 1),
  ('frenos',        'Frenos',             ARRAY['freno','frenos','frenar','frene','frena','sistema de frenos'], 'frenos', 2),
  ('transmision',   'Transmisión',        ARRAY['transmision','sistema de transmision'], 'transmision', 3),
  ('suspension',    'Suspensión',         ARRAY['suspension'], 'suspension', 4),
  ('electrico',     'Sistema eléctrico',  ARRAY['sistema electrico','parte electrica','electrico','electricos'], 'electrico', 5),
  ('lubricantes',   'Lubricantes',        ARRAY['lubricantes','lubricante','lubricacion'], 'lubricantes', 6),
  ('filtros',       'Filtros',            ARRAY['filtro','filtros'], 'filtros', 7),
  ('llantas_rines', 'Llantas y rines',    '{}', 'llantas', 8),
  ('chasis',        'Chasis y dirección', ARRAY['chasis'], 'chasis', 9),
  ('accesorios',    'Accesorios',         ARRAY['accesorio','accesorios'], 'accesorios', 10)
ON CONFLICT (slug) DO NOTHING;

-- Categorías hoja (las 12 claves que ya usaba el sistema conservan su slug)
INSERT INTO categorias (padre_id, slug, nombre, sinonimos, requiere_posicion, es_seguridad, es_mantenimiento, orden)
SELECT g.id, v.slug, v.nombre, v.sinonimos, v.pos, v.seg, v.mant, v.orden
FROM (VALUES
  ('frenos',        'pastillas_freno',  'Pastillas de freno',        ARRAY['pastillas de freno','pastilla de freno','pastillas','pastilla','balatas'], true,  true,  true,  1),
  ('frenos',        'bandas_freno',     'Bandas de freno',           ARRAY['bandas de freno','banda de freno','bandas','zapatas'], true,  true,  true,  2),
  ('frenos',        'disco_freno',      'Disco de freno',            ARRAY['disco de freno','disco freno','disco'], true,  true,  false, 3),
  ('motor',         'kit_piston',       'Kit de pistón',             ARRAY['kit de piston','piston','pistones','anillos','kit de cilindro','cilindro'], false, false, false, 1),
  ('motor',         'empaques_motor',   'Empaques de motor',         ARRAY['empaques','empaque','juego de empaques','empaquetadura'], false, false, false, 2),
  ('motor',         'cadenilla',        'Cadenilla de distribución', ARRAY['cadenilla','cadena de distribucion','tensor de cadenilla'], false, false, false, 3),
  ('motor',         'valvulas',         'Válvulas',                  ARRAY['valvula','valvulas'], false, false, false, 4),
  ('transmision',   'kit_arrastre',     'Kit de arrastre',           ARRAY['kit de arrastre','kit arrastre','arrastre','pinon y corona','kit de cadena','cadena y pinon'], false, false, true, 1),
  ('transmision',   'clutch',           'Discos de clutch',          ARRAY['clutch','discos de clutch','embrague','discos de embrague','croche'], false, false, false, 2),
  ('transmision',   'guaya_clutch',     'Guaya de clutch',           ARRAY['guaya de clutch','guaya del clutch','cable de clutch','guaya clutch'], false, false, false, 3),
  ('suspension',    'amortiguador',     'Amortiguadores',            ARRAY['amortiguador','amortiguadores','monoshock','mono shock'], false, false, false, 1),
  ('suspension',    'retenedores',      'Retenedores de barras',     ARRAY['retenedores','retenedor','retenes de barra','sellos de barra'], false, false, false, 2),
  ('electrico',     'bujia',            'Bujía',                     ARRAY['bujia','bujias'], false, false, true, 1),
  ('electrico',     'bateria',          'Batería',                   ARRAY['bateria','baterias','pila de la moto'], false, false, false, 2),
  ('electrico',     'bombillo',         'Bombillo',                  ARRAY['bombillo','bombillos','bombilla','luz de farola','bombillo farola'], false, false, false, 3),
  ('electrico',     'regulador',        'Regulador de voltaje',      ARRAY['regulador','regulador de voltaje','rectificador'], false, false, false, 4),
  ('lubricantes',   'aceite_motor',     'Aceite de motor',           ARRAY['aceite de motor','aceite motor','aceite 4t','aceite'], false, false, true, 1),
  ('lubricantes',   'liquido_frenos',   'Líquido de frenos',         ARRAY['liquido de frenos','liquido de freno','dot 4','dot 3'], false, true, true, 2),
  ('lubricantes',   'lubricante_cadena','Lubricante de cadena',      ARRAY['lubricante de cadena','grasa de cadena','spray de cadena'], false, false, true, 3),
  ('filtros',       'filtro_aire',      'Filtro de aire',            ARRAY['filtro de aire','filtro aire'], false, false, true, 1),
  ('filtros',       'filtro_aceite',    'Filtro de aceite',          ARRAY['filtro de aceite','filtro aceite'], false, false, true, 2),
  ('filtros',       'filtro_gasolina',  'Filtro de gasolina',        ARRAY['filtro de gasolina','filtro gasolina','filtro de combustible'], false, false, false, 3),
  ('llantas_rines', 'llanta',           'Llanta',                    ARRAY['llanta','llantas','neumatico','neumaticos','caucho'], true, true, false, 1),
  ('llantas_rines', 'camara',           'Cámara de llanta',          ARRAY['camara','camara de llanta','neumatico interior'], true, false, false, 2),
  ('chasis',        'direccion',        'Rodamientos de dirección',  ARRAY['cunas de direccion','cuna de direccion','rodamientos de direccion','direccion'], false, true, false, 1),
  ('accesorios',    'espejos',          'Espejos',                   ARRAY['espejo','espejos','retrovisor','retrovisores'], false, false, false, 1),
  ('accesorios',    'baul',             'Baúl',                      ARRAY['baul','maletero','top case'], false, false, false, 2)
) AS v(grupo, slug, nombre, sinonimos, pos, seg, mant, orden)
JOIN categorias g ON g.slug = v.grupo
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------
-- Proveedores
-- ---------------------------------------------------------------------
CREATE TABLE proveedores (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(120) NOT NULL,
  nit         VARCHAR(20),
  contacto    VARCHAR(120),
  telefono    VARCHAR(20),
  email       VARCHAR(160),
  ciudad      VARCHAR(80),
  notas       TEXT,
  activo      BOOLEAN NOT NULL DEFAULT true,
  es_demo     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_proveedores_nombre UNIQUE (nombre)
);
CREATE UNIQUE INDEX uq_proveedores_nit ON proveedores (nit) WHERE nit IS NOT NULL;
CREATE TRIGGER tg_proveedores_updated BEFORE UPDATE ON proveedores
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

-- ---------------------------------------------------------------------
-- Marcas de repuesto
-- "original" = la marca es la del fabricante de la moto (fabricante_moto_id).
-- ---------------------------------------------------------------------
ALTER TABLE productos DROP CONSTRAINT fk_productos_marca_tipo;
ALTER TABLE marcas RENAME TO marcas_repuesto;
ALTER TABLE marcas_repuesto DROP CONSTRAINT uq_marcas_id_tipo;
ALTER TABLE marcas_repuesto ADD COLUMN fabricante_moto_id INTEGER REFERENCES fabricantes_moto (id) ON DELETE RESTRICT;
ALTER TABLE marcas_repuesto ADD COLUMN activo BOOLEAN NOT NULL DEFAULT true;

-- Una marca que era "original" corresponde a un fabricante de motos
INSERT INTO fabricantes_moto (nombre, slug)
SELECT m.nombre, trim(both '-' from regexp_replace(lower(unaccent(m.nombre)), '[^a-z0-9]+', '-', 'g'))
FROM marcas_repuesto m
WHERE m.tipo = 'original' AND NOT EXISTS (SELECT 1 FROM fabricantes_moto f WHERE lower(f.nombre) = lower(m.nombre))
ON CONFLICT DO NOTHING;
UPDATE marcas_repuesto m SET fabricante_moto_id = f.id
FROM fabricantes_moto f WHERE m.tipo = 'original' AND lower(f.nombre) = lower(m.nombre);
ALTER TABLE marcas_repuesto DROP COLUMN tipo;
CREATE UNIQUE INDEX uq_marcas_fabricante ON marcas_repuesto (fabricante_moto_id) WHERE fabricante_moto_id IS NOT NULL;

ALTER TABLE productos ADD CONSTRAINT fk_productos_marca FOREIGN KEY (marca_id) REFERENCES marcas_repuesto (id) ON DELETE RESTRICT;

-- ---------------------------------------------------------------------
-- Productos
-- ---------------------------------------------------------------------
-- Tipo: original | generico | alternativo (también en los detalles de venta)
ALTER TABLE productos ALTER COLUMN tipo TYPE VARCHAR(12);
ALTER TABLE detalle_cotizacion ALTER COLUMN tipo TYPE VARCHAR(12);
ALTER TABLE detalle_pedido ALTER COLUMN tipo TYPE VARCHAR(12);
ALTER TABLE productos DROP CONSTRAINT productos_tipo_check;
ALTER TABLE productos ADD CONSTRAINT ck_productos_tipo CHECK (tipo IN ('original', 'generico', 'alternativo'));
ALTER TABLE detalle_cotizacion DROP CONSTRAINT detalle_cotizacion_tipo_check;
ALTER TABLE detalle_cotizacion ADD CONSTRAINT ck_detcot_tipo CHECK (tipo IN ('original', 'generico', 'alternativo'));
ALTER TABLE detalle_pedido DROP CONSTRAINT detalle_pedido_tipo_check;
ALTER TABLE detalle_pedido ADD CONSTRAINT ck_detped_tipo CHECK (tipo IN ('original', 'generico', 'alternativo'));

-- Categoría: de texto a FK
ALTER TABLE productos ADD COLUMN categoria_id INTEGER REFERENCES categorias (id) ON DELETE RESTRICT;
INSERT INTO categorias (slug, nombre)
SELECT DISTINCT p.categoria, initcap(replace(p.categoria, '_', ' '))
FROM productos p WHERE NOT EXISTS (SELECT 1 FROM categorias c WHERE c.slug = p.categoria)
ON CONFLICT (slug) DO NOTHING;
UPDATE productos p SET categoria_id = c.id FROM categorias c WHERE c.slug = p.categoria;
ALTER TABLE productos ALTER COLUMN categoria_id SET NOT NULL;
DROP INDEX ix_productos_categoria;
ALTER TABLE productos DROP CONSTRAINT ck_productos_categoria;
ALTER TABLE productos DROP COLUMN categoria;
CREATE INDEX ix_productos_categoria ON productos (categoria_id, posicion) WHERE activo;

-- SKU (código interno único) y referencia (número de parte del fabricante)
ALTER TABLE productos ADD COLUMN sku VARCHAR(60);
UPDATE productos SET sku = upper(regexp_replace(btrim(referencia), '\s+', '-', 'g'));
ALTER TABLE productos ALTER COLUMN sku SET NOT NULL;
ALTER TABLE productos ADD CONSTRAINT ck_productos_sku CHECK (sku ~ '^[A-Z0-9][A-Z0-9._-]*$');
CREATE UNIQUE INDEX uq_productos_sku ON productos (sku);
DROP INDEX uq_productos_referencia;
ALTER TABLE productos ALTER COLUMN referencia DROP NOT NULL;
CREATE INDEX ix_productos_referencia ON productos (upper(btrim(referencia)));

ALTER TABLE productos
  ADD COLUMN codigo_barras    VARCHAR(40) CHECK (codigo_barras IS NULL OR codigo_barras ~ '^[0-9A-Za-z-]{4,40}$'),
  ADD COLUMN slug             VARCHAR(200),
  ADD COLUMN precio_compra    NUMERIC(14,2) CHECK (precio_compra IS NULL OR precio_compra >= 0),
  ADD COLUMN especificaciones JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(especificaciones) = 'object'),
  ADD COLUMN destacado        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN proveedor_id     INTEGER REFERENCES proveedores (id) ON DELETE SET NULL;
-- Margen de utilidad (%) calculado por la base de datos
ALTER TABLE productos ADD COLUMN margen NUMERIC GENERATED ALWAYS AS (
  CASE WHEN precio IS NOT NULL AND precio_compra IS NOT NULL THEN round((precio - precio_compra) / precio * 100, 2) END
) STORED;
CREATE UNIQUE INDEX uq_productos_codigo_barras ON productos (codigo_barras) WHERE codigo_barras IS NOT NULL;

UPDATE productos SET slug = trim(both '-' from regexp_replace(lower(unaccent(nombre || ' ' || sku)), '[^a-z0-9]+', '-', 'g'));
ALTER TABLE productos ALTER COLUMN slug SET NOT NULL;
ALTER TABLE productos ADD CONSTRAINT ck_productos_slug CHECK (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$');
CREATE UNIQUE INDEX uq_productos_slug ON productos (slug);
CREATE INDEX ix_productos_destacados ON productos (destacado) WHERE activo AND destacado;

-- Si no se envían, el SKU sale de la referencia y el slug del nombre + SKU.
CREATE OR REPLACE FUNCTION fn_productos_identificadores() RETURNS trigger AS $$
BEGIN
  IF NEW.sku IS NULL AND NEW.referencia IS NOT NULL THEN
    NEW.sku := upper(regexp_replace(btrim(NEW.referencia), '\s+', '-', 'g'));
  END IF;
  IF NEW.slug IS NULL THEN
    NEW.slug := trim(both '-' from regexp_replace(lower(unaccent(NEW.nombre || ' ' || COALESCE(NEW.sku, ''))), '[^a-z0-9]+', '-', 'g'));
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- El prefijo "a_" la hace correr antes que los demás BEFORE (PostgreSQL los ordena por nombre).
CREATE TRIGGER a_tg_productos_identificadores BEFORE INSERT ON productos
  FOR EACH ROW EXECUTE FUNCTION fn_productos_identificadores();

-- Regla: un producto es "original" si y solo si su marca es la del fabricante de una moto.
CREATE OR REPLACE FUNCTION fn_validar_tipo_producto() RETURNS trigger AS $$
DECLARE
  es_oem BOOLEAN;
BEGIN
  SELECT fabricante_moto_id IS NOT NULL INTO es_oem FROM marcas_repuesto WHERE id = NEW.marca_id;
  IF NEW.tipo = 'original' AND NOT COALESCE(es_oem, false) THEN
    RAISE EXCEPTION 'Un repuesto original debe ser de la marca de un fabricante de motos'
      USING ERRCODE = '23514', CONSTRAINT = 'ck_producto_original_oem';
  END IF;
  IF NEW.tipo <> 'original' AND COALESCE(es_oem, false) THEN
    RAISE EXCEPTION 'Un repuesto de la marca de un fabricante de motos es original'
      USING ERRCODE = '23514', CONSTRAINT = 'ck_producto_original_oem';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tg_productos_tipo BEFORE INSERT OR UPDATE OF tipo, marca_id ON productos
  FOR EACH ROW EXECUTE FUNCTION fn_validar_tipo_producto();

-- Si una marca cambia entre OEM y no OEM, sus productos quedarían con el tipo equivocado.
CREATE OR REPLACE FUNCTION fn_validar_cambio_marca() RETURNS trigger AS $$
BEGIN
  IF (OLD.fabricante_moto_id IS NULL) <> (NEW.fabricante_moto_id IS NULL)
     AND EXISTS (SELECT 1 FROM productos WHERE marca_id = NEW.id) THEN
    RAISE EXCEPTION 'La marca ya tiene productos: no puede pasar de original a no original (ni al revés)'
      USING ERRCODE = '23514', CONSTRAINT = 'ck_marca_con_productos';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tg_marcas_fabricante BEFORE UPDATE OF fabricante_moto_id ON marcas_repuesto
  FOR EACH ROW EXECUTE FUNCTION fn_validar_cambio_marca();

-- ---------------------------------------------------------------------
-- Compatibilidades: versión opcional (NULL = todas las versiones del modelo)
-- ---------------------------------------------------------------------
ALTER TABLE compatibilidades ADD COLUMN version_id INTEGER;
ALTER TABLE compatibilidades ADD CONSTRAINT fk_compat_version
  FOREIGN KEY (version_id, modelo_id) REFERENCES versiones_moto (id, modelo_id) ON DELETE RESTRICT;
ALTER TABLE compatibilidades DROP CONSTRAINT uq_compat;
CREATE UNIQUE INDEX uq_compat ON compatibilidades (producto_id, modelo_id, COALESCE(version_id, 0), anio_desde, anio_hasta);
