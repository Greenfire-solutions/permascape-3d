// THE PERMASCAPE 3D LAUNCH LOGIC FOR WINDOWS. "Start Permascape.cmd" runs this with the Node.js
// that ships in runtime\node, so nothing has to be installed. It does what
// scripts/start-permascape.sh does on a Mac:
//
//   - asks whatever is on the port who it is (liveness is not identity) and only reuses a
//     Permascape 3D from this same folder; restarts it if the server code is newer
//   - keeps projects outside the app folder (%USERPROFILE%\Permascape 3D Data), so a new
//     version can replace the folder without losing them
//   - rebuilds the app only when someone changed the source
//   - starts the server in the background and opens the browser
//
// Logs: %LOCALAPPDATA%\Permascape3D\launcher.log and server.log.
// PERMASCAPE_LAUNCH_QUIET=1 opens no browser (tests). PERMASCAPE_PORT picks another port.
// Plain Node with no Windows-only calls except opening the browser, so it is tested on a Mac too.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const WIN = process.platform === 'win32';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const QUIET = process.env.PERMASCAPE_LAUNCH_QUIET === '1';
const PORT = Number(process.env.PERMASCAPE_PORT || 8140);
const URL = `http://127.0.0.1:${PORT}`;
const APP_ID = 'permascape-3d';
const LOGDIR = process.env.PERMASCAPE_LOGDIR || (WIN ? path.join(process.env.LOCALAPPDATA || os.homedir(), 'Permascape3D') : path.join(os.homedir(), 'Library', 'Logs', 'Permascape3D'));
const LOG = path.join(LOGDIR, 'launcher.log');
const SRVLOG = path.join(LOGDIR, 'server.log');
const DATA = process.env.PERMASCAPE_DATA
  || (fs.existsSync(path.join(ROOT, 'data', 'projects')) ? path.join(ROOT, 'data') : path.join(os.homedir(), 'Permascape 3D Data'));

