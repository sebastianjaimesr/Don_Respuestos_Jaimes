-- =====================================================================
-- 014 · Rendimiento de la búsqueda (fase 8)
-- Medido con 50.000 productos sintéticos (database/benchmarks/): el
-- catálogo tardaba entre 0,6 y 1,9 s por búsqueda. La meta es < 150 ms
-- (docs/ARQUITECTURA.md § 7).
-- =====================================================================

-- 1) Precio vigente: las promociones activas se leen UNA vez por consulta
--    (una subconsulta sin correlación se evalúa una sola vez) en lugar de
--    buscar en `promociones` por cada producto. Mismas reglas y columnas
--    que la 012, y la vista se sigue "aplanando" (los filtros por producto
--    se aplican antes de calcular el precio).
CREATE OR REPLACE VIEW v_precio_vigente AS
SELECT p.id AS producto_id,
       p.precio AS precio_lista,
       COALESCE(b.precio_final, p.precio) AS precio,
       b.promocion_id,
       b.promocion,
       b.termina_at AS promocion_termina_at
FROM productos p
LEFT JOIN LATERAL (
  SELECT x.* FROM (
    SELECT v.id AS promocion_id, v.nombre AS promocion, v.termina_at,
           (CASE WHEN v.tipo_descuento = 'porcentaje' THEN round(p.precio * (1 - v.valor / 100))
                 ELSE p.precio - v.valor END)::numeric(14,2) AS precio_final
    FROM unnest((SELECT array_agg(pr) FROM promociones pr
                 WHERE pr.activo AND now() >= pr.inicia_at AND now() < pr.termina_at)) AS v
    WHERE p.precio IS NOT NULL
      AND (v.producto_id = p.id
           OR v.marca_id = p.marca_id
           OR v.categoria_id = p.categoria_id
           OR v.categoria_id = (SELECT c.padre_id FROM categorias c WHERE c.id = p.categoria_id))
  ) x
  WHERE x.precio_final > 0
  ORDER BY x.precio_final, x.promocion_id
  LIMIT 1
) b ON true;

-- 2) Orden por defecto del catálogo (destacados primero, luego con precio, luego nombre).
CREATE INDEX IF NOT EXISTS ix_productos_orden_catalogo ON productos (destacado DESC, (precio IS NULL), nombre, id) WHERE activo;

-- 3) Tolerancia a errores de escritura ("pastiyas", "bugia") sin recorrer
--    todo el catálogo. Antes f_coincide_aprox calculaba la distancia de
--    Levenshtein contra el nombre de CADA producto (≈1,7 s con 50.000).
--    Ahora se compara la consulta contra el vocabulario de palabras de los
--    nombres (unos pocos miles) y se busca con un índice.
CREATE TABLE IF NOT EXISTS palabras_catalogo (palabra TEXT PRIMARY KEY);

CREATE OR REPLACE FUNCTION fn_palabras_catalogo() RETURNS trigger AS $$
BEGIN
  INSERT INTO palabras_catalogo (palabra)
  SELECT DISTINCT w FROM unnest(regexp_split_to_array(f_normalizar(NEW.nombre), '[^a-z0-9]+')) w
  WHERE length(w) >= 3
  ON CONFLICT DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS tg_productos_palabras ON productos;
CREATE TRIGGER tg_productos_palabras AFTER INSERT OR UPDATE OF nombre ON productos
  FOR EACH ROW EXECUTE FUNCTION fn_palabras_catalogo();

INSERT INTO palabras_catalogo (palabra)
SELECT DISTINCT w FROM productos p, unnest(regexp_split_to_array(f_normalizar(p.nombre), '[^a-z0-9]+')) w
WHERE length(w) >= 3
ON CONFLICT DO NOTHING;

-- Misma regla que f_coincide_aprox (011): cada palabra de 4 o más letras de la
-- consulta debe parecerse (1 letra de diferencia hasta 6 letras, 2 si es más
-- larga) a alguna palabra del nombre. Devuelve NULL si no hay palabras útiles
-- o si alguna no se parece a nada del catálogo.
CREATE OR REPLACE FUNCTION f_consulta_aprox(consulta TEXT) RETURNS tsquery AS $$
  WITH q AS (
    SELECT DISTINCT w FROM unnest(regexp_split_to_array(f_normalizar(consulta), '[^a-z0-9]+')) w WHERE length(w) >= 4
  ), cand AS (
    SELECT q.w, string_agg(quote_literal(v.palabra), ' | ') AS alternativas
    FROM q JOIN palabras_catalogo v
      ON abs(length(v.palabra) - length(q.w)) <= 2
     AND levenshtein(q.w, v.palabra) <= CASE WHEN length(q.w) <= 6 THEN 1 ELSE 2 END
    GROUP BY q.w
  )
  SELECT CASE
    WHEN NOT EXISTS (SELECT 1 FROM q) OR (SELECT count(*) FROM cand) < (SELECT count(*) FROM q) THEN NULL
    ELSE to_tsquery('simple', (SELECT string_agg('(' || alternativas || ')', ' & ') FROM cand))
  END
$$ LANGUAGE sql STABLE PARALLEL SAFE;

CREATE INDEX IF NOT EXISTS ix_productos_nombre_simple ON productos USING GIN (to_tsvector('simple', f_normalizar(nombre)));

-- 4) Orden y filtro por precio cuando no hay promociones vigentes (el backend lo decide).
CREATE INDEX IF NOT EXISTS ix_productos_precio ON productos (precio, nombre, id) WHERE activo;

-- 5) Umbral del operador <% (parecido de palabras) igual al que se usaba con
--    word_similarity(...) > 0.45. El backend también lo fija al abrir cada conexión;
--    esto lo deja como valor por defecto de la base (si el usuario tiene permiso).
DO $$
BEGIN
  EXECUTE format('ALTER DATABASE %I SET pg_trgm.word_similarity_threshold = 0.45', current_database());
EXCEPTION WHEN insufficient_privilege THEN
  RAISE NOTICE 'Sin permiso para ALTER DATABASE: el umbral lo fija el backend en cada conexión';
END $$;
