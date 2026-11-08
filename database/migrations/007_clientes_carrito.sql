-- =====================================================================
-- 007 — Cuentas de cliente, carrito en servidor, favoritos y pagos
-- Comprar sin cuenta sigue siendo posible: la cuenta es opcional.
-- =====================================================================

ALTER TABLE clientes
  ADD COLUMN password_hash     VARCHAR(100),
  ADD COLUMN email_verificado  BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN ultimo_acceso     TIMESTAMPTZ;
-- Una cuenta (con contraseña) por correo
CREATE UNIQUE INDEX uq_clientes_email_cuenta ON clientes (lower(email)) WHERE password_hash IS NOT NULL;
ALTER TABLE clientes ADD CONSTRAINT ck_clientes_cuenta_email CHECK (password_hash IS NULL OR email IS NOT NULL);

CREATE TABLE carritos (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cliente_id       INTEGER REFERENCES clientes (id) ON DELETE SET NULL,
  conversacion_id  UUID REFERENCES conversaciones (id) ON DELETE SET NULL,
  estado           VARCHAR(12) NOT NULL DEFAULT 'activo' CHECK (estado IN ('activo', 'convertido', 'abandonado')),
  created_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_carrito_activo_cliente ON carritos (cliente_id) WHERE estado = 'activo' AND cliente_id IS NOT NULL;
CREATE UNIQUE INDEX uq_carrito_activo_conversacion ON carritos (conversacion_id) WHERE estado = 'activo' AND conversacion_id IS NOT NULL;
CREATE TRIGGER tg_carritos_updated BEFORE UPDATE ON carritos
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();

CREATE TABLE carrito_items (
  carrito_id   UUID NOT NULL REFERENCES carritos (id) ON DELETE CASCADE,
  producto_id  INTEGER NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  cantidad     INTEGER NOT NULL CHECK (cantidad BETWEEN 1 AND 999),
  agregado_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (carrito_id, producto_id)
);

CREATE TABLE favoritos (
  cliente_id   INTEGER NOT NULL REFERENCES clientes (id) ON DELETE CASCADE,
  producto_id  INTEGER NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (cliente_id, producto_id)
);

ALTER TABLE pedidos
  ADD COLUMN canal VARCHAR(10) NOT NULL DEFAULT 'chat' CHECK (canal IN ('web', 'chat', 'whatsapp', 'telegram', 'panel')),
  ADD COLUMN carrito_id UUID REFERENCES carritos (id) ON DELETE SET NULL,
  ADD COLUMN whatsapp_enviado_at TIMESTAMPTZ;

-- Pagos: preparada para una pasarela (Wompi, PayU…). Hoy solo hay registro manual.
-- Ningún flujo marca un pago como aprobado sin confirmación del proveedor o de un asesor.
CREATE TABLE pagos (
  id                  SERIAL PRIMARY KEY,
  pedido_id           INTEGER NOT NULL REFERENCES pedidos (id) ON DELETE RESTRICT,
  proveedor           VARCHAR(12) NOT NULL CHECK (proveedor IN ('manual', 'wompi', 'payu', 'mercadopago')),
  metodo              VARCHAR(16),
  referencia_externa  VARCHAR(120),
  monto               NUMERIC(14,2) NOT NULL CHECK (monto > 0),
  estado              VARCHAR(12) NOT NULL DEFAULT 'pendiente' CHECK (estado IN ('pendiente', 'aprobado', 'rechazado', 'reembolsado')),
  payload             JSONB NOT NULL DEFAULT '{}'::jsonb,
  asesor_id           INTEGER REFERENCES asesores (id) ON DELETE SET NULL,
  created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_pagos_pedido ON pagos (pedido_id);
CREATE UNIQUE INDEX uq_pagos_referencia ON pagos (proveedor, referencia_externa) WHERE referencia_externa IS NOT NULL;
CREATE TRIGGER tg_pagos_updated BEFORE UPDATE ON pagos
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
