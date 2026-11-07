# Renders 3D de repuestos

Las imágenes de `frontend/src/assets/repuestos/` (disco de freno, kit de arrastre,
bujía y filtro de aceite) son renders 3D generados con three.js: geometría
modelada por código, materiales metálicos PBR e iluminación de estudio con
contraluz azul de la marca. No usan fotos de terceros, así que no hay problemas
de licencia.

Se sirven como WebP con transparencia en dos tamaños (480 y 960 px) para `srcset`.

## Volver a generarlas

```bash
cd frontend/herramientas/renders
npm init -y && npm i three@0.169.0 sharp@0.33.5 playwright
python3 -m http.server 8899 &          # sirve render.html
node tomar.cjs disc sprocket plug filter   # crea out-<pieza>.png (1400 px)
```

Luego se recortan y convierten a WebP (por ejemplo con `sharp`:
`trim()` + `resize(480|960)` + `webp({ quality: 82 })`).

> Cuando tengan fotos reales del inventario, basta con reemplazar los archivos
> manteniendo los mismos nombres.
