-- Elimina TODOS los datos de demostración (es_demo = true).
-- Úsalo antes de cargar el inventario real. Falla si algún producto
-- demo ya aparece en un pedido, cotización o compra (protección
-- intencional): en ese caso, desactiva el producto en lugar de borrarlo.
BEGIN;
DELETE FROM movimientos_inventario WHERE producto_id IN (SELECT id FROM productos WHERE es_demo);
DELETE FROM historial_precios WHERE producto_id IN (SELECT id FROM productos WHERE es_demo);
-- inventario, compatibilidades, imágenes, favoritos e ítems de carrito se borran en cascada
DELETE FROM productos WHERE es_demo;
DELETE FROM marcas_repuesto mr WHERE es_demo AND NOT EXISTS (SELECT 1 FROM productos p WHERE p.marca_id = mr.id);
DELETE FROM proveedores pr WHERE es_demo AND NOT EXISTS (SELECT 1 FROM productos p WHERE p.proveedor_id = pr.id)
  AND NOT EXISTS (SELECT 1 FROM compras c WHERE c.proveedor_id = pr.id);
DELETE FROM versiones_moto v WHERE es_demo AND NOT EXISTS (SELECT 1 FROM compatibilidades c WHERE c.version_id = v.id);
DELETE FROM modelos_motocicleta mo WHERE es_demo AND NOT EXISTS (SELECT 1 FROM compatibilidades c WHERE c.modelo_id = mo.id);
COMMIT;
