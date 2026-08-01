import {
  bearingDegrees,
  haversineMeters,
  nearestPointOnPath,
  pointAlongPath,
  slicePathToMaxMeters,
  type PathPoint,
} from "@/lib/route-geo";

type StepLike = {
  maneuver: string | null;
  endDist: number;
};

export const EXIT_STUB_METERS = 500;
const DIVERGE_THRESHOLD_M = 28;
const BEARING_MATCH_DEG = 28;

/** Destination `meters` away from `from` at `bearingDeg` (0 = north). */
export function destinationPoint(
  from: PathPoint,
  bearingDeg: number,
  meters: number,
): PathPoint {
  const R = 6_371_000;
  const δ = meters / R;
  const θ = (bearingDeg * Math.PI) / 180;
  const φ1 = (from.lat * Math.PI) / 180;
  const λ1 = (from.lng * Math.PI) / 180;
  const sinφ1 = Math.sin(φ1);
  const cosφ1 = Math.cos(φ1);
  const sinδ = Math.sin(δ);
  const cosδ = Math.cos(δ);
  const φ2 = Math.asin(sinφ1 * cosδ + cosφ1 * sinδ * Math.cos(θ));
  const λ2 =
    λ1 +
    Math.atan2(
      Math.sin(θ) * sinδ * cosφ1,
      cosδ - sinφ1 * Math.sin(φ2),
    );
  return { lat: (φ2 * 180) / Math.PI, lng: (λ2 * 180) / Math.PI };
}

function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function bearingDelta(a: number, b: number): number {
  const d = Math.abs(normalizeBearing(a) - normalizeBearing(b));
  return Math.min(d, 360 - d);
}

function rayStub(
  from: PathPoint,
  bearingDeg: number,
  lengthM = EXIT_STUB_METERS,
  segments = 10,
): PathPoint[] {
  const points: PathPoint[] = [from];
  for (let i = 1; i <= segments; i++) {
    points.push(destinationPoint(from, bearingDeg, (lengthM * i) / segments));
  }
  return points;
}

function approachAndDeparture(
  path: PathPoint[],
  cumDist: number[],
  junctionDist: number,
): { junction: PathPoint; approach: number; departure: number } | null {
  const junction = pointAlongPath(path, junctionDist);
  const before = pointAlongPath(path, Math.max(0, junctionDist - 40));
  const after = pointAlongPath(
    path,
    Math.min(cumDist[cumDist.length - 1] ?? junctionDist, junctionDist + 40),
  );
  if (haversineMeters(before, junction) < 2 || haversineMeters(junction, after) < 2) {
    return null;
  }
  return {
    junction,
    approach: bearingDegrees(before, junction),
    departure: bearingDegrees(junction, after),
  };
}

/** Candidate wrong-exit bearings relative to approach / chosen departure. */
function wrongExitBearings(
  approach: number,
  departure: number,
  maneuver: string | null,
): number[] {
  const m = (maneuver ?? "").toUpperCase();
  const candidates: number[] = [];

  const add = (bearing: number) => {
    if (bearingDelta(bearing, departure) < BEARING_MATCH_DEG) return;
    if (candidates.some((c) => bearingDelta(c, bearing) < 18)) return;
    candidates.push(normalizeBearing(bearing));
  };

  if (/FORK_LEFT|KEEP_LEFT|RAMP_LEFT|TURN_KEEP_LEFT/.test(m)) {
    add(approach + 25);
    add(approach + 55);
    add(approach);
  } else if (/FORK_RIGHT|KEEP_RIGHT|RAMP_RIGHT|TURN_KEEP_RIGHT/.test(m)) {
    add(approach - 25);
    add(approach - 55);
    add(approach);
  } else if (/TURN_LEFT|LEFT/.test(m)) {
    add(approach);
    add(approach + 90);
  } else if (/TURN_RIGHT|RIGHT/.test(m)) {
    add(approach);
    add(approach - 90);
  } else if (/UTURN|U_TURN/.test(m)) {
    add(approach);
    add(approach + 90);
    add(approach - 90);
  } else if (/ROUNDABOUT|ROTARY/.test(m)) {
    add(approach + 60);
    add(approach + 120);
    add(approach - 60);
  } else {
    // Mild fork / continue: show nearby unused branches when departure bends.
    if (bearingDelta(approach, departure) > 18) {
      add(approach);
    }
    add(approach + 40);
    add(approach - 40);
  }

  return candidates.filter((b) => bearingDelta(b, departure) >= BEARING_MATCH_DEG);
}

/** Synthetic 500 m stubs for exits you should not take, at upcoming junctions. */
export function buildSyntheticExitStubs(
  path: PathPoint[],
  cumDist: number[],
  steps: StepLike[],
): PathPoint[][] {
  if (path.length < 3 || steps.length === 0) return [];

  const stubs: PathPoint[][] = [];
  for (let i = 0; i < steps.length - 1; i++) {
    const step = steps[i]!;
    const next = steps[i + 1];
    // Skip pure "continue" with no meaningful turn.
    const maneuver = step.maneuver ?? next?.maneuver ?? null;
    const info = approachAndDeparture(path, cumDist, step.endDist);
    if (!info) continue;

    const { junction, approach, departure } = info;
    if (bearingDelta(approach, departure) < 12 && !maneuver) continue;

    for (const bearing of wrongExitBearings(approach, departure, maneuver)) {
      stubs.push(rayStub(junction, bearing));
    }
  }
  return stubs;
}

/**
 * First ~500 m of each alternative after it diverges from the main path.
 */
export function buildExitStubsFromAlternatives(
  mainPath: PathPoint[],
  mainCum: number[],
  alternatives: PathPoint[][],
): PathPoint[][] {
  const stubs: PathPoint[][] = [];

  for (const alt of alternatives) {
    if (alt.length < 2) continue;
    let divergeIndex = -1;
    for (let i = 0; i < alt.length; i++) {
      const nearest = nearestPointOnPath(alt[i]!, mainPath, mainCum);
      if (nearest.offRouteMeters > DIVERGE_THRESHOLD_M) {
        divergeIndex = i;
        break;
      }
    }
    if (divergeIndex < 0) continue;

    const forkOnMain = nearestPointOnPath(
      alt[Math.max(0, divergeIndex - 1)]!,
      mainPath,
      mainCum,
    ).point;

    const branch = [forkOnMain, ...alt.slice(divergeIndex)];
    const stub = slicePathToMaxMeters(branch, EXIT_STUB_METERS);
    if (stub.length >= 2) stubs.push(stub);
  }

  return stubs;
}

/** Keep only exits whose junction is ahead within the visible corridor. */
export function filterExitsAhead(
  exits: PathPoint[][],
  remainingPath: PathPoint[],
  visibleMeters: number,
): PathPoint[][] {
  if (!exits.length || remainingPath.length < 2) return [];
  const remainingCum = [0];
  for (let i = 1; i < remainingPath.length; i++) {
    remainingCum.push(
      remainingCum[i - 1]! +
        haversineMeters(remainingPath[i - 1]!, remainingPath[i]!),
    );
  }

  return exits.filter((exit) => {
    const junction = exit[0];
    if (!junction) return false;
    const nearest = nearestPointOnPath(junction, remainingPath, remainingCum);
    return (
      nearest.offRouteMeters < 60 &&
      nearest.distanceAlong <= visibleMeters + 80
    );
  });
}
