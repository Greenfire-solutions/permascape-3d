// The season watch: the next ten days of weather turned into jobs on this design. Frost on the
// way means cover the tender plants by name; a storm means walk the swales and spillways first.
import type { Feature, SiteObject } from './types.ts';
import { LIBRARY_BY_ID } from './library.ts';

export interface WatchDay { date: string; minC: number; maxC: number; rainMm: number; gustKmh: number }
export interface WatchItem { level: 'warn' | 'tip'; title: string; text: string; date: string; ids: string[] }

const day = (iso: string) => new Date(iso + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' });

export function seasonWatch(days: WatchDay[], alerts: { event: string; headline: string }[], objects: SiteObject[], features: Feature[], units: 'metric' | 'imperial' = 'imperial'): WatchItem[] {
  const out: WatchItem[] = [];
  const T = (c: number) => (units === 'imperial' ? `${Math.round((c * 9) / 5 + 32)}°F` : `${Math.round(c)}°C`);
  const R = (mm: number) => (units === 'imperial' ? `${(mm / 25.4).toFixed(1)} in` : `${Math.round(mm)} mm`);
  const plants = objects.filter((o) => o.type === 'plant');
  const sp = (o: SiteObject) => LIBRARY_BY_ID[o.species || ''];
  const today = new Date().toISOString().slice(0, 10);
  const young = (o: SiteObject) => !o.planted || (Date.parse(today) - Date.parse(o.planted)) / 86400000 < 730;

  for (const a of alerts.slice(0, 3)) out.push({ level: 'warn', title: a.event, text: a.headline, date: today, ids: [] });

  // frost: the first night at or under 0 C, and what it would hurt
  const frost = days.find((d) => d.minC <= 0.5);
  if (frost) {
    const hard = frost.minC <= -2;
    const tender = plants.filter((o) => { const s = sp(o); return s && (s.zoneMin >= 8 || s.life === 'annual' || (s.heatMaxC ?? 0) > 0 && s.zoneMin >= 7) && young(o); });
    const beds = objects.filter((o) => o.type === 'garden' && o.crop && LIBRARY_BY_ID[o.crop]?.life === 'annual');
    const names = [...new Set([...tender, ...beds].map((o) => (o.type === 'garden' ? LIBRARY_BY_ID[o.crop!]?.name : sp(o)?.name)).filter(Boolean))].slice(0, 5);
    out.push({
      level: tender.length + beds.length ? 'warn' : 'tip', date: frost.date,
      title: `${hard ? 'Hard frost' : 'Frost'} ${day(frost.date)}, low of ${T(frost.minC)}`,
      text: tender.length + beds.length ? `Cover or bring in ${names.join(', ')} the evening before. Water dry soil in the afternoon: moist ground holds more heat.` : 'Nothing tender is planted. Good night to check that hoses and tank taps are drained.',
      ids: [...tender, ...beds].map((o) => o.id),
    });
  }

  // heavy rain: earthworks get their test
  const storm = days.find((d) => d.rainMm >= 25);
  if (storm) {
    const works = features.filter((f) => f.kind === 'swale' || f.kind === 'berm');
    const ponds = objects.filter((o) => o.type === 'pond');
    out.push({
      level: works.length || ponds.length ? 'warn' : 'tip', date: storm.date,
      title: `Heavy rain ${day(storm.date)}, about ${R(storm.rainMm)}`,
      text: works.length || ponds.length ? `Before it comes, clear the spillways on ${[...works, ...ponds].slice(0, 3).map((x) => x.name).join(', ')}${works.length + ponds.length > 3 ? ' and the rest' : ''}. Walk them during or just after the rain: it is the best time to see where water really goes.` : 'A good day to walk the land in a raincoat and watch where the water runs. Mark the spots for swales.',
      ids: [...works.map((f) => f.id), ...ponds.map((o) => o.id)],
    });
  } else {
    const week = days.slice(0, 7).reduce((t, d) => t + d.rainMm, 0);
    const hot = days.slice(0, 7).filter((d) => d.maxC >= 30).length;
    const newTrees = plants.filter((o) => young(o) && ['canopy', 'subcanopy', 'shrub'].includes(sp(o)?.layer || '')).length;
    if (week < 6 && newTrees && days[0] && days[0].maxC > 12) out.push({ level: hot ? 'warn' : 'tip', date: today, title: `Dry week ahead, ${R(week)} of rain${hot ? `, ${hot} hot days` : ''}`, text: `Give the ${newTrees} young trees and shrubs a deep soak, about 5 gallons (20 litres) each, and top up the mulch.`, ids: plants.filter((o) => young(o)).map((o) => o.id) });
  }

  // wind
  const gale = days.find((d) => d.gustKmh >= 65);
  if (gale) out.push({ level: 'tip', date: gale.date, title: `Strong wind ${day(gale.date)}, gusts to ${units === 'imperial' ? Math.round(gale.gustKmh * 0.621) + ' mph' : Math.round(gale.gustKmh) + ' km/h'}`, text: 'Check stakes and ties on young trees, and weigh down greenhouse covers and row cloth.', ids: [] });

  // heat
  const heat = days.find((d) => d.maxC >= 35);
  if (heat) out.push({ level: 'tip', date: heat.date, title: `Heat ${day(heat.date)}, high of ${T(heat.maxC)}`, text: 'Water early in the morning, shade new transplants, and give the animals extra water and shade.', ids: [] });
  return out;
}
