-- =====================================================================
-- 005 — Auditoría, historial de precios y protección del stock
-- El backend identifica al usuario de cada transacción de escritura con
--   SELECT set_config('drj.usuario_id', '<id>', true)
-- y los triggers lo leen. Así ningún camino de escritura se salta el registro.
-- =====================================================================

CREATE OR REPLACE FUNCTION fn_usuario_actual() RETURNS INTEGER AS $$
  SELECT NULLIF(current_setting('drj.usuario_id', true), '')::integer
$$ LANGUAGE sql STABLE;

-- ---------------------------------------------------------------------
-- Historial de precios
-- ---------------------------------------------------------------------
CREATE TABLE historial_precios (
  id                      BIGSERIAL PRIMARY KEY,
  producto_id             INTEGER NOT NULL REFERENCES productos (id) ON DELETE CASCADE,
  precio_anterior         NUMERIC(14,2),
  precio_nuevo            NUMERIC(14,2),
  precio_compra_anterior  NUMERIC(14,2),
  precio_compra_nuevo     NUMERIC(14,2),
  origen                  VARCHAR(12) NOT NULL DEFAULT 'manual'
                          CHECK (origen IN ('manual', 'importacion', 'compra', 'masivo', 'sistema')),
  asesor_id               INTEGER REFERENCES asesores (id) ON DELETE SET NULL,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_historial_precios_producto ON historial_precios (producto_id, created_at DESC);

CREATE OR REPLACE FUNCTION fn_registrar_precio() RETURNS trigger AS $$
BEGIN
  IF NEW.precio IS DISTINCT FROM OLD.precio OR NEW.precio_compra IS DISTINCT FROM OLD.precio_compra THEN
    INSERT INTO historial_precios (producto_id, precio_anterior, precio_nuevo, precio_compra_anterior, precio_compra_nuevo, origen, asesor_id)
    VALUES (NEW.id, OLD.precio, NEW.precio, OLD.precio_compra, NEW.precio_compra,
            COALESCE(NULLIF(current_setting('drj.origen', true), ''), 'manual'), fn_usuario_actual());
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tg_productos_precio AFTER UPDATE OF precio, precio_compra ON productos
  FOR EACH ROW EXECUTE FUNCTION fn_registrar_precio();

-- ---------------------------------------------------------------------
-- Auditoría genérica
-- TG_ARGV[0] = columna clave; TG_ARGV[1..] = columnas a ignorar.
-- Nunca se guardan hashes de contraseña: solo se anota que cambió.
-- ---------------------------------------------------------------------
CREATE TABLE auditoria (
  id           BIGSERIAL PRIMARY KEY,
  tabla        VARCHAR(60) NOT NULL,
  registro_id  TEXT NOT NULL,
  accion       VARCHAR(6) NOT NULL CHECK (accion IN ('INSERT', 'UPDATE', 'DELETE')),
  asesor_id    INTEGER REFERENCES asesores (id) ON DELETE SET NULL,
  cambios      JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX ix_auditoria_registro ON auditoria (tabla, registro_id, created_at DESC);
CREATE INDEX ix_auditoria_fecha ON auditoria (created_at DESC);

CREATE OR REPLACE FUNCTION fn_auditar() RETURNS trigger AS $$
DECLARE
  clave    TEXT := TG_ARGV[0];
  antes    JSONB := CASE WHEN TG_OP <> 'INSERT' THEN to_jsonb(OLD) ELSE '{}'::jsonb END;
  despues  JSONB := CASE WHEN TG_OP <> 'DELETE' THEN to_jsonb(NEW) ELSE '{}'::jsonb END;
  ignorar  TEXT[] := ARRAY['updated_at', 'busqueda', 'margen', 'password_hash'];
  cambios  JSONB := '{}'::jsonb;
  k        TEXT;
  i        INTEGER;
BEGIN
  FOR i IN 1 .. TG_NARGS - 1 LOOP
    ignorar := ignorar || TG_ARGV[i];
  END LOOP;

  IF TG_OP = 'UPDATE' THEN
    FOR k IN SELECT jsonb_object_keys(despues) LOOP
      IF NOT k = ANY (ignorar) AND (despues -> k) IS DISTINCT FROM (antes -> k) THEN
        cambios := cambios || jsonb_build_object(k, jsonb_build_object('antes', antes -> k, 'despues', despues -> k));
      END IF;
    END LOOP;
    IF (despues ->> 'password_hash') IS DISTINCT FROM (antes ->> 'password_hash') THEN
      cambios := cambios || '{"password": "cambiada"}'::jsonb;
    END IF;
    IF cambios = '{}'::jsonb THEN
      RETURN NEW;
    END IF;
  ELSIF TG_OP = 'INSERT' THEN
    cambios := despues - ignorar;
  ELSE
    cambios := antes - ignorar;
  END IF;

  INSERT INTO auditoria (tabla, registro_id, accion, asesor_id, cambios)
  VALUES (TG_TABLE_NAME, COALESCE(despues ->> clave, antes ->> clave), TG_OP, fn_usuario_actual(), cambios);
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER tg_aud_productos AFTER INSERT OR UPDATE OR DELETE ON productos FOR EACH ROW EXECUTE FUNCTION fn_auditar('id');
CREATE TRIGGER tg_aud_inventario AFTER INSERT OR UPDATE OR DELETE ON inventario FOR EACH ROW EXECUTE FUNCTION fn_auditar('producto_id', 'cantidad');
CREATE TRIGGER tg_aud_compatibilidades AFTER INSERT OR UPDATE OR DELETE ON compatibilidades FOR EACH ROW EXECUTE FUNCTION fn_auditar('id');
CREATE TRIGGER tg_aud_categorias AFTER INSERT OR UPDATE OR DELETE ON categorias FOR EACH ROW EXECUTE FUNCTION fn_auditar('id');
CREATE TRIGGER tg_aud_fabricantes AFTER INSERT OR UPDATE OR DELETE ON fabricantes_moto FOR EACH ROW EXECUTE FUNCTION fn_auditar('id');
CREATE TRIGGER tg_aud_modelos AFTER INSERT OR UPDATE OR DELETE ON modelos_motocicleta FOR EACH ROW EXECUTE FUNCTION fn_auditar('id');
CREATE TRIGGER tg_aud_versiones AFTER INSERT OR UPDATE OR DELETE ON versiones_moto FOR EACH ROW EXECUTE FUNCTION fn_auditar('id');
CREATE TRIGGER tg_aud_marcas AFTER INSERT OR UPDATE OR DELETE ON marcas_repuesto FOR EACH ROW EXECUTE FUNCTION fn_auditar('id');
CREATE TRIGGER tg_aud_proveedores AFTER INSERT OR UPDATE OR DELETE ON proveedores FOR EACH ROW EXECUTE FUNCTION fn_auditar('id');
CREATE TRIGGER tg_aud_configuracion AFTER INSERT OR UPDATE OR DELETE ON configuracion_negocio FOR EACH ROW EXECUTE FUNCTION fn_auditar('clave');
CREATE TRIGGER tg_aud_asesores AFTER INSERT OR UPDATE OR DELETE ON asesores FOR EACH ROW EXECUTE FUNCTION fn_auditar('id', 'ultimo_acceso');

-- ---------------------------------------------------------------------
-- El stock solo cambia junto con su movimiento
-- fn_mover_stock actualiza inventario.cantidad y registra el movimiento en
-- un solo paso. Cualquier otro UPDATE de la cantidad se rechaza.
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION fn_proteger_stock() RETURNS trigger AS $$
BEGIN
  IF NEW.cantidad IS DISTINCT FROM OLD.cantidad AND COALESCE(current_setting('drj.movimiento_stock', true), '') <> 'on' THEN
    RAISE EXCEPTION 'La cantidad en inventario solo cambia con un movimiento registrado (fn_mover_stock)'
      USING ERRCODE = '55000';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER tg_inventario_proteger BEFORE UPDATE OF cantidad ON inventario
  FOR EACH ROW EXECUTE FUNCTION fn_proteger_stock();

CREATE OR REPLACE FUNCTION fn_mover_stock(
  p_producto INTEGER, p_tipo VARCHAR, p_delta INTEGER, p_motivo VARCHAR,
  p_pedido INTEGER DEFAULT NULL, p_compra INTEGER DEFAULT NULL, p_asesor INTEGER DEFAULT NULL
) RETURNS movimientos_inventario AS $$
DECLARE
  anterior  INTEGER;
  mov       movimientos_inventario;
BEGIN
  SELECT cantidad INTO anterior FROM inventario WHERE producto_id = p_producto FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'El producto % no tiene registro de inventario', p_producto USING ERRCODE = 'P0002';
  END IF;
  PERFORM set_config('drj.movimiento_stock', 'on', true);
  UPDATE inventario SET cantidad = anterior + p_delta WHERE producto_id = p_producto;
  PERFORM set_config('drj.movimiento_stock', 'off', true);
  INSERT INTO movimientos_inventario (producto_id, tipo, cantidad, cantidad_anterior, cantidad_nueva, motivo, pedido_id, compra_id, asesor_id)
  VALUES (p_producto, p_tipo, p_delta, anterior, anterior + p_delta, p_motivo, p_pedido, p_compra, COALESCE(p_asesor, fn_usuario_actual()))
  RETURNING * INTO mov;
  RETURN mov;
END;
$$ LANGUAGE plpgsql;
