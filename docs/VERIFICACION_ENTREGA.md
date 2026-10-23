# Verificación para la entrega

**Fecha:** 23 de octubre de 2026
**Versión verificada:** rama `main`, commit `0a41d9f`, clonada limpia desde GitHub.
**Entorno:** Ubuntu 24.04, Node.js 22, PostgreSQL 16, Chromium y n8n 2.35.7.

## Resultado

**Todo lo que se puede probar fuera de las cuentas del negocio funciona.** No se encontraron errores.

| Área | Qué se hizo | Resultado |
|---|---|---|
| Instalación | `npm ci` desde un clon limpio | ✅ 0 vulnerabilidades |
| Tipos y compilación | `typecheck` y `build` de backend y frontend | ✅ sin errores |
| Base de datos desde cero | Pasos del README: `.env`, `db:migrar`, `db:demo` y `crear-admin` | ✅ 2 migraciones, demo cargado, admin creado |
| Pruebas automáticas | `npm test` con una base `drj_test` nueva | ✅ **61 de 61**, incluidos los 16 casos del prompt |
| Chat del cliente (navegador) | Búsqueda → agregar → cotización → formulario → resumen → confirmación | ✅ pedido `PED-000001` registrado |
| Casos especiales del chat | Precio faltante, año no compatible, pedir asesor | ✅ no inventa precio ni compatibilidad y escala al asesor |
| Celular (390 px) | Chat completo | ✅ sin desbordes horizontales |
| Panel | Login y las 9 secciones | ✅ cargan sin alertas de error |
| Atención humana | El asesor responde desde el panel | ✅ la respuesta llega al chat del cliente |
| Sesión | Cerrar sesión y entrar a una ruta protegida sin sesión | ✅ redirige al login |
| Roles (backend) | Tabla de abajo | ✅ coinciden con [API.md](API.md) |
| Seguridad de la API | Sin token, token falso, webhook sin firma, inyección SQL en la búsqueda | ✅ 401 / 401 / 401 / búsqueda vacía, sin daño |
| Cabeceras de seguridad | `helmet` | ✅ presentes |
| Secretos | Historial completo de git | ✅ ningún `.env` ni secreto real |
| n8n | Flujo 01 de punta a punta contra el backend recién instalado | ✅ responde con los productos |
| Workflows n8n | `generar_workflows.py` contra los JSON versionados | ✅ idénticos |
| Documentación | Enlaces internos de README y `docs/` | ✅ ninguno roto |
| Consola del navegador | En todo el recorrido | ✅ 0 errores |

### Roles

Cada rol se probó con su propio usuario contra la API. El código es la respuesta HTTP: `201` creado, `200` correcto, `403` sin permiso.

| Acción | admin | vendedor | consulta |
|---|---|---|---|
| Movimiento de inventario | 201 | 201 | 403 |
| Editar configuración del negocio | 200 | 403 | 403 |
| Ver registro de eventos | 200 | 403 | 403 |
| Gestionar usuarios | 200 | 403 | 403 |

## Publicación

| Pieza | Dónde | Estado |
|---|---|---|
| Código | [github.com/sebastianjaimesr/Don_Respuestos_Jaimes](https://github.com/sebastianjaimesr/Don_Respuestos_Jaimes) | ✅ |
| Frontend | [sebastianjaimesr.github.io/Don_Respuestos_Jaimes](https://sebastianjaimesr.github.io/Don_Respuestos_Jaimes/) | ✅ GitHub reporta el despliegue como exitoso |
| Backend y base de datos | `https://drj-backend.onrender.com` (Render, plan gratis) | ✅ Render lo muestra *Live* |

## Lo que NO se pudo verificar aquí

Hay que revisarlo a mano:

1. **La página y el backend en vivo.** Desde el entorno de pruebas no hay acceso a `github.io` ni a `onrender.com`. Haz el recorrido de la sección siguiente en tu navegador.
2. **La variable `VITE_API_URL` en GitHub.** Revisa que exista en Settings → Secrets and variables → Actions → Variables. Si falta, el próximo cambio del frontend vuelve a publicar la página sin backend.
3. **WhatsApp y Telegram (workflows 03 y 04).** Necesitan cuentas reales de Meta y Telegram.
4. **`docker-compose.yml`.** No había Docker; solo se validó que el archivo esté bien escrito.

## Prueba rápida en vivo (5 minutos)

1. Abre `https://drj-backend.onrender.com/api/salud`. Debe decir `"base_datos":"ok"`. Si el servicio estaba dormido, tarda alrededor de un minuto.
2. Abre la página. No debe aparecer el aviso amarillo.
3. Escribe `pastillas delanteras para fz 2.0 2018` → agrega la opción 1 → **Ver cotización** → **Hacer pedido** → llena el formulario → **Sí, confirmo**. Debe salir un código `PED-…`.
4. Entra a `/admin` con el usuario que creaste en Render y busca ese pedido en **Pedidos**.

## Antes de usarlo con clientes reales

Está en [PENDIENTES_PRODUCCION.md](PENDIENTES_PRODUCCION.md). Lo principal:

- Quitar los datos DEMO: `CARGAR_DEMO=false` en Render y ejecutar `borrar_demo.sql`.
- Cargar el inventario y las compatibilidades reales.
- Confirmar los datos del negocio en el panel.
- Publicar la política de datos personales.
- Pasar la base de datos a un plan con backups, porque la gratis de Render vence.
