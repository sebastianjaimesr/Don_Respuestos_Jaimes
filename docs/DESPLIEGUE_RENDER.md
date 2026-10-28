# Publicar el backend y la base de datos en Render

El frontend ya vive en GitHub Pages. Esta guía monta el **backend (Express)** y **PostgreSQL** en [Render](https://render.com) y los conecta con la página.

El archivo [`render.yaml`](../render.yaml) (un *Blueprint*) le dice a Render qué crear, así que casi todo es automático.

## Lo que hace el Blueprint

| Qué | Detalle |
|---|---|
| Base de datos `drj-db` | PostgreSQL 16, plan gratis |
| Servicio web `drj-backend` | Node 22, plan gratis, revisa `/api/salud` |
| `DATABASE_URL` | Se conecta sola a `drj-db` |
| `JWT_SECRET`, `WEBHOOK_SECRET` | Render los genera al azar (no quedan en git) |
| `CORS_ORIGENES` | `https://sebastianjaimesr.github.io` |
| `CARGAR_DEMO` | `true`: carga los productos FICTICIOS `DEMO-*` para probar |
| `ADMIN_EMAIL`, `ADMIN_PASSWORD` | Te los pide Render al crear; con ellos se crea el primer administrador |

Cada vez que el servicio arranca, `npm run preparar -w backend` aplica migraciones pendientes, carga el demo (si `CARGAR_DEMO=true`; no duplica nada) y crea el administrador **solo si todavía no existe ninguno**.

## Paso 1 — Crear todo en Render

1. Entra a [dashboard.render.com](https://dashboard.render.com) con tu cuenta de GitHub.
2. **New → Blueprint**.
3. Conecta el repositorio `sebastianjaimesr/Don_Respuestos_Jaimes` (si no aparece, dale permiso a Render en GitHub).
4. Render lee `render.yaml` y te muestra lo que va a crear. Llena:
   - `ADMIN_EMAIL`: tu correo para entrar al panel.
   - `ADMIN_PASSWORD`: mínimo 10 caracteres, con letras y números.
5. **Apply**. Espera a que el servicio quede en *Live* (la primera vez tarda unos minutos).
6. Copia la URL del servicio, algo como `https://drj-backend.onrender.com` (puede tener letras extra al final).
7. Prueba en el navegador: `https://TU-URL/api/salud` debe responder `{"ok":true,...,"base_datos":"ok"}`.

Si no se creó el administrador (por ejemplo, contraseña débil), el log del servicio lo dice. Corrige `ADMIN_PASSWORD` en **Environment** y el servicio se reinicia y lo crea.

### ¿No puedes entrar al panel?

El administrador se crea **solo la primera vez**: cambiar `ADMIN_PASSWORD` después no cambia la clave de un usuario que ya existe. Para recuperar el acceso:

1. En **Environment** pon el correo y la clave nueva en `ADMIN_EMAIL` y `ADMIN_PASSWORD` (mínimo 10 caracteres, con letras y números).
2. Agrega la variable `ADMIN_RESTABLECER` con valor `true` y guarda. El servicio se reinicia.
3. En **Logs** debe aparecer `✔ Acceso restablecido para ...` (o `✔ Administrador creado` si el correo no existía).
4. Entra al panel y **vuelve a poner `ADMIN_RESTABLECER=false`** (o bórrala) para que no se repita en cada reinicio.

No se pierde ningún dato: solo cambia la clave de ese usuario y lo deja como administrador activo.

## Paso 2 — Decirle a la página dónde está el backend

El workflow ya usa `https://drj-backend.onrender.com` por defecto. Solo haz esto si tu servicio quedó con otra URL:

1. En GitHub: repositorio → **Settings → Secrets and variables → Actions → pestaña Variables → New repository variable**.
2. Nombre: `VITE_API_URL`. Valor: la URL del paso 1.6, **sin** `/` al final.
3. **Actions → GitHub Pages → Run workflow** para volver a publicar la página.

Con eso desaparece el aviso amarillo y el chat responde.

## Paso 3 — CORS

Ya viene listo en `render.yaml` (`CORS_ORIGENES=https://sebastianjaimesr.github.io`). Si algún día usas otro dominio, agrégalo separado por coma en **Environment** del servicio.

## Ojo con el plan gratis

- El servicio web gratis **se duerme** tras unos 15 minutos sin uso; el primer mensaje después tarda alrededor de un minuto en responder.
- La base de datos gratis de Render **vence** después de un tiempo (revisa la fecha en su panel y la página de precios de Render). Para el negocio real, pásala a un plan pago y activa backups.
- Antes de usarlo con clientes reales: pon `CARGAR_DEMO=false`, borra el demo (`database/seeds/borrar_demo.sql`) y revisa [PENDIENTES_PRODUCCION.md](PENDIENTES_PRODUCCION.md).
