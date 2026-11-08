-- =====================================================================
-- 008 — Tarifas de envío y promociones
-- =====================================================================

CREATE TABLE tarifas_envio (
  id              SERIAL PRIMARY KEY,
  ciudad          VARCHAR(80) NOT NULL,
  departamento    VARCHAR(80),
  costo           NUMERIC(14,2) NOT NULL CHECK (costo >= 0),
  dias_estimados  SMALLINT CHECK (dias_estimados IS NULL OR dias_estimados BETWEEN 0 AND 60),
  activo          BOOLEAN NOT NULL DEFAULT true,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX uq_tarifas_ciudad ON tarifas_envio (lower(ciudad), lower(COALESCE(departamento, '')));
CREATE TRIGGER tg_tarifas_updated BEFORE UPDATE ON tarifas_envio
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
CREATE TRIGGER tg_aud_tarifas AFTER INSERT OR UPDATE OR DELETE ON tarifas_envio FOR EACH ROW EXECUTE FUNCTION fn_auditar('id');

CREATE TABLE promociones (
  id              SERIAL PRIMARY KEY,
  nombre          VARCHAR(120) NOT NULL,
  descripcion     TEXT,
  tipo_descuento  VARCHAR(10) NOT NULL CHECK (tipo_descuento IN ('porcentaje', 'valor')),
  valor           NUMERIC(14,2) NOT NULL CHECK (valor > 0),
  alcance         VARCHAR(10) NOT NULL CHECK (alcance IN ('producto', 'categoria', 'marca')),
  producto_id     INTEGER REFERENCES productos (id) ON DELETE CASCADE,
  categoria_id    INTEGER REFERENCES categorias (id) ON DELETE CASCADE,
  marca_id        INTEGER REFERENCES marcas_repuesto (id) ON DELETE CASCADE,
  inicia_at       TIMESTAMPTZ NOT NULL,
  termina_at      TIMESTAMPTZ NOT NULL,
  activo          BOOLEAN NOT NULL DEFAULT true,
  asesor_id       INTEGER REFERENCES asesores (id) ON DELETE SET NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT ck_promo_fechas CHECK (termina_at > inicia_at),
  CONSTRAINT ck_promo_porcentaje CHECK (tipo_descuento <> 'porcentaje' OR valor <= 90),
  CONSTRAINT ck_promo_alcance CHECK (
    (alcance = 'producto') = (producto_id IS NOT NULL)
    AND (alcance = 'categoria') = (categoria_id IS NOT NULL)
    AND (alcance = 'marca') = (marca_id IS NOT NULL)
  )
);
CREATE INDEX ix_promociones_vigentes ON promociones (inicia_at, termina_at) WHERE activo;
CREATE TRIGGER tg_promociones_updated BEFORE UPDATE ON promociones
  FOR EACH ROW EXECUTE FUNCTION fn_actualizar_updated_at();
CREATE TRIGGER tg_aud_promociones AFTER INSERT OR UPDATE OR DELETE ON promociones FOR EACH ROW EXECUTE FUNCTION fn_auditar('id');
