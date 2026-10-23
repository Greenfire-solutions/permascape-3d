import type { Climate, Soil, Project } from './types';

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, init);
  const text = await r.text();
  let j: any = null;
  try { j = JSON.parse(text); } catch { /* not json */ }
  if (!r.ok) throw new Error(j?.error || `${r.status} ${text.slice(0, 120)}`);
  return j as T;
}

export interface GeoResult { lat: number; lon: number; label: string; kind: string }

export const reverseGeocode = (lat: number, lon: number) => getJson<{ label: string }>(`/api/reverse?lat=${lat}&lon=${lon}`).then((r) => r.label);

export const geocode = (q: string) => getJson<{ results: GeoResult[] }>(`/api/geocode?q=${encodeURIComponent(q)}`).then((r) => r.results);

export interface TerrainResponse {
  n: number; size: number; lat: number; lon: number; base: number; relief: number;
  source: string; sourceResM: number; note: string; heights: string;
}

export const fetchTerrain = (lat: number, lon: number, size: number, n: number) =>
  getJson<TerrainResponse>(`/api/terrain?lat=${lat}&lon=${lon}&size=${size}&n=${n}`);

export const fetchClimate = (lat: number, lon: number) => getJson<Climate>(`/api/climate?lat=${lat}&lon=${lon}`);
export const fetchSoil = (lat: number, lon: number) => getJson<Soil>(`/api/soil?lat=${lat}&lon=${lon}`);

export interface ProjectSummary { id: string; name: string; address: string; updated: string; size: number; objects: number; thumb: string | null }

export const listProjects = () => getJson<{ projects: ProjectSummary[] }>('/api/projects').then((r) => r.projects);
export const loadProject = (id: string) => getJson<Project>(`/api/projects/${id}`);
export const saveProject = (p: Project) =>
  getJson<{ ok: boolean; updated: string }>(`/api/projects/${p.id}`, { method: 'PUT', headers: { 'content-type': 'application/json' }, body: JSON.stringify(p) });
export const deleteProject = (id: string) => getJson<{ ok: boolean }>(`/api/projects/${id}`, { method: 'DELETE' });

export function f32ToB64(a: Float32Array) {
  const bytes = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}

export function b64ToF32(b64: string) {
  const s = atob(b64);
  const bytes = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) bytes[i] = s.charCodeAt(i);
  return new Float32Array(bytes.buffer);
}

export const uid = () => (crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2, 12) + Date.now().toString(36));

export const slugId = (name: string) =>
  (name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'site') + '-' + Date.now().toString(36);

export const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** Satellite image for the site, stitched from cached tiles and cropped to the exact square. */
export async function fetchImagery(lat: number, lon: number, size: number, onProgress?: (f: number) => void): Promise<HTMLCanvasElement> {
  const mLat = 111132.92 - 559.82 * Math.cos(2 * lat * Math.PI / 180);
  const mLon = 111412.84 * Math.cos(lat * Math.PI / 180) - 93.5 * Math.cos(3 * lat * Math.PI / 180);
  const north = lat + size / 2 / mLat, south = lat - size / 2 / mLat;
  const west = lon - size / 2 / mLon, east = lon + size / 2 / mLon;
  const px = (lo: number, la: number, z: number) => {
    const sc = 256 * 2 ** z, s = Math.sin(la * Math.PI / 180);
    return [((lo + 180) / 360) * sc, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * sc];
  };
  // pick the zoom that gives roughly 2048 px across the site, capped at 19 (about 0.3 m)
  let z = 19;
  while (z > 3) {
    const [x0] = px(west, lat, z), [x1] = px(east, lat, z);
    if (x1 - x0 <= 2600) break;
    z--;
  }
  const [ax, ay] = px(west, north, z), [bx, by] = px(east, south, z);
  const tx0 = Math.floor(ax / 256), ty0 = Math.floor(ay / 256), tx1 = Math.floor(bx / 256), ty1 = Math.floor(by / 256);
  const mosaic = document.createElement('canvas');
  mosaic.width = (tx1 - tx0 + 1) * 256; mosaic.height = (ty1 - ty0 + 1) * 256;
  const mctx = mosaic.getContext('2d')!;
  const total = (tx1 - tx0 + 1) * (ty1 - ty0 + 1);
  let done = 0;
  const jobs: Promise<void>[] = [];
  for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
    jobs.push(new Promise<void>((resolve) => {
      const img = new Image();
      img.onload = () => { mctx.drawImage(img, (tx - tx0) * 256, (ty - ty0) * 256); onProgress?.(++done / total); resolve(); };
      img.onerror = () => { onProgress?.(++done / total); resolve(); };
      img.src = `/api/tile/${z}/${tx}/${ty}`;
    }));
  }
  await Promise.all(jobs);
  const out = document.createElement('canvas');
  out.width = out.height = 2048;
  out.getContext('2d')!.drawImage(mosaic, ax - tx0 * 256, ay - ty0 * 256, bx - ax, by - ay, 0, 0, 2048, 2048);
  return out;
}
