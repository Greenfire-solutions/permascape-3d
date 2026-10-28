# Permascape 3D: make it your own

A permaculture design studio: an address becomes a 3D site with real slope, climate and public
maps, and you design on it. React + three.js in the browser, a small plain-Node server that
fetches and caches the public data. Read `README.md` for every feature and data source.

## How it is laid out

| folder or file | what it is |
|---|---|
| `src/App.tsx` | the whole app shell: top bar, workspaces, tool handling, saving |
| `src/components/` | screens: `StartDialog` (address to site), `Viewport3D` (the 3D land), `Toolbar`, `Panels` (inspector tabs), `Workspaces` (Plants, Calendar, Water, Review), `Business` (Brief, Budget), `Permie` (the AI designer), `Report` (the client report), `ZoneGuide` |
| `src/lib/` | the brains, pure TypeScript with no React: `terrain.ts`, `advisor.ts` (which plant grows where), `library.ts` (the 206 plants), `permaculture.ts` (guilds, keyline, sectors, the review score), `checks.ts` (siting rules), `estimate.ts` (budget), `exportGeo.ts`, `planDrawing.ts` |
| `server/server.mjs` | serves the built app in `dist/` and the `/api/*` routes |
| `server/sources.mjs`, `server/geo.mjs` | the public data: geocoding, USGS lidar, satellite tiles, climate, soil, flood and stream maps (all free, no keys, cached in the data folder) |
| `server/ai.mjs` | Permie: runs Claude Code on this Mac (`claude -p`) and returns proposed changes |
| `scripts/start-permascape.sh` | what the Start icon runs; `scripts/setup.sh` finds Node; `scripts/package.sh` makes the per-Mac zips |
| `dist/` | the built app (made by `npm run build`; never edit by hand) |
| `test/` | unit tests (`*.test.mjs`) and a full browser walkthrough (`e2e.mjs`) |

Projects are saved as JSON in `~/Permascape 3D Data/projects` (or `PERMASCAPE_DATA`).

## Run it while you change it

Use the Node that ships in the folder, so nothing needs installing:

    export PATH="$PWD/runtime/node/bin:$PATH"
    npm install           # once: React, three.js, Vite, Tailwind, TypeScript
    npm start             # the server on http://127.0.0.1:8140
    npm run dev           # in a second terminal: Vite on http://127.0.0.1:8141, reloads as you save

When you are happy, `npm run build`. (Or just double-click Start Permascape: it sees the
changed code and rebuilds by itself.) `npm test` fails until the build matches the source, so a
stale build cannot slip through.

## Check it

    npm test              # unit tests: plants, advisor, guilds, review wording, the server
    npm run typecheck     # TypeScript
    npm run build && node test/e2e.mjs    # real headless Chrome drives the whole app on a real address

`PERMASCAPE_FAKE_AI=1` gives Permie canned answers, so tests never spend a Claude call.

## Rules this code keeps

- No em dashes in anything a person reads.
- The review only gives credit for what was actually checked: a map that failed to load says
  "Not checked" and is left out of the score. Keep it that way; designers hand this to clients.
- Permie only proposes. The person sees every change outlined and applies it as one undo step.
- The server answers `/api/whoami`; the launcher asks who is on the port before it opens anything.

## Ideas to ask Claude Code for

1. "Add these five plants from my nursery to the plant library, with their zones and spacing"
   (`src/lib/library.ts`; the advisor judges them automatically).
2. "Put my business logo and colours on the client report" (`src/components/Report.tsx`).
3. "Change the budget's unit prices to my local costs in euros" (`src/lib/estimate.ts`).
4. "Add a review rule: warn when a pond is closer than 10 m to the house"
   (`src/lib/checks.ts`, then a test in `test/`).
5. "Add a new structure type: a yurt, 6 m across" (`src/lib/types.ts`, `src/lib/models.ts`, the
   Build tools in `src/components/Toolbar.tsx`).
