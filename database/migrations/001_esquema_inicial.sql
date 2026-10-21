-- =====================================================================
-- Don Repuestos Jaimes — Esquema inicial
-- PostgreSQL 14+
-- Convenciones:
--   * Nombres en español, snake_case.
--   * Dinero en NUMERIC(14,2) (nunca FLOAT: evita errores de redondeo).
--   * Fechas en TIMESTAMPTZ (zona horaria explícita).
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS unaccent;  -- búsquedas sin tildes

-- Función reutilizable para mantener updated_at
CREATE OR REPLACE FUNCTION fn_actualizar_updated_at() RETURNS trigger AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- Marcas de repuestos
-- tipo indica si la marca produce repuestos ORIGINALES (Yamaha) o GENÉRICOS.
-- Un producto hereda el tipo de su marca mediante una FK compuesta,
-- así es imposible "mezclar" un repuesto genérico con una marca original.
-- ---------------------------------------------------------------------
CREATE TABLE marcas (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(80) NOT NULL,
  tipo        VARCHAR(10) NOT NULL CHECK (tipo IN ('original', 'generico')),
  es_demo     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_marcas_nombre UNIQUE (nombre),
  CONSTRAINT uq_marcas_id_tipo UNIQUE (id, tipo)
);

-- ---------------------------------------------------------------------
-- Modelos de motocicleta. Cada variante es un registro distinto:
-- "FZ 2.0" y "FZ 25" NO comparten repuestos por defecto.
-- alias: formas en que los clientes escriben el modelo (minúsculas, sin tildes).
-- ---------------------------------------------------------------------
CREATE TABLE modelos_motocicleta (
  id            SERIAL PRIMARY KEY,
  fabricante    VARCHAR(40) NOT NULL DEFAULT 'Yamaha',
  nombre        VARCHAR(80) NOT NULL,
  cilindraje_cc INTEGER CHECK (cilindraje_cc IS NULL OR cilindraje_cc > 0),
  anio_inicio   SMALLINT CHECK (anio_inicio IS NULL OR anio_inicio BETWEEN 1950 AND 2100),
  anio_fin      SMALLINT CHECK (anio_fin IS NULL OR anio_fin BETWEEN 1950 AND 2100),
  alias         TEXT[] NOT NULL DEFAULT '{}',
  activo        BOOLEAN NOT NULL DEFAULT true,
  es_demo       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_modelo_fabricante_nombre UNIQUE (fabricante, nombre),
  CONSTRAINT ck_modelo_anios CHECK (anio_inicio IS NULL OR anio_fin IS NULL OR anio_inicio <= anio_fin)
);
CREATE INDEX ix_modelos_alias ON modelos_motocicleta USING GIN (alias);

-- ---------------------------------------------------------------------
-- Productos (repuestos)
-- precio puede ser NULL: significa "precio no confirmado" y el asistente
-- NUNCA lo muestra ni permite venderlo hasta que un administrador lo fije.
-- ---------------------------------------------------------------------
CREATE TABLE productos (
  id            SERIAL PRIMARY KEY,
  referencia    VARCHAR(60) NOT NULL,
  nombre        VARCHAR(160) NOT NULL,
  descripcion   TEXT,
  categoria     VARCHAR(40) NOT NULL,
  posicion      VARCHAR(12) CHECK (posicion IN ('delantero', 'trasero')),
  marca_id      INTEGER NOT NULL,
  tipo          VARCHAR(10) NOT NULL CHECK (tipo IN ('original', 'generico')),
  precio        NUMERIC(14,2) CHECK (precio IS NULL OR precio > 0),
  activo        BOOLEAN NOT NULL DEFAULT true,
  es_demo       BOOLEAN NOT NULL DEFAULT false,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  -- El tipo del producto debe coincidir con el tipo de su marca
  CONSTRAINT fk_productos_marca_tipo FOREIGN KEY (marca_id, tipo) REFERENCES marcas (id, tipo),
  CONSTRAINT ck_productos_categoria CHECK (categoria ~ '^[a-z_]+$')
);
-- Referencia única sin importar mayúsculas/espacios
CREATE UNIQUE INDEX uq_productos_referencia ON productos (upper(btrim(referencia)));
CREATE INDEX ix_productos_categoria ON productos (categoria, posicion) WHERE activo;
CREATE TRIGGER tg_productos_updated BEFORE UPDATE ON productos
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

