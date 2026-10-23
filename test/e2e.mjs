// End-to-end: real server (own port 8142, throwaway data), real headless Chrome over a pipe,
// real mouse events on the 3D canvas. Types an address, builds the site, uses the tools,
// saves, reloads and checks the design came back. Needs network for the data sources.
//   npm run build && node test/e2e.mjs [--shots dir]
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8142, B = `http://127.0.0.1:${PORT}`;
const DATA = fs.mkdtempSync(path.join(os.tmpdir(), 'permascape-e2e-'));
const shotsAt = process.argv.indexOf('--shots');
const SHOTS = shotsAt > 0 ? process.argv[shotsAt + 1] : null;
const ADDRESS = process.env.E2E_ADDRESS || '39.99885, -105.28420'; // Boulder foothills: real slope, USGS lidar
const CHROME = process.env.CHROME_PATH || '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pass = 0, fail = 0;
const check = (name, ok, extra = '') => { console.log(`  ${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? `  (${extra})` : ''}`); ok ? pass++ : fail++; };

// ---- server
const server = spawn(process.execPath, [path.join(ROOT, 'server/server.mjs')], { env: { ...process.env, PERMASCAPE_PORT: String(PORT), PERMASCAPE_DATA: DATA }, stdio: 'pipe' });
let serverLog = '';
server.stdout.on('data', (d) => { serverLog += d; }); server.stderr.on('data', (d) => { serverLog += d; });
for (let i = 0; ; i++) {
  try { const w = await (await fetch(`${B}/api/whoami`)).json(); if (w.app === 'permascape-3d' && w.pid === server.pid) break; throw new Error(`port ${PORT} is someone else`); }
  catch (e) { if (String(e.message).includes('someone')) { console.error(e.message); process.exit(1); } }
  if (i > 50) { console.error('server did not start', serverLog); process.exit(1); }
  await sleep(100);
}

// ---- chrome over a pipe
const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'permascape-chrome-'));
const chrome = spawn(CHROME, ['--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader',
  '--remote-debugging-pipe', `--user-data-dir=${profile}`, '--no-first-run', '--no-default-browser-check', '--disable-extensions',
  '--window-size=1500,950', '--hide-scrollbars', 'about:blank'], { stdio: ['ignore', 'ignore', 'pipe', 'pipe', 'pipe'] });
chrome.stderr.on('data', () => {});
const wr = chrome.stdio[3], rd = chrome.stdio[4];
let nextId = 0, buf = Buffer.alloc(0);
const pending = new Map(), errors = [];
rd.on('data', (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  let i;
  while ((i = buf.indexOf(0)) !== -1) {
    let m; try { m = JSON.parse(buf.subarray(0, i).toString()); } catch { m = null; }
    buf = buf.subarray(i + 1);
    if (!m) continue;
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(JSON.stringify(m.error))) : p.resolve(m.result); }
    else if (m.method === 'Runtime.exceptionThrown') errors.push('EXCEPTION ' + (m.params.exceptionDetails?.exception?.description || m.params.exceptionDetails?.text));
    else if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errors.push('console ' + m.params.args.map((a) => a.value ?? a.description).join(' '));
    else if (m.method === 'Log.entryAdded' && m.params.entry.level === 'error') errors.push('log ' + m.params.entry.text + ' ' + (m.params.entry.url || ''));
  }
});
let S;
const send = (method, params = {}) => new Promise((resolve, reject) => { const id = ++nextId; pending.set(id, { resolve, reject }); wr.write(JSON.stringify({ id, method, params, ...(S ? { sessionId: S } : {}) }) + '\0'); });
const js = async (expr) => { const r = await send('Runtime.evaluate', { expression: expr, awaitPromise: true, returnByValue: true }); if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description); return r.result.value; };
const until = async (expr, ms = 20000) => { const end = Date.now() + ms; while (Date.now() < end) { try { const v = await js(expr); if (v) return v; } catch { /* page reloading */ } await sleep(250); } return null; };
const clickSel = (sel) => js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(sel)})][0]; if (!el) return false; el.click(); return true; })()`);
const clickText = (tag, text) => js(`(() => { const el = [...document.querySelectorAll(${JSON.stringify(tag)})].find(e => e.textContent.trim().startsWith(${JSON.stringify(text)})); if (!el) return false; el.click(); return true; })()`);
const typeInto = (sel, value) => js(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, ${JSON.stringify(value)}); el.dispatchEvent(new Event('input', { bubbles: true })); return true; })()`);
const mouse = async (type, x, y, extra = {}) => send('Input.dispatchMouseEvent', { type, x, y, button: 'left', buttons: type === 'mouseReleased' ? 0 : 1, clickCount: 1, ...extra });
const clickAt = async (x, y, extra) => { await mouse('mouseMoved', x, y, { buttons: 0 }); await mouse('mousePressed', x, y, extra); await mouse('mouseReleased', x, y, extra); await sleep(150); };
const screen = (x, y) => js(`window.__psView.project(${x}, ${y})`);
const state = () => js('JSON.parse(JSON.stringify(window.__ps))');
const shot = async (name) => { if (!SHOTS) return; await sleep(400); const r = await send('Page.captureScreenshot', { format: 'png' }); fs.mkdirSync(SHOTS, { recursive: true }); fs.writeFileSync(path.join(SHOTS, name + '.png'), Buffer.from(r.data, 'base64')); };

