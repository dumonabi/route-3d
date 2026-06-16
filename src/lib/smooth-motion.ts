import { haversineMeters, type PathPoint } from "@/lib/route-geo";

/** Frame-rate independent exponential smoothing. */
export function smoothStep(
  current: number,
  target: number,
  dtMs: number,
  halfLifeMs: number,
): number {
  if (halfLifeMs <= 0 || dtMs <= 0) return target;
  const alpha = 1 - Math.exp((-dtMs * Math.LN2) / halfLifeMs);
  return current + (target - current) * alpha;
}

export function smoothPoint(
  current: PathPoint,
  target: PathPoint,
  dtMs: number,
  halfLifeMs: number,
): PathPoint {
  return {
    lat: smoothStep(current.lat, target.lat, dtMs, halfLifeMs),
    lng: smoothStep(current.lng, target.lng, dtMs, halfLifeMs),
  };
}

export function hasMovedMeters(
  a: PathPoint,
  b: PathPoint,
  thresholdM: number,
): boolean {
  return haversineMeters(a, b) >= thresholdM;
}

export function clampDeltaMs(dtMs: number, maxMs = 48): number {
  return Math.min(Math.max(dtMs, 0), maxMs);
}