-- ---------------------------------------------------------------------
-- Compatibilidades producto ↔ modelo + rango de años
-- verificada = false → se muestra como "por confirmar con un asesor".
-- ---------------------------------------------------------------------
CREATE TABLE compatibilidades (
  id           SERIAL PRIMARY KEY,
  producto_id  INTEGER NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  modelo_id    INTEGER NOT NULL REFERENCES modelos_motocicleta (id) ON DELETE RESTRICT,
  anio_desde   SMALLINT NOT NULL CHECK (anio_desde BETWEEN 1950 AND 2100),
  anio_hasta   SMALLINT NOT NULL CHECK (anio_hasta BETWEEN 1950 AND 2100),
  verificada   BOOLEAN NOT NULL DEFAULT false,
  fuente       VARCHAR(200),
  notas        TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_compat_anios CHECK (anio_desde <= anio_hasta),
  CONSTRAINT uq_compat UNIQUE (producto_id, modelo_id, anio_desde, anio_hasta),
  -- Una compatibilidad "verificada" debe decir de dónde salió
  CONSTRAINT ck_compat_fuente CHECK (NOT verificada OR fuente IS NOT NULL)
);
CREATE INDEX ix_compat_modelo ON compatibilidades (modelo_id, anio_desde, anio_hasta);
CREATE INDEX ix_compat_producto ON compatibilidades (producto_id);

