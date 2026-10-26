// The AI designer. Every answer comes from Claude Code running headless on this Mac
// (`claude -p`) on the owner's own Claude sign-in: no API key is read, and ANTHROPIC_API_KEY is
// removed from the child so a stray key can never start per-token billing.
//
// Each call runs in an empty temp folder with no MCP servers, no skills and no project settings.
// Ask may use web search (nurseries, local rules); Design gets no tools at all. The model only
// ever PROPOSES changes as structured actions; the app shows them and the person applies them.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const CANDIDATES = [process.env.CLAUDE_BIN, path.join(os.homedir(), '.local/bin/claude'), '/usr/local/bin/claude', '/opt/homebrew/bin/claude'].filter(Boolean);

export function claudeBinary() {
  for (const c of CANDIDATES) { try { fs.accessSync(c, fs.constants.X_OK); return c; } catch { /* next */ } }
  return null;
}

const ACTION = {
  type: 'object',
  properties: {
    kind: { type: 'string', enum: ['plant', 'guild', 'hedge', 'zone', 'swale', 'pond', 'structure', 'garden', 'path', 'paddock', 'fence'] },
    label: { type: 'string', description: 'Short name shown on the map, e.g. "Apple guild" or "Zone 1: kitchen garden".' },
    why: { type: 'string', description: 'One sentence: the permaculture reason for this placement on THIS land.' },
    species: { type: 'string', description: 'Plant library id (plant, guild centre tree, hedge tall species, garden crop). Must be one of the ids given.' },
    x: { type: 'number', description: 'Metres east of the site centre.' },
    y: { type: 'number', description: 'Metres north of the site centre.' },
    points: { type: 'array', items: { type: 'array', items: { type: 'number' }, minItems: 2, maxItems: 2 }, description: 'For zone, paddock (polygon corners) and hedge, path, fence (a line): [[x,y],...] in metres.' },
    zone: { type: 'integer', minimum: 0, maximum: 5 },
    structure: { type: 'string', enum: ['building', 'greenhouse', 'tank', 'compost', 'coop', 'hive'] },
    size: { type: 'number', description: 'Pond radius m, swale length m, or tank litres.' },
    width: { type: 'number' },
    depth: { type: 'number' },
    animal: { type: 'string', enum: ['chickens', 'ducks', 'geese', 'goats', 'sheep', 'pigs', 'cattle', 'rabbits'] },
  },
  required: ['kind', 'label', 'why'],
};

const SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'The reply to the person, plain text, short paragraphs and simple lists. No markdown headings, no em dashes.' },
    actions: { type: 'array', items: ACTION, maxItems: 60 },
  },
  required: ['answer', 'actions'],
};

const RULES = `You are Permie, the design assistant inside Permascape 3D, a permaculture site designer.
You are an experienced permaculture designer (PDC teacher level) who knows Mollison, Holmgren, Yeomans' keyline scale of permanence, Toensmeier and Jacke's forest garden work, and regional extension advice.

Coordinates: metres from the site centre, x to the east, y to the north. The site is a square; stay at least 2 m inside its edge.
Everything you add must suit the real land described below: put swales on slopes across the flow above what they water, ponds in low wet spots or below swales, zone 1 next to the house, frost-tender things off the frost pocket, windbreaks across the prevailing or cold wind, sun traps opening to the sun side of the sky for this hemisphere.
Only use plant ids from the PLANT IDS list. Prefer plants marked "good". Never use an id that is not listed.
Do not move or delete what is already placed; build around it and avoid overlapping existing objects (keep trees at least their spread apart).
Write for a practical person, warm and direct. Never use an em dash or en dash; use commas and full stops.
Use "guild" for a fruit or nut tree plus its support plants (the app adds the support plants itself). Use "hedge" with a line of points for windbreaks and hedgerows (the app chooses spacing and a shrub row).
A swale action needs only x, y on sloping ground and a length in size; the app snaps it to the exact contour.`;

export function buildPrompt({ mode, question, context }) {
  const ctx = typeof context === 'string' ? context : JSON.stringify(context, null, 1);
  if (mode === 'design') {
    return `${RULES}

TASK: Draw a complete starter permaculture design for this land, in the order a designer would build it (water and access first, then structures, zones, then plants). Aim for 12 to 40 actions sized to the site. The person's goals and wishes: ${question || 'a productive, low-maintenance homestead food system'}.
In "answer", explain the design in 6 to 10 short lines: the big moves and why they suit this land, then what to do first this season.

THE LAND AND DESIGN SO FAR:
${ctx}`;
  }
  return `${RULES}

TASK: Answer the person's question about their land and design. Be specific to the data below (their climate, slope, soil, plants and dates). If changes on the map would help, propose them as actions (zero actions is fine for a pure question). Keep the answer under 250 words unless they ask for more.

THEIR QUESTION: ${question}

THE LAND AND DESIGN SO FAR:
${ctx}`;
}

