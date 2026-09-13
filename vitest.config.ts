import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    // Modules validate the environment on import; unit tests never touch the network or database
    env: {
      DATABASE_URL: 'postgresql://test:test@localhost:5432/test',
      GEMINI_API_KEY: 'test-key',
      LOG_LEVEL: 'error',
      NODE_ENV: 'test',
    },
  },
});