try {
  const { targetId } = await send('Target.createTarget', { url: 'about:blank' });
  S = (await send('Target.attachToTarget', { targetId, flatten: true })).sessionId;
  await send('Runtime.enable'); await send('Page.enable'); await send('Log.enable').catch(() => {});
  await send('Page.navigate', { url: B + '/' });

  console.log('\n== start screen and site build ==');
  check('start screen asks for an address', !!(await until(`!!document.querySelector("input[placeholder^='Address']")`)));
  await typeInto("input[placeholder^='Address']", ADDRESS);
  await clickText('button', 'Find');
  // several matches: pick the first, as a person would
  if (await until(`!!document.querySelector('[data-geo-results] button') || [...document.querySelectorAll('button')].some(b => b.textContent.includes('Build this site'))`, 20000)) await clickSel('[data-geo-results] button');
  check('the place is found', !!(await until(`[...document.querySelectorAll('button')].some(b => b.textContent.includes('Build this site'))`)));
  await js(`(() => { const s = [...document.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === '200')); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '200'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await clickText('button', 'Build this site');
  check('the site builds and opens', !!(await until(`window.__ps && window.__ps.project && window.__psView`, 90000)));
  const framesA = await js('window.__psView.frames()'); await sleep(3000);
  check('the 3D view is drawing frames', (await js('window.__psView.frames()')) > framesA);
  await clickText('button', 'Site');
  const siteText = await until(`(() => { const t = document.body.innerText; return document.body.textContent.includes('Mean slope') ? 1 : null })()`);
  check('site panel lists the slope', !!siteText);
  const proj = await (await fetch(`${B}/api/projects`)).json();
  check('the new project was saved to disk', proj.projects.length === 1);
  const saved = await (await fetch(`${B}/api/projects/${proj.projects[0].id}`)).json();
  check('terrain came from real data', /USGS|Terrain/.test(saved.site.source), saved.site.source);
  check('climate and zone came back', !!saved.site.climate?.zone, saved.site.climate?.zone?.label);
  check('soil came back', saved.site.soil?.available === true, saved.site.soil?.mapUnit);
  check('the site has a real place name', !/^-?\d/.test(saved.name) && saved.site.address.length > 10, `${saved.name} | ${saved.site.address}`);
  await shot('01-site');

  console.log('\n== hover readout ==');
  const c = await screen(0, 0);
  await mouse('mouseMoved', c.x, c.y, { buttons: 0 });
  check('hovering shows elevation and slope', !!(await until(`document.body.innerText.includes('Elev ') && document.body.innerText.includes('Slope ')`, 5000)));

  console.log('\n== placing things ==');
  await clickSel("button[title^='Plant']");
  for (const [x, y] of [[-20, 10], [-10, 10], [0, 10]]) { const p = await screen(x, y); await clickAt(p.x, p.y); }
  let st = await state();
  check('three trees planted', st.objects.filter((o) => o.type === 'plant').length === 3, `${st.objects.length} objects`);
  check('the last one is selected with its record open', !!(await until(`document.body.innerText.includes('Selected: Plant')`, 3000)));
  await clickSel("button[title^='Building']");
  { const p = await screen(20, -20); await clickAt(p.x, p.y); }
  await clickSel("button[title^='Pond']");
  { const p = await screen(-30, -40); await clickAt(p.x, p.y); }
  st = await state();
  const pond = st.objects.find((o) => o.type === 'pond');
  check('a building and a pond were placed', st.objects.some((o) => o.type === 'building') && !!pond);
  check('the pond has a water level', pond && typeof pond.waterLevel === 'number');
  await shot('02-placed');

  console.log('\n== earthworks ==');
  await clickSel("button[title^='Swale on contour']");
  { const p = await screen(10, 40); await mouse('mouseMoved', p.x, p.y, { buttons: 0 }); await sleep(300); await clickAt(p.x, p.y); }
  st = await state();
  check('a swale was dug on contour', st.features.some((f) => f.kind === 'swale'), st.features.map((f) => f.name).join(', '));
  await clickSel("button[title^='Path']");
  { const a = await screen(-40, 0), b = await screen(30, 0);
    await mouse('mouseMoved', a.x, a.y, { buttons: 0 }); await mouse('mousePressed', a.x, a.y);
    for (let k = 1; k <= 12; k++) await mouse('mouseMoved', a.x + ((b.x - a.x) * k) / 12, a.y + ((b.y - a.y) * k) / 12);
    await mouse('mouseReleased', b.x, b.y); await sleep(200); }
  st = await state();
  check('a path was drawn', st.features.some((f) => f.kind === 'path'));
  await clickSel("button[title^='Zone']");
  for (const [x, y] of [[-60, 60], [60, 60], [60, -60], [-60, -60]]) { const p = await screen(x, y); await clickAt(p.x, p.y); }
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 'Enter', code: 'Enter', windowsVirtualKeyCode: 13 });
  await sleep(200);
  st = await state();
  check('a zone was drawn and closed', st.features.some((f) => f.kind === 'zone'));

  console.log('\n== zone plant guide ==');
  check('the plant guide opens by itself', !!(await until(`!!document.querySelector('[data-zone-guide]') && document.body.textContent.includes('grow well')`, 20000)));
  const guideCounts = await js(`(() => { const t = document.querySelector('[data-zone-guide]').textContent; const g = t.match(/(\\d+) grow well/); const p = t.match(/(\\d+) possible/); return [g ? +g[1] : 0, p ? +p[1] : 0]; })()`);
  check('the guide recommends plants for this zone and place', guideCounts[0] >= 10, `${guideCounts[0]} grow well, ${guideCounts[1]} possible`);
  check('the guide gives real planting dates', !!(await until(`/(Sow outdoors|Plant out|Plant): [A-Z][a-z]{2} \\d+ to [A-Z][a-z]{2} \\d+/.test(document.querySelector('[data-zone-guide]').textContent)`, 5000)));
  check('sun hours are measured for the zone', !!(await until(`/\\d+\\.\\d hours a day/.test(document.querySelector('[data-zone-guide]').textContent)`, 90000)));
  await shot('08-zone-guide');
  // the zone was drawn as zone 1 (the default): add a vegetable bed
  const n1 = (await state()).objects.length;
  await clickText('[data-zone-guide] button', 'Add a bed');
  await sleep(300);
  const bedAdded = (await state()).objects.slice(n1).find((o) => o.type === 'garden' && o.crop);
  check('"Add a bed" plants a bed with the crop in it', !!bedAdded, bedAdded?.name);
  // switch to zone 2 and fill it with a fruit tree
  await js(`(() => { const s = document.querySelector('[data-zone-guide] select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '2'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check('switching to zone 2 shows the food forest list', !!(await until(`document.querySelector('[data-zone-guide]').textContent.includes('Fruit trees')`, 10000)));
  const n2 = (await state()).objects.length;
  await clickText('[data-zone-guide] button', 'Fill zone');
  await sleep(500);
  const filled = (await state()).objects.slice(n2);
  check('"Fill zone" plans trees at their spacing inside the zone', filled.length > 3 && filled.every((o) => o.type === 'plant' && o.planted), `${filled.length} planted from ${filled[0]?.planted}`);
  await js(`(() => { const s = document.querySelector('[data-zone-guide] select'); const set = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set; set.call(s, '5'); s.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  check('zone 5 shows wild plants recorded nearby', !!(await until(`document.querySelectorAll('[data-zone-guide] a[href*="gbif.org/species"]').length >= 5`, 60000)));
  await shot('09-zone5-wild');
  await clickText('[data-zone-guide] button', 'Know your real zone');
  check('the local climate settings open', !!(await until(`document.body.textContent.includes('Your local climate')`, 3000)));
  await clickText('button', 'Save');
  await sleep(200);
  await js(`document.querySelector('[data-zone-guide] button[title="Close"]').click()`);
  await sleep(200);
  check('the guide closes', !(await js(`!!document.querySelector('[data-zone-guide]')`)));
  await clickSel("button[title^='Raise']");
  { const p = await screen(40, 40); await mouse('mouseMoved', p.x, p.y, { buttons: 0 }); await mouse('mousePressed', p.x, p.y); for (let k = 0; k < 8; k++) await mouse('mouseMoved', p.x + k * 4, p.y); await mouse('mouseReleased', p.x + 28, p.y); await sleep(200); }
  const stepBefore = (await state()).step;
  check('sculpting made a history step', stepBefore > 0, `step ${stepBefore}`);

  console.log('\n== measure ==');
  await clickSel("button[title^='Measure']");
  for (const [x, y] of [[-50, -50], [50, 50]]) { const p = await screen(x, y); await clickAt(p.x, p.y); }
  check('measure reports distance and grade', !!(await until(`document.body.innerText.includes('along the ground') && document.body.innerText.includes('grade')`, 3000)));

  console.log('\n== select, edit and move ==');
  await clickSel("button[title^='Select and move']");
  const tree = (await state()).objects.find((o) => o.type === 'plant');
  { const p = await screen(tree.x, tree.y);
    // aim a little up the trunk so the ray hits the model
    await mouse('mouseMoved', p.x, p.y, { buttons: 0 }); await mouse('mousePressed', p.x, p.y);
    const q = await screen(tree.x + 15, tree.y - 15);
    for (let k = 1; k <= 10; k++) await mouse('mouseMoved', p.x + ((q.x - p.x) * k) / 10, p.y + ((q.y - p.y) * k) / 10);
    await mouse('mouseReleased', q.x, q.y); await sleep(250); }
  const moved = (await state()).objects.find((o) => o.id === tree.id);
  check('dragging a tree moves it', Math.hypot(moved.x - tree.x, moved.y - tree.y) > 5, `${tree.x.toFixed(1)},${tree.y.toFixed(1)} -> ${moved.x.toFixed(1)},${moved.y.toFixed(1)}`);
  check('the dragged tree is selected', (await state()).sel?.id === tree.id);
  await js(`(() => { const el = [...document.querySelectorAll('input')].find(i => i.value === ${JSON.stringify(tree.name)}); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(el, 'Grandma apple'); el.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  await clickText('button', 'Log on');
  await sleep(200);
  const edited = (await state()).objects.find((o) => o.id === tree.id);
  check('renaming and logging on the plant record', edited.name === 'Grandma apple' && edited.events.length >= 2);

  console.log('\n== undo and redo ==');
  const n0 = (await state()).objects.length;
  await clickSel("button[title^='Building']");
  { const p = await screen(-50, 30); await clickAt(p.x, p.y); }
  check('placed one more', (await state()).objects.length === n0 + 1);
  await clickSel("button[title^='Undo']"); await sleep(150);
  check('undo removes it', (await state()).objects.length === n0);
  await clickSel("button[title^='Redo']"); await sleep(150);
  check('redo brings it back', (await state()).objects.length === n0 + 1);

  console.log('\n== analysis overlays ==');
  for (const label of ['Slope', 'Aspect (facing)', 'Elevation']) { await clickText('button', label); await sleep(300); }
  check('slope, aspect and elevation overlays switch', (await state()).overlay === 'elevation');
  await clickText('button', 'Water flow');
  check('water flow analysis runs', !!(await until(`window.__ps.analysis.flow && !window.__ps.busy`, 30000)));
  await shot('03-flow');
  await clickText('button', 'Sun hours');
  check('sun hours study runs', !!(await until(`window.__ps.analysis.sun && !window.__ps.busy`, 60000)));
  await shot('04-sun');
  await clickText('button', 'None');

  console.log('\n== water simulation ==');
  await clickSel("button[title^='Water drop']");
  await clickText('button', 'Start rainfall');
  const f0 = await js('window.__psView.frames()');
  const rained = await until(`window.__psView.particles() > 50`, 30000);
  check('rain falls and runs downhill', !!rained, `particles ${await js('window.__psView.particles()')}, frames ${(await js('window.__psView.frames()')) - f0}`);
  await shot('05-rain');
  await clickText('button', 'Stop rainfall');
  await clickText('button', 'Clear');

  console.log('\n== timeline ==');
  await js(`(() => { const r = [...document.querySelectorAll('input[type=range]')].find(i => i.max === '30'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set; set.call(r, '15'); r.dispatchEvent(new Event('input', { bubbles: true })); })()`);
  check('growth slider moves the view 15 years ahead', !!(await until(`document.body.innerText.includes('+15.0 yrs')`, 3000)));
  await shot('06-15-years');

  console.log('\n== tasks, summary and report ==');
  await clickText('button', 'Tasks and journal');
  check('tasks panel opens', !!(await until(`document.body.innerText.includes('worked out from each plant')`, 3000)));
  await clickText('button', 'Design summary');
  await clickText('button', 'Open the full site report');
  check('site report renders', !!(await until(`document.querySelector('.report-root') && document.body.innerText.includes('Planting schedule')`, 5000)));
  await shot('07-report');
  await clickText('button', 'Close');

  console.log('\n== save and reload ==');
  await send('Input.dispatchKeyEvent', { type: 'keyDown', key: 's', code: 'KeyS', modifiers: 4, windowsVirtualKeyCode: 83 });
  check('save finishes', !!(await until(`window.__ps.saveState === 'saved' && !window.__ps.dirty`, 10000)));
  const before = await state();
  await send('Page.reload');
  await sleep(1500);
  check('reopens the last project on launch', !!(await until(`window.__ps && window.__ps.project === ${JSON.stringify(before.project)} && window.__ps.objects.length === ${before.objects.length}`, 30000)));
  const after = await state();
  check('every element and feature survived', after.objects.length === before.objects.length && after.features.length === before.features.length);
  check('renamed plant kept its name and journal', after.objects.some((o) => o.name === 'Grandma apple' && o.events.length >= 2));

  console.log('\n== exports ==');
  const glbSize = await js(`(async () => { const ok = []; const orig = HTMLAnchorElement.prototype.click; HTMLAnchorElement.prototype.click = function () { ok.push(this.download); }; [...document.querySelectorAll('button')].find(b => b.textContent === 'File').click(); await new Promise(r => setTimeout(r, 100)); [...document.querySelectorAll('button')].find(b => b.textContent.includes('Export 3D model')).click(); await new Promise(r => setTimeout(r, 20000)); HTMLAnchorElement.prototype.click = orig; return ok.join(',') || document.body.textContent.match(/Export failed[^.]*|Building the 3D model file/)?.[0] || 'nothing'; })()`);
  check('3D model export produces a .glb', /\.glb/.test(glbSize || ''), glbSize);
} catch (e) {
  check('no crash in the driver', false, e.message);
} finally {
  const real = errors.filter((e) => !/favicon/.test(e));
  check('no uncaught exceptions or console errors', real.length === 0, real.slice(0, 5).join(' | '));
  console.log(`\n${pass} passed, ${fail} failed`);
  chrome.kill(); server.kill();
  fs.rmSync(DATA, { recursive: true, force: true }); fs.rmSync(profile, { recursive: true, force: true });
  process.exit(fail ? 1 : 0);
}
