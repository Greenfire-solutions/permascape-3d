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
    structure: { type: 'string', enum: ['building', 'shed', 'greenhouse', 'tank', 'compost', 'coop', 'hive'], description: 'building is a house; shed is any barn, shed, workshop or animal shelter.' },
    size: { type: 'number', description: 'Pond radius m, swale length m, or tank litres.' },
    width: { type: 'number', description: 'Metres across, for buildings, sheds, greenhouses and beds.' },
    depth: { type: 'number', description: 'Metres long, for buildings, sheds, greenhouses and beds.' },
    animal: { type: 'string', enum: ['chickens', 'ducks', 'geese', 'goats', 'sheep', 'pigs', 'cattle', 'rabbits'] },
    head: { type: 'integer', minimum: 0, description: 'How many animals graze this paddock: the number the person asked for.' },
    phase: { type: 'integer', minimum: 1, maximum: 3, description: 'Build year: 1 for water, access and the first plantings, 2 and 3 for what follows.' },
  },
  required: ['kind', 'label', 'why'],
};

const ANSWER = { type: 'string', description: 'The reply to the person, plain text, short paragraphs and simple lists. No markdown headings, no em dashes.' };
const SCHEMA = {
  type: 'object',
  properties: { answer: ANSWER, actions: { type: 'array', items: ACTION, maxItems: 60 } },
  required: ['answer', 'actions'],
};
const CRITIC_SCHEMA = {
  type: 'object',
  properties: {
    answer: { type: 'string', description: 'What you checked and what you changed, as a short list. Plain text, no em dashes.' },
    drop: { type: 'array', items: { type: 'integer' }, description: 'Indexes (from 0) of proposed changes to remove because they are mistakes.' },
    actions: { type: 'array', items: ACTION, maxItems: 20, description: 'Replacement or missing changes, in the same format.' },
  },
  required: ['answer', 'drop', 'actions'],
};
const BRIEF_FIELDS = {
  client: { type: 'string', description: 'Client name(s).' }, contact: { type: 'string', description: 'Email or phone.' },
  people: { type: 'integer', description: 'People living on the land.' }, hoursPerWeek: { type: 'number', description: 'Hours a week they can give the land.' },
  budget: { type: 'number', description: 'Total budget in US dollars.' }, years: { type: 'integer', description: 'Over how many years.' },
  water: { type: 'string', enum: ['rain', 'well', 'mains', 'spring', 'creek'], description: 'Main water source today.' },
  animals: { type: 'string' }, keep: { type: 'string', description: 'Things to keep: trees, buildings, views.' },
  problems: { type: 'string', description: 'What is not working now.' }, access: { type: 'string', description: 'Mobility, age or access needs.' },
  wants: { type: 'string', description: 'What they want from the land, in their words.' }, notes: { type: 'string' },
  goals: { type: 'array', items: { type: 'string', enum: ['Food forest', 'Market garden', 'Self-reliant homestead', 'Water first', 'Wildlife and pollinators', 'Small backyard', 'Animals and pasture', 'Low maintenance', 'Fire-wise'] } },
};
const BRIEF_SCHEMA = {
  type: 'object',
  properties: { answer: { type: 'string', description: 'One or two lines: what you filled in, and the questions still worth asking the client.' }, brief: { type: 'object', properties: BRIEF_FIELDS } },
  required: ['answer', 'brief'],
};
const PROPOSAL_SCHEMA = { type: 'object', properties: { answer: { type: 'string', description: 'The letter. Plain text with blank lines between paragraphs. No markdown, no em dashes.' } }, required: ['answer'] };

const RULES = `You are Permie, the design assistant inside Permascape 3D, a permaculture site designer.
You are an experienced permaculture designer (PDC teacher level) who knows Mollison, Holmgren, Yeomans' keyline scale of permanence, Toensmeier and Jacke's forest garden work, and regional extension advice.

Coordinates: metres from the site centre, x to the east, y to the north. The site is a square; stay at least 2 m inside its edge.
Everything you add must suit the real land described below: put swales on slopes across the flow above what they water, ponds in low wet spots or below swales, zone 1 next to the house, frost-tender things off the frost pocket, windbreaks across the prevailing or cold wind, sun traps opening to the sun side of the sky for this hemisphere.
Only use plant ids from the PLANT IDS list. Prefer plants marked "good". Never use an id that is not listed.
Do not move or delete what is already placed; build around it and avoid overlapping existing objects (keep trees at least their spread apart).
Write for a practical person, warm and direct. Never use an em dash or en dash; use commas and full stops.
In everything the person reads, give sizes, amounts and temperatures in the units named in the context ("units"): for "US" that is feet, acres, gallons, inches and degrees F. Numbers in actions (x, y, size, width, depth) stay in metres and litres. Never write a placeholder in square brackets such as [name]; leave out what you do not know.
Use "guild" for a fruit or nut tree plus its support plants (the app adds the support plants itself). Use "hedge" with a line of points for windbreaks and hedgerows (the app chooses spacing and a shrub row).
A swale action needs only x, y on sloping ground and a length in size; the app snaps it to the exact contour.

Hard rules a senior designer never breaks:
- Never put eastern red cedar (redcedar) on the same site as apple, pear, quince or serviceberry: it spreads cedar-apple rust. Never put black walnut within 20 m of apples, tomatoes, potatoes, blueberries or asparagus. Never pair white or Korean pine with currants or gooseberries.
- Avoid plants that spread past where they are put (running bamboo, sea buckthorn, Siberian pea shrub, white mulberry, black locust outside its native range) unless the person asks; prefer natives and named fruiting varieties.
- Swales only where the slope is under about 15%; on steeper ground use terraces, hedgerows on contour or tree belts. Never dig across a road, driveway or path in the existing conditions.
- Keep every building, tank, pond and hive at least 15 m from a stream, and compost, coops and paddock fences at least 30 m from it. Keep buildings, coops and greenhouses out of mapped flood areas, wetlands and drainage lines. Paddocks never take in a stream.
- Use the numbers the person gives: if they say 2 goats, a paddock action has head 2. Size sheds and animal shelters with width and depth in metres (a goat shelter for two is about 3 by 4 m); only a house is house-sized.
- Give every action a phase: 1 for water, access, structures and the first trees (what to do this year), 2 and 3 for what follows, so the client can spread the cost. Keep the year 1 cost inside the budget if one is given (the context has the price list and the current cost estimate).
- Things marked existing are already on the land: build around them, never on top of them.`;

