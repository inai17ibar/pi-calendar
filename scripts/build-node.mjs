// Bundle the sync worker and CLI into self-contained Node ESM files (node:sqlite is a Node builtin).
import { build } from 'rolldown';
for (const [entry, file] of [['src/worker/main.ts', 'dist/worker.mjs'], ['src/cli/main.ts', 'dist/cli.mjs']]) {
  await build({ input: entry, platform: 'node', logLevel: 'warn', output: { file, format: 'esm' } });
}
console.log('Bundled dist/worker.mjs and dist/cli.mjs.');
