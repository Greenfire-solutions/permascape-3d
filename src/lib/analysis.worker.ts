// Heavy terrain analysis off the main thread so the 3D view never freezes.
import { sunHours } from './sunHours.ts';
import { flowAccumulation } from './terrain.ts';

self.onmessage = (e: MessageEvent) => {
  const { id, kind, job } = e.data;
  try {
    if (kind === 'sun') {
      const { hours, max } = sunHours(job);
      (self as any).postMessage({ id, ok: true, hours, max }, [hours.buffer]);
    } else if (kind === 'flow') {
      const flow = flowAccumulation(job);
      (self as any).postMessage({ id, ok: true, flow }, [flow.buffer]);
    }
  } catch (err: any) {
    (self as any).postMessage({ id, ok: false, error: String(err?.message || err) });
  }
};
