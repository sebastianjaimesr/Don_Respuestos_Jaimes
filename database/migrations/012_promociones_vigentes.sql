-- =====================================================================
-- 012 · Precio vigente con promociones (fase 4C)
-- Una sola definición del precio que se cobra, para que el catálogo, el
-- carrito, el asistente y el pedido nunca muestren precios distintos.
-- * Solo productos con precio confirmado (sin precio no hay promoción).
-- * Promoción activa y dentro de sus fechas.
-- * Alcance: el producto, su categoría, el grupo de su categoría o su marca.
-- * Si varias aplican, gana la que deja el precio más bajo (nunca se suman).
-- * Un descuento que dejaría el precio en 0 o menos se ignora.
-- * Los porcentajes se redondean al peso.
-- =====================================================================

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
    SELECT pr.id AS promocion_id, pr.nombre AS promocion, pr.termina_at,
           (CASE WHEN pr.tipo_descuento = 'porcentaje' THEN round(p.precio * (1 - pr.valor / 100))
                 ELSE p.precio - pr.valor END)::numeric(14,2) AS precio_final
    FROM promociones pr
    WHERE p.precio IS NOT NULL AND pr.activo AND now() >= pr.inicia_at AND now() < pr.termina_at
      AND (pr.producto_id = p.id
           OR pr.marca_id = p.marca_id
           OR pr.categoria_id = p.categoria_id
           OR pr.categoria_id = (SELECT c.padre_id FROM categorias c WHERE c.id = p.categoria_id))
  ) x
  WHERE x.precio_final > 0
  ORDER BY x.precio_final, x.promocion_id
  LIMIT 1
) b ON true;

-- Imágenes: un solo registro por objeto del almacenamiento
CREATE UNIQUE INDEX IF NOT EXISTS uq_imagenes_clave ON producto_imagenes (clave_almacenamiento) WHERE clave_almacenamiento IS NOT NULL;
