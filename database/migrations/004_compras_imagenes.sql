-- =====================================================================
-- 004 — Compras a proveedores e imágenes de productos
-- =====================================================================

CREATE SEQUENCE seq_codigo_compra START 1;
CREATE TABLE compras (
  id                 SERIAL PRIMARY KEY,
  codigo             VARCHAR(20) NOT NULL UNIQUE
                     DEFAULT 'COMP-' || lpad(nextval('seq_codigo_compra')::text, 6, '0'),
  proveedor_id       INTEGER NOT NULL REFERENCES proveedores (id) ON DELETE RESTRICT,
  estado             VARCHAR(10) NOT NULL DEFAULT 'borrador' CHECK (estado IN ('borrador', 'recibida', 'anulada')),
  factura_proveedor  VARCHAR(60),
  fecha_compra       DATE NOT NULL DEFAULT CURRENT_DATE,
  subtotal           NUMERIC(14,2) NOT NULL DEFAULT 0 CHECK (subtotal >= 0),
  notas              TEXT,
  asesor_id          INTEGER REFERENCES asesores (id) ON DELETE SET NULL,
  recibida_at        TIMESTAMPTZ,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_compra_recibida CHECK ((estado = 'recibida') = (recibida_at IS NOT NULL) OR estado = 'anulada')
);
CREATE INDEX ix_compras_estado ON compras (estado, fecha_compra DESC);
CREATE INDEX ix_compras_proveedor ON compras (proveedor_id);
CREATE TRIGGER tg_compras_updated BEFORE UPDATE ON compras
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

CREATE TABLE detalle_compras (
  id              SERIAL PRIMARY KEY,
  compra_id       INTEGER NOT NULL REFERENCES compras (id) ON DELETE CASCADE,
  producto_id     INTEGER NOT NULL REFERENCES productos (id) ON DELETE RESTRICT,
  cantidad        INTEGER NOT NULL CHECK (cantidad > 0),
  costo_unitario  NUMERIC(14,2) NOT NULL CHECK (costo_unitario >= 0),
  subtotal        NUMERIC(14,2) NOT NULL,
  CONSTRAINT ck_detcompra_subtotal CHECK (subtotal = cantidad * costo_unitario),
  CONSTRAINT uq_detcompra_producto UNIQUE (compra_id, producto_id)
);

ALTER TABLE movimientos_inventario ADD COLUMN compra_id INTEGER REFERENCES compras (id) ON DELETE SET NULL;

-- Imágenes: la base de datos guarda solo la URL (nunca el archivo ni Base64).
CREATE TABLE producto_imagenes (
  id                    SERIAL PRIMARY KEY,
  producto_id           INTEGER NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  url                   VARCHAR(600) NOT NULL CHECK (url ~ '^(https://|/)'),
  clave_almacenamiento  VARCHAR(300),
  alt                   VARCHAR(200),
  orden                 SMALLINT NOT NULL DEFAULT 0,
  es_principal          BOOLEAN NOT NULL DEFAULT false,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_imagen_principal ON producto_imagenes (producto_id) WHERE es_principal;
CREATE INDEX ix_imagenes_producto ON producto_imagenes (producto_id, orden);
