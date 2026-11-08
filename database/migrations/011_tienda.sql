-- =====================================================================
-- 011 · Ajustes para la tienda en línea (fase 4B)
-- * Fecha de creación de la cuenta del cliente: el historial de la cuenta
--   solo muestra pedidos hechos desde entonces. Sin verificar el teléfono
--   por SMS no podemos saber si quien abre la cuenta es el dueño de ese
--   número, así que no exponemos compras anteriores hechas con él.
-- * Número de WhatsApp de ventas: lo confirma el dueño (no se inventa).
-- =====================================================================

ALTER TABLE clientes ADD COLUMN cuenta_creada_at TIMESTAMPTZ;
UPDATE clientes SET cuenta_creada_at = created_at WHERE password_hash IS NOT NULL;
ALTER TABLE clientes ADD CONSTRAINT ck_clientes_cuenta_fecha CHECK ((password_hash IS NULL) = (cuenta_creada_at IS NULL));

INSERT INTO configuracion_negocio (clave, valor, descripcion, confirmado) VALUES
  ('whatsapp_ventas', NULL, 'Número de WhatsApp que recibe los pedidos de la tienda (solo dígitos, con 57)', false)
ON CONFLICT (clave) DO NOTHING;

-- Búsqueda pública: el texto de categoría cambia → hay que reindexar sus productos.
CREATE OR REPLACE FUNCTION fn_categorias_reindexar() RETURNS trigger AS $$
BEGIN
  IF NEW.nombre IS DISTINCT FROM OLD.nombre OR NEW.sinonimos IS DISTINCT FROM OLD.sinonimos THEN
    UPDATE productos SET nombre = nombre
     WHERE categoria_id = NEW.id OR categoria_id IN (SELECT id FROM categorias WHERE padre_id = NEW.id);
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tg_categorias_reindexar AFTER UPDATE OF nombre, sinonimos ON categorias
  FOR EACH ROW EXECUTE FUNCTION fn_categorias_reindexar();

CREATE OR REPLACE FUNCTION fn_marcas_reindexar() RETURNS trigger AS $$
BEGIN
  IF NEW.nombre IS DISTINCT FROM OLD.nombre THEN
    UPDATE productos SET nombre = nombre WHERE marca_id = NEW.id;
  END IF;
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tg_marcas_reindexar AFTER UPDATE OF nombre ON marcas_repuesto
  FOR EACH ROW EXECUTE FUNCTION fn_marcas_reindexar();

-- Errores de digitación en la búsqueda pública ("bugia" → "bujía").
-- Los trigramas fallan con palabras cortas, así que se compara palabra por
-- palabra con distancia de Levenshtein: cada palabra buscada (de 4+ letras)
-- debe parecerse a alguna palabra del nombre (1 error hasta 6 letras, 2 desde 7).
CREATE EXTENSION IF NOT EXISTS fuzzystrmatch;
CREATE OR REPLACE FUNCTION f_coincide_aprox(consulta TEXT, texto TEXT) RETURNS BOOLEAN AS $$
  WITH q AS (SELECT DISTINCT w FROM unnest(regexp_split_to_array(f_normalizar(consulta), '[^a-z0-9]+')) w WHERE length(w) >= 4),
       t AS (SELECT DISTINCT w FROM unnest(regexp_split_to_array(f_normalizar(texto), '[^a-z0-9]+')) w WHERE length(w) >= 3)
  SELECT EXISTS (SELECT 1 FROM q)
     AND NOT EXISTS (
       SELECT 1 FROM q
        WHERE NOT EXISTS (SELECT 1 FROM t WHERE levenshtein(q.w, t.w) <= CASE WHEN length(q.w) <= 6 THEN 1 ELSE 2 END)
     );
$$ LANGUAGE sql IMMUTABLE PARALLEL SAFE;
