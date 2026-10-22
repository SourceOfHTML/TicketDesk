import type { INestApplication } from '@nestjs/common';

/**
 * Everything main.ts and the HTTP tests must agree on. Keeping it here means a
 * test cannot boot an app that differs from the one the browser talks to.
 */
export function configureApp(app: INestApplication): void {
  app.setGlobalPrefix('api');
}
