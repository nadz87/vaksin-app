import { defineConfig } from 'vitest/config'

// Website unit tests only. The backend's tests (server/auth) need the local Docker stack
// and run with `npm run api:auth-test`, so they stay out of `npm test` and the Pages build.
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
})
