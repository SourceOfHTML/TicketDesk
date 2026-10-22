import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { configureApp } from './app.setup';
import { findRepoRoot } from './repo-root';

// The one root .env. pnpm runs this package from apps/api, so resolve the file
// explicitly rather than relying on the working directory. A missing file is
// not fatal here: createAdapter names the problem when the database is opened.
const envPath = join(findRepoRoot(), '.env');
if (existsSync(envPath)) {
  process.loadEnvFile(envPath);
}

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  configureApp(app);
  await app.listen(3001);
}

void bootstrap();
