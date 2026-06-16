export type PathPoint = { lat: number; lng: number };

const EARTH_RADIUS_M = 6_371_000;

export function haversineMeters(a: PathPoint, b: PathPoint): number {
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

export function toPathPoint(
  p: google.maps.LatLngAltitude | google.maps.LatLngAltitudeLiteral,
): PathPoint {
  return { lat: p.lat, lng: p.lng };
}

export function buildCumulativeDistances(points: PathPoint[]): number[] {
  const cumDist = [0];
  for (let i = 1; i < points.length; i++) {
    cumDist.push(cumDist[i - 1]! + haversineMeters(points[i - 1]!, points[i]!));
  }
  return cumDist;
}

export function interpolatePoint(a: PathPoint, b: PathPoint, t: number): PathPoint {
  return {
    lat: a.lat + (b.lat - a.lat) * t,
    lng: a.lng + (b.lng - a.lng) * t,
  };
}

export type NearestOnPath = {
  point: PathPoint;
  distanceAlong: number;
  offRouteMeters: number;
};

export function nearestPointOnPath(
  position: PathPoint,
  points: PathPoint[],
  cumDist: number[],
): NearestOnPath {
  if (points.length === 0) {
    return { point: position, distanceAlong: 0, offRouteMeters: 0 };
  }
  if (points.length === 1) {
    return {
      point: points[0]!,
      distanceAlong: 0,
      offRouteMeters: haversineMeters(position, points[0]!),
    };
  }

  let bestDist = Infinity;
  let bestAlong = 0;
  let bestPoint = points[0]!;

  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!;
    const b = points[i]!;
    const segLen = cumDist[i]! - cumDist[i - 1]!;
    if (segLen <= 0) continue;

    const t = projectOnSegment(position, a, b);
    const projected = interpolatePoint(a, b, t);
    const d = haversineMeters(position, projected);
    if (d < bestDist) {
      bestDist = d;
      bestAlong = cumDist[i - 1]! + t * segLen;
      bestPoint = projected;
    }
  }

  return {
    point: bestPoint,
    distanceAlong: bestAlong,
    offRouteMeters: bestDist,
  };
}

/** Path from the user's projected position to the destination. */
export function sliceRemainingPath(
  points: PathPoint[],
  cumDist: number[],
  distanceAlong: number,
  anchor: PathPoint,
): PathPoint[] {
  if (points.length === 0) return [anchor];

  let segmentEnd = 1;
  while (segmentEnd < cumDist.length && cumDist[segmentEnd]! <= distanceAlong) {
    segmentEnd++;
  }

  const remaining: PathPoint[] = [anchor];
  for (let i = segmentEnd; i < points.length; i++) {
    remaining.push(points[i]!);
  }
  if (remaining.length < 2 && points.length > 0) {
    remaining.push(points[points.length - 1]!);
  }
  return remaining;
}

function projectOnSegment(p: PathPoint, a: PathPoint, b: PathPoint): number {
  const latMid = ((a.lat + b.lat) / 2) * (Math.PI / 180);
  const ax = a.lng * Math.cos(latMid);
  const ay = a.lat;
  const bx = b.lng * Math.cos(latMid);
  const by = b.lat;
  const px = p.lng * Math.cos(latMid);
  const py = p.lat;
  const dx = bx - ax;
  const dy = by - ay;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return 0;
  return Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / lenSq));
}

/** Drone height above terrain; scales with route length. */
export function droneHeightMeters(routeMeters: number): number {
  const minHeight = 1_500;
  const maxHeight = 5_000;
  const rampMeters = 12_000;
  const t = Math.min(1, routeMeters / rampMeters);
  return Math.round(minHeight + t * (maxHeight - minHeight));
}

export function cameraRangeForHeight(heightM: number, tiltDeg: number): number {
  return heightM / Math.cos((tiltDeg * Math.PI) / 180);
}

export function formatMeters(meters: number): string {
  if (meters < 1000) return `${Math.round(meters / 10) * 10} m`;
  return `${(meters / 1000).toFixed(1)} km`;
}