export function buildPrompt({ mode, question, context, proposal }) {
  const ctx = typeof context === 'string' ? context : JSON.stringify(context, null, 1);
  if (mode === 'critic') {
    return `${RULES}

TASK: You are now the senior designer checking a junior's proposal before the client sees it. Go through the PROPOSED CHANGES against the land and the hard rules: disease hosts and plant conflicts, invasive or unsuitable plants for this climate and soil, windbreaks on the wrong side of the prevailing or winter wind, swales on steep ground or across roads, anything in a flood area, wetland, stream buffer or drainage line, sizes and animal numbers that do not match the person's brief, frost-tender trees in frost pockets, missing pollination partners, and the year 1 cost against the budget.
Drop the changes that are mistakes (by index) and add the corrected or missing ones. Leave good changes alone. If the proposal is sound, say so and return no drops and no actions.
In "answer", list what you checked and what you changed in at most 8 short lines.

THE PERSON'S BRIEF: ${question || 'see the land context'}

PROPOSED CHANGES (index: change):
${(proposal || []).map((a, i) => `${i}: ${JSON.stringify(a)}`).join('\n')}

THE LAND AND DESIGN SO FAR:
${ctx}`;
  }
  if (mode === 'brief') {
    return `You are the intake assistant for a permaculture designer. Read the client's notes, email or call transcript below and fill in the design brief. Only fill a field when the notes say it or clearly imply it; leave the rest out. Never invent a budget, a name or a number. Plain text, never an em dash or en dash.

THE CLIENT'S NOTES:
${question}`;
  }
  if (mode === 'proposal') {
    return `You write for a permaculture designer. Draft the cover letter for the design proposal below, addressed to the client, in the designer's voice: warm, plain and confident, no jargon without a one-line explanation, no hype. Never use an em dash or en dash. Use the units named in the context ("units") for every size, amount and temperature. Never write a placeholder in square brackets: if the designer's name is not given, end with the sign-off line alone.
Structure it as: a greeting; one paragraph on what you heard they want; a paragraph on what the land is telling us (slope, water, soil, climate, flood or stream limits); the big moves of the design and why each one suits this land; what happens in year 1, year 2 and year 3 and roughly what each costs (use the cost estimate in the context); what you need from them next; a sign-off with the designer's name if given. About 350 to 500 words.
${question ? `Notes from the designer: ${question}` : ''}

THE LAND, THE BRIEF AND THE DESIGN:
${ctx}`;
  }
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

const SCHEMAS = { design: SCHEMA, ask: SCHEMA, critic: CRITIC_SCHEMA, brief: BRIEF_SCHEMA, proposal: PROPOSAL_SCHEMA };

export async function askClaude({ mode, question, context, model, proposal }) {
  const bin = claudeBinary();
  if (!bin) throw Object.assign(new Error('Claude Code is not installed on this Mac. Install it and sign in once by typing claude in Terminal, then try again.'), { status: 503 });
  if (running >= MAX_PARALLEL) throw Object.assign(new Error('Permie is already working on two requests. Try again in a minute.'), { status: 429 });
  running++;
  const started = Date.now();
  const cwd = fs.mkdtempSync(path.join(os.tmpdir(), 'permascape-claude-'));
  try {
    const web = mode === 'ask';  // only Ask may search the web (nurseries, local rules)
    const tools = web ? 'WebSearch,WebFetch' : '';
    const args = ['-p', '--model', model === 'opus' ? 'opus' : 'sonnet', '--output-format', 'json', '--json-schema', JSON.stringify(SCHEMAS[mode] || SCHEMA),
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
      child.stdin.end(buildPrompt({ mode, question, context, proposal }));
    });
    let parsed;
    try { parsed = JSON.parse(out); } catch { throw new Error(friendly(out)); }
    if (parsed.is_error || parsed.subtype !== 'success') throw new Error(friendly(String(parsed.result ?? parsed.subtype ?? 'unknown error')));
    let data = parsed.structured_output;
    if (data == null && typeof parsed.result === 'string') { const m = parsed.result.match(/\{[\s\S]*\}/); if (m) data = JSON.parse(m[0]); }
    if (!data || typeof data.answer !== 'string') throw new Error('Permie answered without the structured result. Try again.');
    const result = { answer: scrubDashes(data.answer), actions: (Array.isArray(data.actions) ? data.actions : []).map((a) => ({ ...a, label: scrubDashes(a.label || ''), why: scrubDashes(a.why || '') })), seconds: Math.round((Date.now() - started) / 1000), costUsd: parsed.total_cost_usd ?? null };
    if (mode === 'critic') result.drop = (Array.isArray(data.drop) ? data.drop : []).filter((i) => Number.isInteger(i) && i >= 0 && i < (proposal || []).length);
    if (mode === 'brief') result.brief = Object.fromEntries(Object.entries(data.brief || {}).map(([k, v]) => [k, typeof v === 'string' ? scrubDashes(v) : v]));
    return result;
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
