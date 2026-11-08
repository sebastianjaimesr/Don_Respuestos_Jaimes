-- =====================================================================
-- 006 — Roles y permisos
-- Los permisos los define el código; los roles y su matriz se pueden
-- ampliar desde el panel. Los tres roles iniciales conservan lo que cada
-- uno podía hacer antes de esta migración.
-- =====================================================================

CREATE TABLE roles (
  clave        VARCHAR(20) PRIMARY KEY CHECK (clave ~ '^[a-z_]+$'),
  nombre       VARCHAR(60) NOT NULL,
  descripcion  VARCHAR(200),
  es_sistema   BOOLEAN NOT NULL DEFAULT false,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
INSERT INTO roles (clave, nombre, descripcion, es_sistema) VALUES
  ('admin',    'Administrador', 'Control total del sistema', true),
  ('vendedor', 'Vendedor',      'Ventas, atención e inventario', true),
  ('consulta', 'Consulta',      'Solo lectura', true)
ON CONFLICT (clave) DO NOTHING;

CREATE TABLE permisos (
  clave        VARCHAR(40) PRIMARY KEY CHECK (clave ~ '^[a-z_]+\.[a-z_]+$'),
  descripcion  VARCHAR(200) NOT NULL
);
INSERT INTO permisos (clave, descripcion) VALUES
  ('catalogo.ver',            'Ver productos, categorías, marcas y motos'),
  ('inventario.ver',          'Ver existencias, movimientos y alertas'),
  ('ventas.ver',              'Ver cotizaciones y pedidos'),
  ('productos.editar',        'Crear y editar productos, categorías, marcas y motos'),
  ('compatibilidades.editar', 'Gestionar compatibilidades'),
  ('imagenes.editar',         'Subir y ordenar imágenes de productos'),
  ('precios.editar',          'Cambiar precios de venta y de compra'),
  ('precios.masivo',          'Actualizar precios de forma masiva'),
  ('inventario.mover',        'Registrar entradas, salidas y ajustes de stock'),
  ('compras.gestionar',       'Registrar y recibir compras a proveedores'),
  ('importaciones.aplicar',   'Importar catálogos, precios y existencias'),
  ('exportaciones.descargar', 'Exportar el inventario'),
  ('pedidos.gestionar',       'Cambiar el estado de pedidos y registrar pagos'),
  ('atencion.gestionar',      'Atender conversaciones transferidas'),
  ('configuracion.editar',    'Editar datos del negocio, envíos y promociones'),
  ('usuarios.gestionar',      'Crear usuarios y asignar roles'),
  ('auditoria.ver',           'Ver la auditoría y el registro de eventos')
ON CONFLICT (clave) DO NOTHING;

CREATE TABLE rol_permisos (
  rol      VARCHAR(20) NOT NULL REFERENCES roles (clave) ON UPDATE CASCADE ON DELETE CASCADE,
  permiso  VARCHAR(40) NOT NULL REFERENCES permisos (clave) ON DELETE CASCADE,
  PRIMARY KEY (rol, permiso)
);
INSERT INTO rol_permisos (rol, permiso)
SELECT 'admin', clave FROM permisos
UNION ALL
SELECT 'vendedor', unnest(ARRAY['catalogo.ver','inventario.ver','ventas.ver','inventario.mover','compras.gestionar','pedidos.gestionar','atencion.gestionar'])
UNION ALL
SELECT 'consulta', unnest(ARRAY['catalogo.ver','inventario.ver','ventas.ver'])
ON CONFLICT DO NOTHING;

ALTER TABLE asesores DROP CONSTRAINT asesores_rol_check;
ALTER TABLE asesores ALTER COLUMN rol TYPE VARCHAR(20);
ALTER TABLE asesores ADD CONSTRAINT fk_asesores_rol FOREIGN KEY (rol) REFERENCES roles (clave) ON UPDATE CASCADE ON DELETE RESTRICT;

CREATE TRIGGER tg_aud_rol_permisos AFTER INSERT OR DELETE ON rol_permisos FOR EACH ROW EXECUTE FUNCTION fn_auditar('rol');
