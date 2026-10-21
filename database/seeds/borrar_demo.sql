-- Elimina TODOS los datos de demostración (es_demo = true).
-- Úsalo antes de cargar el inventario real. Falla si algún producto
-- demo ya aparece en un pedido o cotización (protección intencional):
-- en ese caso, desactiva el producto en lugar de borrarlo.
BEGIN;
DELETE FROM movimientos_inventario WHERE producto_id IN (SELECT id FROM productos WHERE es_demo);
DELETE FROM productos WHERE es_demo;  -- inventario y compatibilidades se borran en cascada
DELETE FROM marcas WHERE es_demo AND NOT EXISTS (SELECT 1 FROM productos p WHERE p.marca_id = marcas.id);
COMMIT;
