// Permascape 3D local server: serves the built app, proxies and caches the outside data
// sources, and stores projects as JSON files. Port 8140 (8142 for tests), 127.0.0.1 only.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeSources } from './sources.mjs';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.env.PERMASCAPE_PORT || 8140);
const DATA = path.resolve(process.env.PERMASCAPE_DATA || path.join(ROOT, 'data'));
const DIST = path.join(ROOT, 'dist');
const PROJECTS = path.join(DATA, 'projects');
const STARTED = new Date().toISOString();
fs.mkdirSync(PROJECTS, { recursive: true });

const sources = makeSources(path.join(DATA, 'cache'));

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.json': 'application/json',
  '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

const send = (res, code, body, type = 'application/json') => {
  res.writeHead(code, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(type === 'application/json' ? JSON.stringify(body) : body);
};

const readBody = (req, limit = 60 * 1024 * 1024) => new Promise((resolve, reject) => {
  const chunks = []; let size = 0;
  req.on('data', (c) => { size += c.length; if (size > limit) { reject(new Error('too large')); req.destroy(); } else chunks.push(c); });
  req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
  req.on('error', reject);
});

const num = (v, lo, hi) => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < lo || n > hi) throw Object.assign(new Error(`bad number ${v}`), { status: 400 });
  return n;
};

const projectFile = (id) => {
  if (!/^[a-z0-9-]{1,64}$/.test(id)) throw Object.assign(new Error('bad project id'), { status: 400 });
  return path.join(PROJECTS, id + '.json');
};

async function api(req, res, url) {
  const q = url.searchParams;
  const p = url.pathname;

  if (p === '/api/whoami') return send(res, 200, { app: 'permascape-3d', project: ROOT, data: DATA, pid: process.pid, started: STARTED });

  if (p === '/api/geocode') {
    const text = (q.get('q') || '').trim();
    if (!text) return send(res, 400, { error: 'Type an address or coordinates.' });
    return send(res, 200, { results: await sources.geocode(text) });
  }
  if (p === '/api/reverse') return send(res, 200, await sources.reverse(num(q.get('lat'), -90, 90), num(q.get('lon'), -180, 180)));

  if (p === '/api/terrain') {
    const n = num(q.get('n') || 128, 16, 512);
    if (![64, 128, 256].includes(n)) return send(res, 400, { error: 'n must be 64, 128 or 256' });
    const t = await sources.terrain(num(q.get('lat'), -85, 85), num(q.get('lon'), -180, 180), num(q.get('size'), 20, 5000), n, q.get('source') || 'auto');
    return send(res, 200, t);
  }

  const tm = p.match(/^\/api\/tile\/(\d{1,2})\/(\d{1,7})\/(\d{1,7})$/);
  if (tm) {
    const [z, x, y] = tm.slice(1).map(Number);
    if (z > 20 || x >= 2 ** z || y >= 2 ** z) return send(res, 400, { error: 'tile out of range' });
    const buf = await sources.tile(z, x, y);
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'max-age=604800' });
    return res.end(buf);
  }

  if (p === '/api/climate') return send(res, 200, await sources.climate(num(q.get('lat'), -90, 90), num(q.get('lon'), -180, 180)));
  if (p === '/api/wildplants') return send(res, 200, await sources.wildPlants(num(q.get('lat'), -90, 90), num(q.get('lon'), -180, 180)));
  if (p === '/api/soil') return send(res, 200, await sources.soil(num(q.get('lat'), -90, 90), num(q.get('lon'), -180, 180)));

  if (p === '/api/projects' && req.method === 'GET') {
    const list = fs.readdirSync(PROJECTS).filter((f) => f.endsWith('.json')).map((f) => {
      try {
        const j = JSON.parse(fs.readFileSync(path.join(PROJECTS, f), 'utf8'));
        return { id: j.id, name: j.name, address: j.site?.address || '', updated: j.updated, size: j.site?.size, objects: (j.objects || []).length, thumb: j.thumb || null };
      } catch { return null; }
    }).filter(Boolean).sort((a, b) => String(b.updated).localeCompare(String(a.updated)));
    return send(res, 200, { projects: list });
  }

  const pm = p.match(/^\/api\/projects\/([^/]+)$/);
  if (pm) {
    const file = projectFile(pm[1]);
    if (req.method === 'GET') {
      if (!fs.existsSync(file)) return send(res, 404, { error: 'No such project' });
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      return res.end(fs.readFileSync(file));
    }
    if (req.method === 'PUT') {
      const body = JSON.parse(await readBody(req));
      if (body.id !== pm[1]) return send(res, 400, { error: 'id mismatch' });
      body.updated = new Date().toISOString();
      const tmp = file + '.tmp';
      fs.writeFileSync(tmp, JSON.stringify(body));
      fs.renameSync(tmp, file);
      return send(res, 200, { ok: true, updated: body.updated });
    }
    if (req.method === 'DELETE') {
      if (fs.existsSync(file)) fs.renameSync(file, file + '.deleted-' + Date.now());
      return send(res, 200, { ok: true });
    }
  }

  return send(res, 404, { error: 'unknown endpoint' });
}

function serveStatic(req, res, url) {
  let rel = decodeURIComponent(url.pathname);
  if (rel === '/') rel = '/index.html';
  const file = path.join(DIST, path.normalize(rel));
  if (!file.startsWith(DIST)) return send(res, 403, 'forbidden', 'text/plain');
  const target = fs.existsSync(file) && fs.statSync(file).isFile() ? file : path.join(DIST, 'index.html');
  if (!fs.existsSync(target)) return send(res, 503, 'The app is not built yet. Run: npm run build', 'text/plain');
  res.writeHead(200, { 'content-type': MIME[path.extname(target)] || 'application/octet-stream', 'cache-control': target.includes('/assets/') ? 'max-age=31536000' : 'no-store' });
  fs.createReadStream(target).pipe(res);
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://127.0.0.1');
  try {
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    const status = e.status || 502;
    if (!res.headersSent) send(res, status, { error: e.message || String(e) });
    else res.end();
    if (status >= 500) console.error(new Date().toISOString(), url.pathname, e.message);
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is taken by something else. Not starting.`);
    process.exit(3);
  }
  throw e;
});

server.listen(PORT, '127.0.0.1', () => console.log(`Permascape 3D on http://127.0.0.1:${PORT}  (data: ${DATA})`));
