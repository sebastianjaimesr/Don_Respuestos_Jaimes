import { defineConfig } from 'vitest/config';

// Las pruebas de integración usan una base PostgreSQL REAL y separada (drj_test).
// Puedes cambiarla con TEST_DATABASE_URL.
const DB = process.env.TEST_DATABASE_URL ?? 'postgres://postgres@localhost:5432/drj_test';

export default defineConfig({
  test: {
    env: {
      NODE_ENV: 'test',
      DATABASE_URL: DB,
      JWT_SECRET: 'secreto-solo-para-pruebas-0123456789abcdef',
      WEBHOOK_SECRET: 'webhook-secreto-solo-para-pruebas-0123456789',
      N8N_NOTIFICACION_URL: 'http://127.0.0.1:4599/notificar',
      RATE_LIMIT_CHAT_POR_MINUTO: '10000',
      RATE_LIMIT_LOGIN_POR_15MIN: '10000',
    },
    globalSetup: './tests/globalSetup.ts',
    fileParallelism: false,
    testTimeout: 20000,
    hookTimeout: 30000,
  },
});
