// What a buyer gets: a download that starts with a double-click on a fresh Mac. The built app
// ships in dist/ and must match the source (or the launcher would try a slow rebuild), the
// launcher fetches its own pinned Node, and READ ME FIRST is plain and true.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import http from 'node:http';
import os from 'node:os';
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

// ---------------------------------------------------------------- Windows

test('the Windows download: a .cmd with Windows line endings, its own READ ME, and a Windows target in package.sh', () => {
  const cmdFile = path.join(ROOT, 'Start Permascape.cmd');
  if (!fs.existsSync(cmdFile)) return; // a Mac download leaves the Windows launcher out
  const cmd = fs.readFileSync(cmdFile, 'utf8');
  assert.ok(cmd.split('\n').slice(0, -1).every((l) => l.endsWith('\r')), 'every line ends in CRLF');
  assert.match(cmd, /runtime\\node\\node\.exe/);
  assert.match(cmd, /scripts\\start-windows\.mjs/);
  assert.match(cmd, /pause/, 'an error stays on screen');
  const rm = read('READ ME FIRST (Windows).txt');
  assert.match(rm, /Run anyway/, 'the SmartScreen step');
  assert.match(rm, /Extract All/);
  assert.match(rm, /Permascape 3D Data/);
  assert.ok(!/[—–]/.test(rm) && !/npm|git clone/i.test(rm));
  const pkg = read('scripts/package.sh');
  assert.match(pkg, /\(Windows\)\.zip/);
  assert.match(pkg, /NODE_SHA_winx64/);
  assert.match(read('scripts/setup.sh'), /NODE_SHA_winx64="[0-9a-f]{64}"/);
  assert.match(read('.gitattributes'), /\*\.cmd text eol=crlf/);
});

const freePort = () => new Promise((resolve) => { const s = net.createServer().listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => resolve(p)); }); });
const runLauncher = (port, data, logs) => new Promise((resolve) => {
  const c = spawn(process.execPath, [path.join(ROOT, 'scripts/start-windows.mjs')], { env: { ...process.env, PERMASCAPE_LAUNCH_QUIET: '1', PERMASCAPE_PORT: String(port), PERMASCAPE_DATA: data, PERMASCAPE_LOGDIR: logs } });
  let out = '';
  c.stdout.on('data', (d) => (out += d)); c.stderr.on('data', (d) => (out += d));
  c.on('exit', (code) => resolve({ code, out }));
});

test('the Windows launcher starts the server, reuses it, and refuses a stranger on the port', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ps-winlaunch-'));
  const data = path.join(tmp, 'data'), logs = path.join(tmp, 'logs');
  const port = await freePort();
  let pid;
  try {
    const first = await runLauncher(port, data, logs);
    assert.equal(first.code, 0, first.out);
    const who = await (await fetch(`http://127.0.0.1:${port}/api/whoami`)).json();
    pid = who.pid;
    assert.equal(who.app, 'permascape-3d');
    assert.equal(fs.realpathSync(who.data), fs.realpathSync(data), 'projects go where the launcher said');
    assert.ok(fs.existsSync(path.join(logs, 'launcher.log')));
    const again = await runLauncher(port, data, logs);
    assert.equal(again.code, 0, again.out);
    assert.equal((await (await fetch(`http://127.0.0.1:${port}/api/whoami`)).json()).pid, pid, 'the running server is reused, not doubled');
  } finally { if (pid) try { process.kill(pid); } catch { /* gone */ } }

  // something else answering on the port is never reused or driven
  const port2 = await freePort();
  const stranger = http.createServer((q, r) => { r.writeHead(200, { 'content-type': 'application/json' }); r.end('{"app":"someone-else"}'); }).listen(port2, '127.0.0.1');
  try {
    const r = await runLauncher(port2, data, logs);
    assert.equal(r.code, 1);
    assert.match(r.out, /different program/);
  } finally { stranger.close(); fs.rmSync(tmp, { recursive: true, force: true }); }
});
