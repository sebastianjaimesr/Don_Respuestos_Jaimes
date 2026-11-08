-- =====================================================================
-- 010 — Búsqueda de productos
-- Texto completo en español + trigramas (tolera errores de escritura).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- unaccent no es IMMUTABLE por sí sola; esta envoltura (diccionario fijo) sí, y se puede indexar.
CREATE OR REPLACE FUNCTION f_normalizar(t TEXT) RETURNS TEXT AS $$
  SELECT lower(unaccent('unaccent'::regdictionary, COALESCE(t, '')))
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;

ALTER TABLE productos ADD COLUMN busqueda tsvector;

CREATE OR REPLACE FUNCTION fn_productos_busqueda() RETURNS trigger AS $$
DECLARE
  cat_texto    TEXT;
  marca_texto  TEXT;
BEGIN
  SELECT c.nombre || ' ' || array_to_string(c.sinonimos, ' ') || ' ' || COALESCE(g.nombre, '')
    INTO cat_texto
    FROM categorias c LEFT JOIN categorias g ON g.id = c.padre_id
   WHERE c.id = NEW.categoria_id;
  SELECT nombre INTO marca_texto FROM marcas_repuesto WHERE id = NEW.marca_id;
  NEW.busqueda :=
       setweight(to_tsvector('spanish', f_normalizar(NEW.nombre)), 'A')
    || setweight(to_tsvector('simple', f_normalizar(NEW.sku || ' ' || COALESCE(NEW.referencia, '') || ' ' || COALESCE(NEW.codigo_barras, ''))), 'A')
    || setweight(to_tsvector('spanish', f_normalizar(cat_texto)), 'B')
    || setweight(to_tsvector('simple', f_normalizar(marca_texto)), 'B')
    || setweight(to_tsvector('spanish', f_normalizar(NEW.descripcion)), 'C');
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tg_productos_busqueda BEFORE INSERT OR UPDATE OF nombre, sku, referencia, codigo_barras, descripcion, categoria_id, marca_id
  ON productos FOR EACH ROW EXECUTE FUNCTION fn_productos_busqueda();

UPDATE productos SET nombre = nombre;  -- llena la columna para los productos existentes

CREATE INDEX ix_productos_busqueda ON productos USING GIN (busqueda);
CREATE INDEX ix_productos_nombre_trgm ON productos USING GIN (f_normalizar(nombre) gin_trgm_ops);
CREATE INDEX ix_productos_sku_trgm ON productos USING GIN (sku gin_trgm_ops);
CREATE INDEX ix_modelos_nombre_trgm ON modelos_motocicleta USING GIN (f_normalizar(nombre) gin_trgm_ops);
