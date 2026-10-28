#!/usr/bin/env node
// One fingerprint of everything that goes into the built app in dist/.
// `npm run build` writes it to dist/BUILD-SOURCE.txt; the launcher and the tests compare it with
// the source as it is now, so a download that ships dist/ never needs a build, and a commit that
// changed the source without rebuilding is caught by `npm test` instead of by a buyer.
//
//   node scripts/source-hash.mjs           prints the fingerprint of the source
//   node scripts/source-hash.mjs --write   writes it into dist/BUILD-SOURCE.txt
//   node scripts/source-hash.mjs --check   exit 0 when dist/ matches the source, 1 when not
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INPUTS = ['src', 'index.html', 'vite.config.ts', 'tailwind.config.js', 'postcss.config.js', 'tsconfig.json'];
export const STAMP = path.join(ROOT, 'dist', 'BUILD-SOURCE.txt');

function walk(rel, out) {
  const abs = path.join(ROOT, rel);
  if (!fs.existsSync(abs)) return;
  if (fs.statSync(abs).isDirectory()) for (const n of fs.readdirSync(abs).sort()) { if (n !== '.DS_Store') walk(path.join(rel, n), out); }
  else out.push(rel.split(path.sep).join('/'));
}

export function sourceHash() {
  const files = [];
  for (const r of INPUTS) walk(r, files);
  const h = createHash('sha256');
  // package versions decide what the bundle contains, the scripts block does not
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
  h.update(JSON.stringify({ dependencies: pkg.dependencies || {}, devDependencies: pkg.devDependencies || {} }));
  for (const f of files.sort()) { h.update(f + '\0'); h.update(fs.readFileSync(path.join(ROOT, f))); h.update('\0'); }
  return h.digest('hex');
}

export const builtHash = () => { try { return fs.readFileSync(STAMP, 'utf8').trim(); } catch { return null; } };

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const arg = process.argv[2];
  if (arg === '--write') { fs.writeFileSync(STAMP, sourceHash() + '\n'); console.log('dist/BUILD-SOURCE.txt written'); }
  else if (arg === '--check') process.exit(builtHash() === sourceHash() ? 0 : 1);
  else console.log(sourceHash());
}