let running = 0;
const MAX_PARALLEL = 2;

export async function askClaude({ mode, question, context, model }) {
  const bin = claudeBinary();
  if (!bin) throw Object.assign(new Error('Claude Code is not installed on this Mac. Install it and sign in once by typing claude in Terminal, then try again.'), { status: 503 });
  if (running >= MAX_PARALLEL) throw Object.assign(new Error('Permie is already working on two requests. Try again in a minute.'), { status: 429 });
  running++;
  const started = Date.now();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'permascape-claude-'));
  try {
    const web = mode === 'ask';
    const tools = web ? 'WebSearch,WebFetch' : '';
    const args = ['-p', '--model', model === 'opus' ? 'opus' : 'sonnet', '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMA),
      '--no-session-persistence', '--strict-mcp-config', '--disable-slash-commands', '--setting-sources', '', '--tools', tools];
    if (tools) args.push('--allowedTools', tools);
    const env = { ...process.env };
    delete env.ANTHROPIC_API_KEY;
    delete env.CLAUDECODE;
    const out = await new Promise((resolve, reject) => {
      const child = spawn(bin, args, { cwd, env, stdio: ['pipe', 'pipe', 'pipe'] });
      let stdout = '', stderr = '';
      const timer = setTimeout(() => { child.kill('SIGTERM'); reject(Object.assign(new Error('Permie took too long to answer. Try again, or ask something narrower.'), { status: 504 })); }, 8 * 60_000);
      child.stdout.on('data', (d) => (stdout += d));
      child.stderr.on('data', (d) => (stderr += d));
      child.on('error', (e) => { clearTimeout(timer); reject(e); });
      child.on('close', (code) => {
        clearTimeout(timer);
        if (code === 0 || stdout.trim().startsWith('{')) resolve(stdout);
        else reject(new Error(friendly(stderr || stdout)));
      });
      child.stdin.end(buildPrompt({ mode, question, context }));
    });
    let parsed;
    try { parsed = JSON.parse(out); } catch { throw new Error(friendly(out)); }
    if (parsed.is_error || parsed.subtype !== 'success') throw new Error(friendly(String(parsed.result ?? parsed.subtype ?? 'unknown error')));
    let data = parsed.structured_output;
    if (data == null && typeof parsed.result === 'string') { const m = parsed.result.match(/\{[\s\S]*\}/); if (m) data = JSON.parse(m[0]); }
    if (!data || typeof data.answer !== 'string') throw new Error('Permie answered without the structured result. Try again.');
    return { answer: scrubDashes(data.answer), actions: (Array.isArray(data.actions) ? data.actions : []).map((a) => ({ ...a, label: scrubDashes(a.label || ''), why: scrubDashes(a.why || '') })), seconds: Math.round((Date.now() - started) / 1000), costUsd: parsed.total_cost_usd ?? null };
  } finally {
    running--;
    fs.rmSync(cwd, { recursive: true, force: true });
    cleanTranscripts(cwd);
  }
}

/** claude -p files a folder per working directory under ~/.claude/projects even when told not to keep sessions. */
function cleanTranscripts(cwd) {
  try {
    const root = path.join(os.homedir(), '.claude', 'projects');
    const tag = path.basename(cwd);
    for (const d of fs.readdirSync(root)) if (d.includes(tag)) fs.rmSync(path.join(root, d), { recursive: true, force: true });
  } catch { /* nothing to clean */ }
}

export const scrubDashes = (s) => String(s).replace(/\s*[—–]\s*/g, ', ').replace(/,\s*,/g, ',');

function friendly(text) {
  const t = String(text || '').trim();
  if (/not logged in|login|authenticat|sign in/i.test(t)) return 'Claude Code is not signed in on this Mac. Open Terminal, type claude, sign in once, then try again.';
  if (/rate|limit|quota|usage/i.test(t)) return 'Your Claude plan has hit its usage limit for now. Try again later.';
  return `Permie could not answer: ${t.slice(0, 200) || 'no reply'}`;
}
