import { cpSync, mkdirSync } from 'node:fs';
mkdirSync('dist/web', { recursive: true });
cpSync('.next/standalone', 'dist/web', { recursive: true });
cpSync('.next/static', 'dist/web/.next/static', { recursive: true });
console.log('Standalone web packaged at dist/web.');
