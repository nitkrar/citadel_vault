/**
 * write-version.js — Write version.json to public/ after build.
 * Accessible at /version.json to check deployed version.
 */
import { readFileSync, writeFileSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = resolve(__dirname, '..');
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));

let buildNum = 0;
try {
  buildNum = parseInt(readFileSync(resolve(root, '.build-number'), 'utf8').trim(), 10);
} catch { /* */ }

const now = new Date();
const date = now.toISOString().slice(0, 10).replace(/-/g, '');
const buildId = `${date}.${buildNum}`;

const version = {
  version: pkg.version,
  build: buildId,
  built_at: now.toISOString(),
};

writeFileSync(
  resolve(root, 'public', 'version.json'),
  JSON.stringify(version, null, 2) + '\n'
);

console.log(`Wrote version.json: v${version.version} #${version.build}`);
