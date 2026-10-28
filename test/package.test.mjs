// What a buyer gets: a download that starts with a double-click on a fresh Mac. The built app
// ships in dist/ and must match the source (or the launcher would try a slow rebuild), the
// launcher fetches its own pinned Node, and READ ME FIRST is plain and true.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { sourceHash, builtHash } from '../scripts/source-hash.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('dist/ is built from the source as it is now (run npm run build before committing)', () => {
  assert.ok(fs.existsSync(path.join(ROOT, 'dist/index.html')), 'dist/index.html is missing');
  assert.equal(builtHash(), sourceHash(), 'the source changed since the last build: run npm run build');
  assert.ok(!read('.gitignore').split('\n').includes('dist'), 'dist must be committed so a download needs no build');
});

test('the server needs only one package at run time', () => {
  const pkg = JSON.parse(read('package.json'));
  assert.deepEqual(Object.keys(pkg.dependencies), ['pngjs']);
  for (const f of fs.readdirSync(path.join(ROOT, 'server'))) {
    const imports = [...read(`server/${f}`).matchAll(/from '([^'.][^']*)'/g)].map((m) => m[1]).filter((m) => !m.startsWith('node:'));
    for (const m of imports) assert.ok(m in pkg.dependencies, `server/${f} imports ${m}, which a buyer install would not have`);
  }
});

test('the launcher fetches a pinned, checksummed Node and says how long things take', () => {
  for (const f of ['scripts/start-permascape.sh', 'scripts/setup.sh']) execFileSync('/bin/bash', ['-n', path.join(ROOT, f)]);
  const setup = read('scripts/setup.sh');
  assert.match(setup, /NODE_VERSION="v22\.23\.4"/);
  assert.match(setup, /NODE_SHA_x64="[0-9a-f]{64}"/);
  assert.match(setup, /NODE_SHA_arm64="[0-9a-f]{64}"/);
  const launch = read('scripts/start-permascape.sh');
  assert.match(launch, /scripts\/setup\.sh/);
  assert.match(launch, /source-hash\.mjs" --check/);
  assert.ok(!/about 20 seconds/.test(launch), 'no promise the build cannot keep');
});

test('READ ME FIRST is the true double-click path, with the Gatekeeper step, in plain words', () => {
  const t = read('READ ME FIRST.txt');
  assert.match(t, /RIGHT-CLICK/);
  assert.match(t, /Open Anyway/);
  assert.match(t, /Start Permascape\.command/);
  assert.ok(!/npm|terminal command|git clone/i.test(t), 'no developer steps');
  assert.ok(!/[—–]/.test(t), 'no em or en dashes');
  assert.ok(!/vercel\.app/.test(t));
  assert.ok(!/[—–]/.test(read('index.html')));
  assert.match(read('index.html'), /Opening Permascape 3D/, 'the first screen says it is loading');
});

test('the download carries everything, keeps projects outside the app folder, and says how to make it your own', () => {
  const pkg = read('scripts/package.sh');
  execFileSync('/bin/bash', ['-n', path.join(ROOT, 'scripts/package.sh')]);
  assert.match(pkg, /ci --omit=dev/, 'the server package is bundled');
  assert.match(pkg, /runtime\/node/, 'Node is bundled');
  assert.match(pkg, /\(\$LABEL\)\.zip/, 'one zip per Mac, named the way the store looks for');
  const launch = read('scripts/start-permascape.sh');
  assert.match(launch, /pwd -P/, 'the launcher compares the real folder path with the server');
  assert.match(launch, /Permascape 3D Data/, 'projects default to a folder outside the app');
  const stub = read('Start Permascape.app/Contents/MacOS/start-permascape');
  assert.match(stub, /AppTranslocation/, 'the icon finds its real folder when macOS runs it from a temporary copy');
  const guide = read('CLAUDE.md');
  for (const want of ['npm run dev', 'npm test', 'Ideas to ask']) assert.ok(guide.includes(want), `CLAUDE.md mentions ${want}`);
  assert.ok(!/[—–]/.test(guide) && !/[—–]/.test(read('READ ME FIRST.txt')));
  assert.match(read('READ ME FIRST.txt'), /Permascape 3D Data/, 'READ ME says where projects are saved');
});
