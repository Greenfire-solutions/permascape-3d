# Permascape 3D

A permaculture site designer. Type any address and the land loads in 3D with its real
slope, a satellite photo, rainfall, frost dates, hardiness zone, wind and soil. Then design on
it: swales on contour, keyline patterns, ponds, sectors, zones, guilds, hedgerows, paddocks,
fences, plants that grow over the years, buildings, and water running over the ground. Permie,
the built-in AI designer, can draw a whole first design or answer questions about your land.

## The app at a glance

- **Design** (the 3D land). Tool rail on the left, grouped the way a designer works:
  Select, Water, Shape, Plan, Plants, Build. Each group opens a labelled flyout with a
  keyboard key for the common tools (V, M, C, K, W, Z, S, F, P, G, H, B).
- **Inspector** on the right with tabs: Inspect (the selection, tool options, a six-step
  getting-started checklist and the design summary), Analyze (overlays, sectors, wind rose),
  Site (land, climate, soil), Tasks (this month's jobs and the journal), Layers.
- **Plants**: the 206-plant library, each judged against your climate, with search, layer and
  function filters, the planting calendar for your land, and one-press Plant, Guild or Hedgerow.
- **Calendar**: twelve months of jobs from every plant and bed, and a harvest calendar.
- **Water**: month-by-month water budget. Reference evaporation by the FAO-56 Hargreaves method
  from your temperatures, plant demand from canopy and water need, roof catchment into tanks,
  tank shortfall and the tank size that carries the driest run.
- **Review**: a live score (0 to 100) over five areas (water, plants and diversity, zones and
  flow, climate and sectors, soil and earthworks). Every weak spot has a one-press next step.
- **Ask Permie**: the AI designer (below).
- Timeline dock: any date and hour (real sun and shadows) and a growth slider to 30 years.

Grew out of `docs-original-permascape_3d.tsx` (the single-file prototype from Downloads),
with the plant record, journal, monthly tasks, growth timeline and analysis overlays taken
from the Canopy OS spec.

## Start it

Double-click **Start Permascape** in this folder. It builds the app if the source is newer,
starts the server on http://127.0.0.1:8140 and opens it. Logs: `~/Library/Logs/Permascape3D/`.

By hand: `npm install && npm run build && npm start`. For development, `npm start` in one
terminal and `npm run dev` (Vite on 8141, proxies `/api` to 8140) in another.

## Where the land comes from (all free, no keys)

| what | source | notes |
|---|---|---|
| address to place | OpenStreetMap Nominatim | one request a second, cached; coordinates and Google Maps links also work |
| elevation | USGS 3DEP lidar (1 m), else AWS Terrain Tiles | US gets lidar; everywhere else 3 to 30 m |
| satellite photo | Esri World Imagery | tiles cached in `data/cache` |
| climate | Open-Meteo ERA5, 2015 to 2024 | rainfall, frost dates, USDA zone (an estimate: 10 km cells) |
| soil | USDA Soil Data Access (SSURGO) | US only |
| hardiness zone | USDA 2023 map by ZIP (phzmapi.org) | US; estimated from climate elsewhere |
| wild plants nearby | GBIF occurrence records | worldwide |
| wind | Open-Meteo ERA5, daily dominant direction 2020 to 2024 | wind rose and sectors |

Everything fetched is cached under `data/cache`, so a site opens offline the second time.
Projects are JSON files in `data/projects`.

## What it does

- **Tools:** select and drag, measure (distance, rise, grade), raise, lower, smooth, flatten
  (shift-click copies a height), swale on contour (follows the exact level line), freehand
  swale (spoil berm always goes downhill), berm, pond (digs a bowl that fills to its rim),
  zones 0 to 5, paths, 45 plant species, garden beds, buildings, greenhouse, tank, compost,
  coop, beehive, irrigation emitters, water drop and rainfall simulation.
- **Analysis overlays:** slope classes, aspect, elevation, water flow (flow accumulation),
  sun hours for the timeline's date with shade from hills, trees and buildings. Contours.
- **Timeline:** real sun position for any date and time (live shadows), and a growth slider
  up to 30 years ahead. Deciduous trees go bare in winter, colour in fall, blossom and fruit.
- **Plant record:** species, zone fit, planted date, source, cost, notes, and a journal.
  **Tasks** for the month come from each plant's prune and harvest months; ticking one logs it.
- **Report:** land, climate, soil, water budget (roof catchment, tanks, ponds, swales),
  earth moved, planting schedule. Prints or saves as PDF.
- **Files:** autosave, undo and redo, save as copy, export PNG, GLB 3D model, CSV element
  list, JSON project file, and import.

## Permaculture tools added in the second build

- **Tree guild** (G): click once to plant a fruit or nut tree with nitrogen fixers, nutrient
  miners, insect plants, pest confusers and living mulch around its drip line, every one chosen
  to fit your hardiness zone.
- **Hedgerow** (H): drag a line; a tall windbreak row at the tree's own spacing plus a staggered
  shrub row, auto-picked for your zone (or choose).
- **Keyline pattern** (K): click the keypoint; the keyline follows the exact contour and parallel
  lines are laid either side at your spacing, previewed as you hover.
- **Sectors** (S): drag wedges for wind, cold wind, fire, views, noise, wildlife, flood and cold
  air. "Map sun and wind sectors" draws the real solstice sun arcs (sunrise and sunset bearings
  and noon height) and the prevailing summer and winter wind from five years of measured data,
  with a wind rose by season.
- **Fence** (F) with post count, **Paddock** with animals, head count, the area they need and
  rest days for rotation.

## Permie, the AI designer

Runs on Claude Code on this Mac (`claude -p`, your own Claude sign-in; no API key is read and
`ANTHROPIC_API_KEY` is removed from the child). It is told the land in numbers: site size, a
10 by 10 terrain grid of height, slope, aspect and drainage lines, climate, frost, chill, soil,
measured wind, everything already placed, and the plant ids that grow here.

- **Design my land**: pick goals (food forest, market garden, water first...) and extra wishes.
  It returns 12 to 40 proposed changes (swales, ponds, tanks, zones, guilds, hedges, paddocks,
  paths) with a reason for each. They preview on the land as outlines; tick what you want and
  press Add. One Undo takes the whole proposal back.
- **Ask anything**: questions about your land (it may search the web for nurseries or local
  rules), with optional proposed changes.
- Agents propose, you decide: nothing is added until you press Add. Answers are scrubbed of em
  dashes. Each call runs in an empty temp folder with no MCP servers, skills or settings, and
  its transcript folder is deleted afterwards. The conversation is saved with the project.
- "Deeper design" uses Opus instead of Sonnet (slower). A design takes 30 to 90 seconds.

## Zone plant guide

Draw a zone (0 to 5) and the guide opens on its own. It judges all 206 plants in
`src/lib/library.ts` against this site and this zone, and gives dates for this exact place:

- **Climate model** (`server/geo.mjs`, `src/lib/advisor.ts`): frost dates with a safe date
  (9 years in 10), winter chill hours, summer heat and growing degree days, wet seasons and the
  Koppen climate type, from 10 years of Open-Meteo ERA5. US sites use the official USDA 2023
  hardiness zone for their ZIP. You can set your own zone and frost dates (Site panel), and
  every date follows.
- **Annual crops are simulated** day by day: frost, soil warmth at planting, heat that bolts
  greens or stops fruit set, warm nights (tomatoes, potatoes), day length for onions, hot wet
  tropical summers, and thermal time so cool weather slows growth. Works in either hemisphere.
- **Perennials** are checked for hardiness zone, chill hours, summer heat, ripening heat,
  season length, humidity, soil pH, wet ground and measured sun hours in the zone.
- **Microclimate**: the zone's slope and aspect (a sun-facing slope is half a zone warmer, a
  frost pocket half a zone colder), real sun hours with shade, drainage lines and soil.
