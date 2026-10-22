import { copyFileSync, existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';

const root = process.cwd();
const envPath = join(root, '.env');

if (!existsSync(envPath)) {
  copyFileSync(join(root, '.env.example'), envPath);
  console.log('Created .env from .env.example');
}

function run(args: string[]) {
  const result = spawnSync('pnpm', ['exec', ...args], {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}

run(['prisma', 'generate']);
run(['prisma', 'migrate', 'deploy']);
run(['prisma', 'db', 'seed']);
