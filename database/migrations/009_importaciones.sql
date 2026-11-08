-- =====================================================================
-- 009 — Importaciones de catálogo, precios, stock y compatibilidades
-- Paso 1: validar (se guardan filas y errores). Paso 2: aplicar en una transacción.
-- =====================================================================

CREATE TABLE importaciones (
  id              SERIAL PRIMARY KEY,
  tipo            VARCHAR(20) NOT NULL CHECK (tipo IN ('productos', 'precios', 'stock', 'compatibilidades')),
  archivo_nombre  VARCHAR(200) NOT NULL,
  formato         VARCHAR(4) NOT NULL CHECK (formato IN ('csv', 'xlsx')),
  estado          VARCHAR(12) NOT NULL DEFAULT 'validando'
                  CHECK (estado IN ('validando', 'validada', 'con_errores', 'aplicada', 'fallida', 'descartada')),
  modo            VARCHAR(12) CHECK (modo IN ('solo_validas', 'todo_o_nada')),
  filas_total     INTEGER NOT NULL DEFAULT 0 CHECK (filas_total >= 0),
  filas_validas   INTEGER NOT NULL DEFAULT 0 CHECK (filas_validas >= 0),
  filas_error     INTEGER NOT NULL DEFAULT 0 CHECK (filas_error >= 0),
  resumen         JSONB NOT NULL DEFAULT '{}'::jsonb,
  asesor_id       INTEGER REFERENCES asesores (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  aplicada_at     TIMESTAMPTZ
);
CREATE INDEX ix_importaciones_fecha ON importaciones (created_at DESC);

CREATE TABLE importacion_filas (
  importacion_id  INTEGER NOT NULL REFERENCES importaciones (id) ON DELETE CASCADE,
  fila            INTEGER NOT NULL CHECK (fila > 0),
  datos           JSONB NOT NULL,
  valida          BOOLEAN NOT NULL,
  PRIMARY KEY (importacion_id, fila)
);

CREATE TABLE importacion_errores (
  id              BIGSERIAL PRIMARY KEY,
  importacion_id  INTEGER NOT NULL REFERENCES importaciones (id) ON DELETE CASCADE,
  fila            INTEGER NOT NULL,
  columna         VARCHAR(60),
  valor           TEXT,
  mensaje         VARCHAR(300) NOT NULL
);
CREATE INDEX ix_importacion_errores ON importacion_errores (importacion_id, fila);
