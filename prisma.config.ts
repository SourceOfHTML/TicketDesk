import { defineConfig, env } from 'prisma/config';

// Prisma 7's CLI no longer loads `.env`; this is the one place it is read for the CLI.
// `process.loadEnvFile` defers to an already-set variable, so a test's DATABASE_URL wins.
process.loadEnvFile();

export default defineConfig({
  schema: 'apps/api/prisma/schema.prisma',
  migrations: {
    path: 'apps/api/prisma/migrations',
    seed: 'tsx apps/api/prisma/seed.ts',
  },
  datasource: {
    url: env('DATABASE_URL'),
  },
});