-- ---------------------------------------------------------------------
-- Inventario (1 fila por producto)
-- ---------------------------------------------------------------------
CREATE TABLE inventario (
  producto_id                 INTEGER PRIMARY KEY REFERENCES productos (id) ON DELETE CASCADE,
  cantidad                    INTEGER NOT NULL DEFAULT 0 CHECK (cantidad >= 0),
  stock_minimo                INTEGER NOT NULL DEFAULT 2 CHECK (stock_minimo >= 0),
  ubicacion                   VARCHAR(60),
  tiempo_abastecimiento_dias  INTEGER CHECK (tiempo_abastecimiento_dias IS NULL OR tiempo_abastecimiento_dias > 0),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TRIGGER tg_inventario_updated BEFORE UPDATE ON inventario
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

-- ---------------------------------------------------------------------
-- Asesores / usuarios del panel
-- ---------------------------------------------------------------------
CREATE TABLE asesores (
  id             SERIAL PRIMARY KEY,
  nombre         VARCHAR(120) NOT NULL,
  email          VARCHAR(160) NOT NULL,
  password_hash  VARCHAR(100) NOT NULL,
  rol            VARCHAR(12) NOT NULL CHECK (rol IN ('admin', 'vendedor', 'consulta')),
  activo         BOOLEAN NOT NULL DEFAULT true,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  ultimo_acceso  TIMESTAMPTZ
);
CREATE UNIQUE INDEX uq_asesores_email ON asesores (lower(email));

-- ---------------------------------------------------------------------
-- Clientes (se deduplican por teléfono normalizado, solo dígitos)
-- ---------------------------------------------------------------------
CREATE TABLE clientes (
  id          SERIAL PRIMARY KEY,
  nombre      VARCHAR(120) NOT NULL,
  telefono    VARCHAR(15) NOT NULL CHECK (telefono ~ '^[0-9]{7,15}$'),
  ciudad      VARCHAR(80),
  direccion   VARCHAR(200),
  email       VARCHAR(160),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_clientes_telefono UNIQUE (telefono)
);
CREATE TRIGGER tg_clientes_updated BEFORE UPDATE ON clientes
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

-- ---------------------------------------------------------------------
-- Conversaciones y mensajes
-- contexto: estado del flujo de ventas (moto, repuesto, carrito, etc.)
-- ---------------------------------------------------------------------
CREATE TABLE conversaciones (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  canal             VARCHAR(20) NOT NULL DEFAULT 'web' CHECK (canal IN ('web', 'whatsapp', 'telegram', 'otro')),
  canal_usuario_id  VARCHAR(120),
  cliente_id        INTEGER REFERENCES clientes (id) ON DELETE SET NULL,
  estado            VARCHAR(12) NOT NULL DEFAULT 'activa' CHECK (estado IN ('activa', 'escalada', 'cerrada')),
  contexto          JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_conv_canal_usuario ON conversaciones (canal, canal_usuario_id)
  WHERE canal_usuario_id IS NOT NULL AND estado <> 'cerrada';
CREATE TRIGGER tg_conversaciones_updated BEFORE UPDATE ON conversaciones
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

CREATE TABLE mensajes (
  id               BIGSERIAL PRIMARY KEY,
  conversacion_id  UUID NOT NULL REFERENCES conversaciones (id) ON DELETE CASCADE,
  rol              VARCHAR(10) NOT NULL CHECK (rol IN ('cliente', 'asistente', 'asesor', 'sistema')),
  contenido        TEXT NOT NULL,
  metadata         JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_mensajes_conv ON mensajes (conversacion_id, created_at);

-- ---------------------------------------------------------------------
-- Cotizaciones
-- ---------------------------------------------------------------------
CREATE SEQUENCE seq_codigo_cotizacion START 1;
CREATE TABLE cotizaciones (
  id                SERIAL PRIMARY KEY,
  codigo            VARCHAR(20) NOT NULL UNIQUE
                    DEFAULT 'COT-' || lpad(nextval('seq_codigo_cotizacion')::text, 6, '0'),
  cliente_id        INTEGER REFERENCES clientes (id) ON DELETE SET NULL,
  conversacion_id   UUID REFERENCES conversaciones (id) ON DELETE SET NULL,
  estado            VARCHAR(12) NOT NULL DEFAULT 'emitida'
                    CHECK (estado IN ('emitida', 'aceptada', 'vencida', 'anulada')),
  subtotal          NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
  costo_envio       NUMERIC(14,2) CHECK (costo_envio IS NULL OR costo_envio >= 0),
  envio_confirmado  BOOLEAN NOT NULL DEFAULT false,
  total             NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  fecha_emision     TIMESTAMPTZ NOT NULL DEFAULT now(),
  vigente_hasta     TIMESTAMPTZ,
  CONSTRAINT ck_cot_total CHECK (total = subtotal + COALESCE(costo_envio, 0)),
  CONSTRAINT ck_cot_envio CHECK (envio_confirmado OR costo_envio IS NULL)
);
CREATE INDEX ix_cotizaciones_estado ON cotizaciones (estado, fecha_emision DESC);

CREATE TABLE detalle_cotizacion (
  id               SERIAL PRIMARY KEY,
  cotizacion_id    INTEGER NOT NULL REFERENCES cotizaciones (id) ON DELETE CASCADE,
  producto_id      INTEGER NOT NULL REFERENCES productos (id) ON DELETE RESTRICT,
  descripcion      VARCHAR(160) NOT NULL,
  referencia       VARCHAR(60) NOT NULL,
  tipo             VARCHAR(10) NOT NULL CHECK (tipo IN ('original', 'generico')),
  cantidad         INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario  NUMERIC(14,2) NOT NULL CHECK (precio_unitario > 0),
  subtotal         NUMERIC(14,2) NOT NULL,
  CONSTRAINT ck_detcot_subtotal CHECK (subtotal = cantidad * precio_unitario)
);
CREATE INDEX ix_detcot_cotizacion ON detalle_cotizacion (cotizacion_id);

-- ---------------------------------------------------------------------
-- Pedidos
-- clave_idempotencia: evita registrar dos veces el mismo pedido.
-- confirmado_por_cliente: obligatorio TRUE (no hay pedidos sin confirmar).
-- ---------------------------------------------------------------------
CREATE SEQUENCE seq_codigo_pedido START 1;
CREATE TABLE pedidos (
  id                      SERIAL PRIMARY KEY,
  codigo                  VARCHAR(20) NOT NULL UNIQUE
                          DEFAULT 'PED-' || lpad(nextval('seq_codigo_pedido')::text, 6, '0'),
  cliente_id              INTEGER NOT NULL REFERENCES clientes (id) ON DELETE RESTRICT,
  cotizacion_id           INTEGER REFERENCES cotizaciones (id) ON DELETE SET NULL,
  conversacion_id         UUID REFERENCES conversaciones (id) ON DELETE SET NULL,
  estado                  VARCHAR(16) NOT NULL DEFAULT 'registrado'
                          CHECK (estado IN ('registrado', 'confirmado', 'en_preparacion', 'enviado', 'entregado', 'cancelado')),
  modalidad_entrega       VARCHAR(16) NOT NULL CHECK (modalidad_entrega IN ('recogida_tienda', 'envio')),
  ciudad_entrega          VARCHAR(80),
  direccion_entrega       VARCHAR(200),
  metodo_pago             VARCHAR(16) NOT NULL
                          CHECK (metodo_pago IN ('nequi', 'daviplata', 'transferencia', 'efectivo', 'contraentrega')),
  estado_pago             VARCHAR(12) NOT NULL DEFAULT 'pendiente'
                          CHECK (estado_pago IN ('pendiente', 'confirmado', 'rechazado', 'reembolsado')),
  subtotal                NUMERIC(14,2) NOT NULL CHECK (subtotal >= 0),
  costo_envio             NUMERIC(14,2) CHECK (costo_envio IS NULL OR costo_envio >= 0),
  envio_confirmado        BOOLEAN NOT NULL DEFAULT false,
  total                   NUMERIC(14,2) NOT NULL CHECK (total >= 0),
  confirmado_por_cliente  BOOLEAN NOT NULL CHECK (confirmado_por_cliente = true),
  clave_idempotencia      VARCHAR(120) NOT NULL UNIQUE,
  notas                   TEXT,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_ped_total CHECK (total = subtotal + COALESCE(costo_envio, 0)),
  CONSTRAINT ck_ped_envio CHECK (envio_confirmado OR costo_envio IS NULL),
  CONSTRAINT ck_ped_direccion CHECK (modalidad_entrega <> 'envio' OR (direccion_entrega IS NOT NULL AND ciudad_entrega IS NOT NULL))
);
CREATE INDEX ix_pedidos_estado ON pedidos (estado, created_at DESC);
CREATE INDEX ix_pedidos_cliente ON pedidos (cliente_id);
CREATE TRIGGER tg_pedidos_updated BEFORE UPDATE ON pedidos
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

CREATE TABLE detalle_pedido (
  id               SERIAL PRIMARY KEY,
  pedido_id        INTEGER NOT NULL REFERENCES pedidos (id) ON DELETE CASCADE,
  producto_id      INTEGER NOT NULL REFERENCES productos (id) ON DELETE RESTRICT,
  descripcion      VARCHAR(160) NOT NULL,
  referencia       VARCHAR(60) NOT NULL,
  tipo             VARCHAR(10) NOT NULL CHECK (tipo IN ('original', 'generico')),
  cantidad         INTEGER NOT NULL CHECK (cantidad > 0),
  precio_unitario  NUMERIC(14,2) NOT NULL CHECK (precio_unitario > 0),
  subtotal         NUMERIC(14,2) NOT NULL,
  CONSTRAINT ck_detped_subtotal CHECK (subtotal = cantidad * precio_unitario),
  CONSTRAINT uq_detped_producto UNIQUE (pedido_id, producto_id)
);

-- ---------------------------------------------------------------------
-- Movimientos de inventario (bitácora inmutable de cambios de stock)
-- ---------------------------------------------------------------------
CREATE TABLE movimientos_inventario (
  id                 BIGSERIAL PRIMARY KEY,
  producto_id        INTEGER NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  tipo               VARCHAR(12) NOT NULL CHECK (tipo IN ('entrada', 'salida', 'ajuste', 'venta', 'devolucion')),
  cantidad           INTEGER NOT NULL CHECK (cantidad <> 0),  -- con signo: + entra, - sale
  cantidad_anterior  INTEGER NOT NULL CHECK (cantidad_anterior >= 0),
  cantidad_nueva     INTEGER NOT NULL CHECK (cantidad_nueva >= 0),
  motivo             VARCHAR(200),
  pedido_id          INTEGER REFERENCES pedidos (id) ON DELETE SET NULL,
  asesor_id          INTEGER REFERENCES asesores (id) ON DELETE SET NULL,
  created_at         TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_mov_aritmetica CHECK (cantidad_nueva = cantidad_anterior + cantidad)
);
CREATE INDEX ix_mov_producto ON movimientos_inventario (producto_id, created_at DESC);

-- ---------------------------------------------------------------------
-- Transferencias a atención humana
-- ---------------------------------------------------------------------
CREATE TABLE transferencias_atencion (
  id                   SERIAL PRIMARY KEY,
  conversacion_id      UUID REFERENCES conversaciones (id) ON DELETE SET NULL,
  cliente_id           INTEGER REFERENCES clientes (id) ON DELETE SET NULL,
  motivo               VARCHAR(40) NOT NULL,
  detalle              TEXT,
  estado               VARCHAR(12) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'en_atencion', 'resuelta')),
  asesor_id            INTEGER REFERENCES asesores (id) ON DELETE SET NULL,
  notificado           BOOLEAN NOT NULL DEFAULT false,
  canal_notificacion   VARCHAR(40),
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
  atendida_at          TIMESTAMPTZ,
  resuelta_at          TIMESTAMPTZ
);
CREATE INDEX ix_transf_estado ON transferencias_atencion (estado, created_at DESC);

-- ---------------------------------------------------------------------
-- Registro de eventos y errores (sin datos sensibles)
-- ---------------------------------------------------------------------
CREATE TABLE registros_eventos (
  id          BIGSERIAL PRIMARY KEY,
  nivel       VARCHAR(8) NOT NULL CHECK (nivel IN ('info', 'aviso', 'error')),
  tipo        VARCHAR(60) NOT NULL,
  mensaje     TEXT NOT NULL,
  datos       JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_eventos_fecha ON registros_eventos (created_at DESC);
CREATE INDEX ix_eventos_tipo ON registros_eventos (tipo, created_at DESC);

-- ---------------------------------------------------------------------
-- Configuración comercial editable por el propietario
-- confirmado = false → la interfaz muestra "pendiente de confirmar".
-- ---------------------------------------------------------------------
CREATE TABLE configuracion_negocio (
  clave        VARCHAR(60) PRIMARY KEY,
  valor        JSONB,
  descripcion  VARCHAR(200) NOT NULL,
  confirmado   BOOLEAN NOT NULL DEFAULT false,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Vista de apoyo: estado del inventario calculado
CREATE VIEW v_estado_inventario AS
SELECT p.id AS producto_id,
       i.cantidad,
       i.stock_minimo,
       i.tiempo_abastecimiento_dias,
       CASE
         WHEN i.producto_id IS NULL THEN 'sin_registro'
         WHEN i.cantidad = 0 THEN 'agotado'
         WHEN i.cantidad <= i.stock_minimo THEN 'stock_bajo'
         ELSE 'disponible'
       END AS estado
FROM productos p
LEFT JOIN inventario i ON i.producto_id = p.id;