- **Varieties** chosen for the place (low-chill apples in Texas, hardneck garlic in Colorado,
  short-day onions in Florida).
- **Actions**: Add a bed (with its sow, plant-out and harvest jobs in Tasks), Place one, or
  Fill zone at the plant's own spacing, dated for the next planting window.
- **Zone 5** (and 4): plants recorded growing wild within 20 km, from GBIF.

`test/advisor.test.mjs` checks the advisor against published extension calendars for Austin,
Boulder, Phoenix, Miami, Seattle, Sydney, London, Nairobi and Fairbanks (frozen climate
snapshots in `test/fixtures`, so it runs offline).

## Tests

- `npm test` (44 checks): guilds, hedgerows, keyline, sun sectors against published solstice
  bearings, the water budget, the design review, applying an AI proposal, the wind rose; terrain maths, earthworks, flow, sun, sun hours, plants, TIFF and climate
  parsing, the plant advisor in nine real places, and the server (its own instance on 8142 with throwaway data).
- `npm run build && node test/e2e.mjs [--shots dir]`: real headless Chrome drives the whole
  thing on a real address (needs internet): every tool, every workspace, review fixes, and
  Permie's propose, preview, apply and undo path (with a canned AI answer, `PERMASCAPE_FAKE_AI=1`,
  so the test costs nothing). `E2E_ADDRESS="..."` to try another place.

## Ports

8140 app, 8141 Vite dev, 8142 tests. `/api/whoami` answers `app: permascape-3d`; the server
exits with code 3 if its port is taken, and the launcher never takes over a stranger's port.
