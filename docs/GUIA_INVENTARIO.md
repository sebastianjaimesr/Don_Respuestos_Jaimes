# Guía de administración del inventario

Esta guía es para el propietario y el personal. Todo se hace desde el panel: `/admin`.

## Antes de empezar: quitar los datos de demostración

Los productos `DEMO-*` son ficticios. Antes de cargar el inventario real:

```bash
psql "$DATABASE_URL" -f database/seeds/borrar_demo.sql
```

Si un producto demo ya tiene pedidos o cotizaciones, el script se detiene a propósito; en ese caso desactívalo desde el panel en lugar de borrarlo.

## Roles

| Rol | Puede |
|---|---|
| Administrador | Todo: productos, precios, compatibilidades, configuración, usuarios |
| Vendedor | Entradas/salidas de inventario, pedidos, cotizaciones y atención humana. **No** cambia precios |
| Solo consulta | Ver todo, sin modificar |

Crea un usuario por persona (Panel → Usuarios). Así la bitácora dice quién hizo cada cambio.

## 1. Marcas: original vs. genérico

Cada producto pertenece a una marca, y la **marca decide si es original o genérico**. "Yamaha" ya existe como marca original. Para repuestos de otras marcas, crea la marca como *genérico*. La base de datos no permite mezclarlos.

## 2. Modelos de moto

Ya vienen FZ 2.0, FZ 25, NMAX, XTZ 125, XTZ 150, YBR 125, BWS 125, Crypton, MT-03 y R15. Los **alias** son las formas en que los clientes escriben el modelo (`fz2`, `n max`, `biwis`…). Si una palabra sirve para dos modelos (ej. `fz`), el asistente preguntará cuál es: eso es intencional, porque motos con nombres parecidos no comparten repuestos.

Los años de fabricación de cada modelo quedaron vacíos porque no estaban verificados. Lo que importa para vender es el rango de años de cada **compatibilidad**.

## 3. Crear un producto

Panel → Productos → **Nuevo producto**:

- **Referencia:** el código real (del catálogo Yamaha o del proveedor). No se puede repetir.
- **Categoría y posición:** la posición (delantero/trasero) se pide para frenos y llantas.
- **Precio:** si todavía no está confirmado, **déjalo vacío**. El asistente dirá "precio por confirmar con un asesor" y no lo venderá.
- **Stock mínimo:** cuando el stock llega a ese número, aparece en alertas.
- **Tiempo de abastecimiento:** solo si el proveedor lo confirmó. El asistente lo menciona cuando el producto está agotado.

El producto se crea con stock 0.

## 4. Compatibilidades (lo más importante)

Sin compatibilidades, el asistente **nunca** mostrará el producto. En el detalle del producto → *Compatibilidad con motos*:

- Elige el modelo y el rango de años (ej. FZ 2.0, 2016–2024).
- Marca **verificada** solo si lo confirmaste en una fuente (catálogo de partes, manual, proveedor) y escribe cuál.
- Una compatibilidad **sin verificar** se muestra al cliente como "debe confirmarla un asesor" y no se puede agregar al pedido.

Repite para cada modelo/rango. Una misma referencia puede servir para varias motos, pero solo si está verificado.

## 5. Cargar existencias

En el detalle del producto (o Panel → Inventario) → *Registrar movimiento*:

| Tipo | Cuándo |
|---|---|
| Entrada | Llegó mercancía del proveedor, devolución de cliente |
| Salida | Venta en mostrador, producto dañado, garantía |
| Ajuste | Conteo físico: escribes la cantidad real y el sistema calcula la diferencia |

Siempre pide un motivo (ej. "Factura 1234 de Proveedor X"). El inventario nunca puede quedar negativo.

Los pedidos del chat descuentan stock automáticamente al registrarse. Si cancelas un pedido, las unidades vuelven solas (movimiento *devolución*).

## 6. Pedidos

Panel → Pedidos. Flujo normal:

`Registrado` → (llamas al cliente, confirmas pago y envío) → `Confirmado` → `En preparación` → `Enviado` → `Entregado`

- El pago se marca aparte (pendiente/confirmado/rechazado). El sistema **no procesa pagos**: solo registra el método elegido.
- Si el envío dice "por confirmar", el total no lo incluye: acuérdalo con el cliente al llamarlo.

## 7. Atención humana

Panel → Atención humana. Cuando un cliente pide un asesor, está molesto o hay un error:

1. **Tomar conversación**: desde ese momento el asistente deja de responder en ese chat.
2. Escribe al cliente desde el panel (en web le llega al chat; en WhatsApp/Telegram, solo si n8n está configurado: el panel avisa si no se pudo enviar).
3. **Marcar resuelta** cuando termines: el asistente vuelve a atender.

## 8. Configuración del negocio

Panel → Configuración. Dirección, ciudades de envío, transportadoras, costo de envío y contacto humano están **pendientes**. Completa cada uno y marca "confirmado" solo cuando sea un dato definitivo. Mientras tanto, el asistente dice "por confirmar con un asesor".

El costo de envío puede ser un número (`12000`) o una tabla por ciudad: `{"bogota": 12000, "medellin": 15000, "default": 20000}` (ciudades en minúscula y sin tildes).

## Rutina recomendada

- **Diario:** revisar Atención humana y pedidos *Registrados*.
- **Semanal:** revisar alertas de stock y productos *sin precio*.
- **Mensual:** conteo físico de los productos que más rotan (ajuste).
