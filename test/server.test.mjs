// Starts its own server on 8142 against a throwaway data folder and proves it is talking to
// THAT process (pid from /api/whoami) before touching anything. Never uses the live data.
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8142;
const B = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'permascape-test-'));
let child;

test.before(async () => {
  child = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs')], { env: { ...process.env, PERMASCAPE_PORT: String(PORT), PERMASCAPE_DATA: DATA }, stdio: 'pipe' });
  let exited = null;
  child.on('exit', (c) => { exited = c; });
  for (let i = 0; i < 50; i++) {
    if (exited !== null) throw new Error(`test server exited with ${exited}; is ${PORT} taken?`);
    try {
      const w = await (await fetch(`${B}/api/whoami`)).json();
      if (w.app === 'permascape-3d' && w.pid === child.pid) return;
      throw new Error(`port ${PORT} answered as someone else (${w.app} pid ${w.pid})`);
    } catch (e) { if (String(e.message).includes('answered')) throw e; }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('test server did not start');
});

test.after(() => { child?.kill(); fs.rmSync(DATA, { recursive: true, force: true }); });

test('whoami names the app, folder and data dir', async () => {
  const w = await (await fetch(`${B}/api/whoami`)).json();
  assert.equal(w.app, 'permascape-3d');
  assert.equal(w.project, ROOT);
  assert.equal(w.data, DATA);
});

test('projects: save, list, load, delete', async () => {
  const p = { id: 'test-site-1', name: 'Test site', version: 1, created: new Date().toISOString(), site: { address: 'Nowhere', size: 100 }, objects: [{ id: 'a' }], features: [], heights: '', originalHeights: '' };
  const put = await fetch(`${B}/api/projects/${p.id}`, { method: 'PUT', body: JSON.stringify(p) });
  assert.equal(put.status, 200);
  const list = (await (await fetch(`${B}/api/projects`)).json()).projects;
  assert.equal(list.length, 1);
  assert.equal(list[0].objects, 1);
  const got = await (await fetch(`${B}/api/projects/${p.id}`)).json();
  assert.equal(got.name, 'Test site');
  assert.ok(got.updated);
  assert.equal((await fetch(`${B}/api/projects/${p.id}`, { method: 'DELETE' })).status, 200);
  assert.equal((await (await fetch(`${B}/api/projects`)).json()).projects.length, 0);
  assert.equal((await fetch(`${B}/api/projects/${p.id}`)).status, 404);
});

test('refuses bad ids, mismatched ids and bad numbers', async () => {
  assert.equal((await fetch(`${B}/api/projects/..%2Fetc`)).status, 400);
  assert.equal((await fetch(`${B}/api/projects/abc`, { method: 'PUT', body: JSON.stringify({ id: 'xyz' }) })).status, 400);
  assert.equal((await fetch(`${B}/api/terrain?lat=999&lon=0&size=100&n=128`)).status, 400);
  assert.equal((await fetch(`${B}/api/terrain?lat=40&lon=0&size=100&n=100`)).status, 400);
  assert.equal((await fetch(`${B}/api/tile/3/99/1`)).status, 400);
  assert.equal((await fetch(`${B}/api/geocode?q=`)).status, 400);
});

test('serves the app shell', async () => {
  const r = await fetch(`${B}/`);
  if (!fs.existsSync(path.join(ROOT, 'dist/index.html'))) return assert.equal(r.status, 503);
  assert.equal(r.status, 200);
  assert.match(await r.text(), /Permascape 3D/);
  assert.equal((await fetch(`${B}/some/deep/link`)).status, 200, 'unknown paths fall back to the app');
});
