// Local coordinates: metres from the site centre, x east, y north. Heights are metres above
// the lowest point of the site (site.base is that point's real elevation above sea level).

export type ObjectType =
  | 'plant' | 'building' | 'greenhouse' | 'tank' | 'pond' | 'garden'
  | 'compost' | 'coop' | 'hive' | 'irrigation';

export interface JournalEvent {
  id: string;
  date: string; // YYYY-MM-DD
  type: 'planted' | 'watered' | 'pruned' | 'fed' | 'mulched' | 'harvested' | 'issue' | 'treated' | 'note' | 'built';
  text?: string;
  qtyKg?: number;
  taskId?: string;
}

export interface SiteObject {
  id: string;
  type: ObjectType;
  name: string;
  x: number;
  y: number;
  rotation: number; // degrees, clockwise from north
  scale: number;
  color?: string;
  species?: string; // plant library id
  planted?: string; // YYYY-MM-DD, also "built" date for structures
  source?: string; // nursery, vendor, seed lot
  cost?: number;
  notes?: string;
  events: JournalEvent[];
  // structure dimensions in metres
  width?: number;
  depth?: number;
  height?: number;
  radius?: number;
  capacityL?: number;
  isFlowing?: boolean;
  waterLevel?: number; // pond water surface height (local metres)
  crop?: string; // garden beds: the library id of what is growing in it
}

export type FeatureKind = 'path' | 'zone' | 'swale' | 'berm' | 'fence' | 'keyline' | 'sector' | 'paddock';

export type SectorType = 'sun-summer' | 'sun-winter' | 'wind' | 'cold-wind' | 'fire' | 'view' | 'noise' | 'wildlife' | 'flood' | 'frost';
export type Animal = 'chickens' | 'ducks' | 'geese' | 'goats' | 'sheep' | 'pigs' | 'cattle' | 'rabbits' | 'bees';

export interface Feature {
  id: string;
  kind: FeatureKind;
  name: string;
  points: [number, number][];
  width?: number; // path width, swale/berm width
  depth?: number; // swale depth
  height?: number; // berm height
  zone?: number; // permaculture zone 0 to 5
  color?: string;
  notes?: string;
  // sector: points[0] is the origin, points[1] the tip; spread is the wedge's full angle in degrees
  sector?: SectorType;
  spread?: number;
  // paddock: the animals grazing it and how many
  animal?: Animal;
  head?: number;
  restDays?: number;
  group?: string; // keyline lines made together share a group id
}

export interface Climate {
  years: number;
  period: string;
  annualPrecipMm: number;
  monthlyPrecipMm: number[];
  monthlyMeanMinC: number[];
  monthlyMeanMaxC: number[];
  meanAnnualMinC: number | null;
  zone: { zone: number; label: string; minF: number } | null;
  frostFree: boolean;
  lastSpringFrost: string | null;
  firstFallFrost: string | null;
  growingSeasonDays: number | null;
  source: string;
  // version 2: what the plant advisor needs
  version?: number;
  monthlyMeanC?: number[];
  frost?: { frostFree: boolean; years: number; frostYears: number; lastMean?: number | null; lastLate?: number | null; firstMean?: number | null; firstEarly?: number | null; seasonSafe?: number | null };
  gdd10?: number;
  hotDays?: number;
  veryHotDays?: number;
  chillHours?: number | null;
  chillMethod?: string;
  koppen?: { code: string; name: string };
  wetSeason?: { allYear: boolean; startMonth?: number | null; months?: number };
  zoneOfficial?: { label: string; zip: string; rangeF: string; source: string } | null;
}

export interface Soil {
  available: boolean;
  note?: string;
  mapUnit?: string;
  components?: { name: string; percent: number | null }[];
  drainage?: string | null;
  hydrologicGroup?: string | null;
  order?: string | null;
  topsoilTexture?: string | null;
  pH?: number | null;
  organicMatterPct?: number | null;
  source?: string;
}

export interface Site {
  address: string;
  lat: number | null; // null for a blank sandbox
  lon: number | null;
  size: number; // metres, square
  n: number; // grid segments per side (64, 128 or 256)
  base: number; // elevation of local height 0, metres above sea level
  source: string;
  sourceResM: number | null;
  note?: string;
  climate?: Climate | null;
  soil?: Soil | null;
  overrides?: { zone?: string; lastFrost?: string; firstFrost?: string };
}

export type Overlay = 'none' | 'slope' | 'aspect' | 'elevation' | 'flow' | 'sun';

export interface Settings {
  exaggeration: number;
  overlay: Overlay;
  overlayOpacity: number;
  satellite: boolean;
  imageOpacity: number;
  contours: boolean;
  contourInterval: number; // metres
  grid: boolean;
  units: 'metric' | 'imperial';
  layers: Record<LayerId, boolean>;
}

export type LayerId = 'plants' | 'structures' | 'gardens' | 'water' | 'paths' | 'zones' | 'earthworks' | 'sectors';

export interface DesignState {
  heights: Float32Array;
  objects: SiteObject[];
  features: Feature[];
}

export interface Project {
  id: string;
  name: string;
  version: 1;
  created: string;
  updated?: string;
  site: Site;
  originalHeights: string; // base64 Float32Array, the terrain as surveyed
  heights: string; // base64 Float32Array, the terrain as designed
  objects: SiteObject[];
  features: Feature[];
  settings: Settings;
  thumb?: string | null;
  goals?: string[];
  ai?: AiTurn[];
}

export interface AiAction {
  kind: 'plant' | 'guild' | 'hedge' | 'zone' | 'swale' | 'pond' | 'structure' | 'garden' | 'path' | 'paddock' | 'fence';
  label: string;
  why: string;
  species?: string;
  x?: number;
  y?: number;
  points?: [number, number][];
  zone?: number;
  structure?: 'building' | 'greenhouse' | 'tank' | 'compost' | 'coop' | 'hive';
  size?: number; // radius for ponds, length for swales, capacity in litres for tanks
  width?: number;
  depth?: number;
  animal?: Animal;
}

export interface AiTurn {
  id: string;
  at: string;
  mode: 'ask' | 'design';
  question: string;
  answer: string;
  actions: AiAction[];
  applied?: number[];
  seconds?: number;
}

export const LAYER_OF: Record<ObjectType, LayerId> = {
  plant: 'plants', building: 'structures', greenhouse: 'structures', tank: 'water', pond: 'water',
  garden: 'gardens', compost: 'structures', coop: 'structures', hive: 'structures', irrigation: 'water',
};

export const DEFAULT_SETTINGS: Settings = {
  exaggeration: 1,
  overlay: 'none',
  overlayOpacity: 0.65,
  satellite: true,
  imageOpacity: 1,
  contours: true,
  contourInterval: 1,
  grid: false,
  units: 'imperial',
  layers: { plants: true, structures: true, gardens: true, water: true, paths: true, zones: true, earthworks: true, sectors: true },
};
