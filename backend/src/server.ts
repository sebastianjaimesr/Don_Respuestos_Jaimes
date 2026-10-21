import { crearApp } from './app';
import { config } from './config';
import { pool } from './db';

const app = crearApp();
const servidor = app.listen(config.PORT, () => {
  console.log(`Don Repuestos Jaimes API escuchando en http://localhost:${config.PORT}`);
});

// Cierre ordenado (Ctrl+C o el orquestador detiene el proceso)
for (const senal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(senal, () => {
    servidor.close(() => pool.end().then(() => process.exit(0)));
  });
}