fs.mkdirSync(LOGDIR, { recursive: true });
const say = (m) => { try { fs.appendFileSync(LOG, `[${new Date().toISOString()}] ${m}\n`); } catch { /* no log */ } };
const tell = (m) => { if (!QUIET) console.log(m); say(m); };
const die = (m) => { say(`FAILED: ${m}`); console.error(`\n${m}\n\nDetails: ${LOG}\n`); process.exit(1); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
// Windows paths compare without regard to case or slash direction
const same = (a, b) => (WIN ? path.resolve(a).toLowerCase() === path.resolve(b).toLowerCase() : path.resolve(a) === path.resolve(b));

async function whoami() {
  try {
    const r = await fetch(`${URL}/api/whoami`, { signal: AbortSignal.timeout(3000) });
    return r.ok ? await r.json() : { stranger: true };
  } catch (e) {
    // refused: nothing is listening. Anything else (a timeout, not JSON) is someone else on the port.
    return /ECONNREFUSED/.test(String(e?.cause?.code || e?.cause?.message || e?.message)) ? null : { stranger: true };
  }
}
const isOurs = (w) => !!w && w.app === APP_ID && same(w.project, ROOT);

/** The server code is read once at start: a server started before the newest server file was saved is stale. */
function stale(w) {
  const started = Date.parse(w.started || '');
  if (!started) return false;
  const newest = Math.max(...fs.readdirSync(path.join(ROOT, 'server')).map((f) => fs.statSync(path.join(ROOT, 'server', f)).mtimeMs));
  return newest > started;
}

async function stop(pid) {
  try { process.kill(pid); } catch { /* already gone */ }
  for (let i = 0; i < 20 && (await whoami()); i++) await sleep(500);
}

function npm(args) {
  // npm.cmd needs a shell on Windows; on a Mac (tests) npm sits next to node
  const dir = path.dirname(process.execPath);
  const bin = WIN ? path.join(dir, 'npm.cmd') : path.join(dir, 'npm');
  const r = spawnSync(WIN ? `"${bin}"` : bin, args, { cwd: ROOT, shell: WIN, stdio: ['ignore', fs.openSync(SRVLOG, 'a'), fs.openSync(SRVLOG, 'a')] });
  return r.status === 0;
}

function openBrowser() {
  if (QUIET) { say(`quiet: not opening ${URL}`); return; }
  if (WIN) spawn('cmd.exe', ['/c', 'start', '""', URL], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
  else spawn('open', [URL], { detached: true, stdio: 'ignore' }).unref();
}

async function main() {
  say(`--- launch --- root: ${ROOT} node: ${process.version}`);
  if (!fs.existsSync(path.join(ROOT, 'server', 'server.mjs'))) die(`Can't find Permascape 3D.\nExpected: ${path.join(ROOT, 'server', 'server.mjs')}\nKeep the whole Permascape 3D folder together.`);
  if (Number(process.versions.node.split('.')[0]) < 20) die('Permascape 3D needs Node.js 20 or newer. Download Permascape 3D again: it brings its own.');

  if (!fs.existsSync(path.join(ROOT, 'node_modules', 'pngjs', 'package.json'))) {
    tell('First start: setting up, usually under a minute...');
    if (!npm(['install', '--omit=dev', '--no-audit', '--no-fund'])) die('Setting up failed. Check the internet connection and start Permascape again.');
  }

  // rebuild only when the source no longer matches the build in dist\ (someone changed the code)
  const check = spawnSync(process.execPath, [path.join(ROOT, 'scripts', 'source-hash.mjs'), '--check'], { cwd: ROOT });
  if (check.status !== 0) {
    if (!fs.existsSync(path.join(ROOT, 'node_modules', 'vite'))) {
      tell("The app's code was changed, so it must be rebuilt. Getting the build tools first: 3 to 10 minutes...");
      if (!npm(['install', '--no-audit', '--no-fund'])) die('Getting the build tools failed.');
    }
    tell('Rebuilding Permascape 3D: 1 to 5 minutes. The page opens by itself when it is ready...');
    if (!npm(['run', 'build'])) die('Building the app failed.');
  }
  if (!fs.existsSync(path.join(ROOT, 'dist', 'index.html'))) die('The app is missing its dist folder. Download Permascape 3D again and keep the whole folder together.');

  const w = await whoami();
  if (isOurs(w)) {
    if (!stale(w)) { tell('Permascape 3D is already running. Opening it.'); openBrowser(); return; }
    say('running server predates the code, restarting it');
    await stop(w.pid);
  } else if (w && w.app === APP_ID && w.data && same(w.data, DATA)) {
    say('stopping a Permascape 3D from another folder that serves the same projects');
    await stop(w.pid);
  } else if (w && w.app === APP_ID) {
    die(`Another copy of Permascape 3D is already running on port ${PORT}, from a different folder.\nClose that one first, then start Permascape again.`);
  } else if (w) {
    die(`Port ${PORT} is being used by a different program, so Permascape 3D was not started.\nClose that program, then start Permascape again.`);
  }

  tell('Starting Permascape 3D...');
  say(`starting server (data: ${DATA})`);
  const out = fs.openSync(SRVLOG, 'a');
  const child = spawn(process.execPath, ['--no-warnings', path.join(ROOT, 'server', 'server.mjs')], {
    cwd: ROOT, detached: true, windowsHide: true, stdio: ['ignore', out, out],
    env: { ...process.env, PERMASCAPE_DATA: DATA, PERMASCAPE_PORT: String(PORT) },
  });
  let exited = false;
  child.on('exit', () => { exited = true; });
  child.unref();

  for (let i = 0; i < 60 && !exited; i++) {
    if (isOurs(await whoami())) { tell(`Permascape 3D is running at ${URL}. You can close this window; it keeps running.`); openBrowser(); return; }
    await sleep(500);
  }
  die(`Permascape 3D did not start.\nServer log: ${SRVLOG}`);
}

main().catch((e) => die(`Permascape 3D could not start: ${e.message}`));
