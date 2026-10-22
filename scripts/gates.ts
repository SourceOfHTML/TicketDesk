import { spawnSync } from 'node:child_process';

const gates = ['lint', 'typecheck', 'format:check', 'test'];
const failed: string[] = [];

// Run every gate: one failing gate must not hide the state of the others.
for (const gate of gates) {
  console.log(`\n▶ ${gate}\n`);
  const result = spawnSync('pnpm', ['run', gate], {
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  if (result.status !== 0) {
    failed.push(gate);
  }
}

if (failed.length > 0) {
  console.error(`\nGates failed: ${failed.join(', ')}`);
  process.exit(1);
}

console.log('\nAll gates passed.');
