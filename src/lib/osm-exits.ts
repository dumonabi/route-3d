import {
  bearingDegrees,
  buildCumulativeDistances,
  haversineMeters,
  nearestPointOnPath,
  slicePathToMaxMeters,
  type PathPoint,
} from "@/lib/route-geo";
import { EXIT_STUB_METERS } from "@/lib/route-exits";

const OVERPASS_URLS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

const HIGHWAY_REGEX =
  "^(motorway|trunk|primary|secondary|tertiary|unclassified|residential|living_street|service|motorway_link|trunk_link|primary_link|secondary_link|tertiary_link)$";

const NEAR_M = 18;
const FAR_M = 30;
const END_OFF_M = 45;
/** Reject stubs that mostly go back against travel (opposite carriageway). */
const MAX_TURN_FROM_APPROACH_DEG = 125;

type BBox = { south: number; west: number; north: number; east: number };

type OsmWayData = {
  points: PathPoint[];
  cum: number[];
  oneway: "yes" | "-1" | "no";
  layer: number;
  highway: string;
};

function pathBBox(path: PathPoint[], padMeters: number): BBox | null {
  if (path.length === 0) return null;
  let minLat = path[0]!.lat;
  let maxLat = path[0]!.lat;
  let minLng = path[0]!.lng;
  let maxLng = path[0]!.lng;
  for (const p of path) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const midLat = (minLat + maxLat) / 2;
  const padLat = padMeters / 111_320;
  const padLng =
    padMeters / (111_320 * Math.max(0.2, Math.cos((midLat * Math.PI) / 180)));
  return {
    south: minLat - padLat,
    north: maxLat + padLat,
    west: minLng - padLng,
    east: maxLng + padLng,
  };
}

function buildOverpassQuery(bbox: BBox): string {
  const { south, west, north, east } = bbox;
  return `
[out:json][timeout:25];
way["highway"~"${HIGHWAY_REGEX}"](${south},${west},${north},${east});
out body geom;
`.trim();
}

function parseLayer(tags: Record<string, string> | undefined): number {
  if (!tags) return 0;
  if (tags.layer != null && tags.layer !== "") {
    const n = Number(tags.layer);
    if (Number.isFinite(n)) return n;
  }
  if (tags.bridge && tags.bridge !== "no") return 1;
  if (tags.tunnel && tags.tunnel !== "no") return -1;
  return 0;
}

function parseOneway(
  tags: Record<string, string> | undefined,
  highway: string,
): "yes" | "-1" | "no" {
  const o = tags?.oneway;
  if (o === "yes" || o === "true" || o === "1") return "yes";
  if (o === "-1" || o === "reverse") return "-1";
  if (o === "no" || o === "false" || o === "0") return "no";
  if (
    highway === "motorway" ||
    highway === "motorway_link" ||
    tags?.junction === "roundabout" ||
    tags?.junction === "circular"
  ) {
    return "yes";
  }
  return "no";
}

function isDriveable(tags: Record<string, string> | undefined): boolean {
  if (!tags) return true;
  if (tags.access === "no" || tags.access === "private") return false;
  if (tags.vehicle === "no" || tags.motor_vehicle === "no") return false;
  if (tags.motorcar === "no") return false;
  return true;
}

function canTravel(oneway: OsmWayData["oneway"], forward: boolean): boolean {
  if (oneway === "no") return true;
  if (oneway === "yes") return forward;
  return !forward;
}

function normalizeBearing(deg: number): number {
  return ((deg % 360) + 360) % 360;
}

function bearingDelta(a: number, b: number): number {
  const d = Math.abs(normalizeBearing(a) - normalizeBearing(b));
  return Math.min(d, 360 - d);
}

type OsmElement = {
  type: string;
  tags?: Record<string, string>;
  geometry?: Array<{ lat: number; lon: number }>;
};

async function queryOverpass(bbox: BBox): Promise<OsmWayData[]> {
  const body = buildOverpassQuery(bbox);
  let lastError: unknown;

  for (const url of OVERPASS_URLS) {
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: `data=${encodeURIComponent(body)}`,
      });
      if (!res.ok) throw new Error(`Overpass ${res.status}`);
      const json = (await res.json()) as { elements?: OsmElement[] };
      const ways: OsmWayData[] = [];
      for (const el of json.elements ?? []) {
        if (el.type !== "way" || !el.geometry || el.geometry.length < 2) continue;
        if (!isDriveable(el.tags)) continue;
        const highway = el.tags?.highway ?? "";
        const points = el.geometry.map((g) => ({ lat: g.lat, lng: g.lon }));
        ways.push({
          points,
          cum: buildCumulativeDistances(points),
          oneway: parseOneway(el.tags, highway),
          layer: parseLayer(el.tags),
          highway,
        });
      }
      return ways;
    } catch (err) {
      lastError = err;
    }
  }

  console.warn("OSM exits unavailable", lastError);
  return [];
}

/** Layer of the recommended road near a point (from matching OSM ways). */
function mainLayerAt(
  point: PathPoint,
  ways: OsmWayData[],
  mainPath: PathPoint[],
  mainCum: number[],
): number {
  let best: { layer: number; score: number } | null = null;

  const nearMainPts = mainPath.filter((p) => haversineMeters(p, point) < 90);
  const mainBearing =
    nearMainPts.length >= 2
      ? bearingDegrees(nearMainPts[0]!, nearMainPts[nearMainPts.length - 1]!)
      : null;

  for (const way of ways) {
    const toWay = nearestPointOnPath(point, way.points, way.cum);
    if (toWay.offRouteMeters > 16) continue;

    let align = 1;
    if (mainBearing != null && way.points.length >= 2) {
      const ratio =
        toWay.distanceAlong / Math.max(1, way.cum[way.cum.length - 1]!);
      const i = Math.max(
        1,
        Math.min(
          way.points.length - 1,
          Math.round(ratio * (way.points.length - 1)),
        ),
      );
      const wayBearing = bearingDegrees(way.points[i - 1]!, way.points[i]!);
      const delta = bearingDelta(wayBearing, mainBearing);
      // Same sense as recommended path scores higher; opposite carriageway lower.
      align = delta < 45 ? 2.5 : delta > 135 ? 0.2 : 0.7;
    }

    const score = (align * 10) / (1 + toWay.offRouteMeters);
    if (!best || score > best.score) {
      best = { layer: way.layer, score };
    }
  }

  return best?.layer ?? 0;
}

function approachBearingAt(
  mainPath: PathPoint[],
  mainCum: number[],
  fork: PathPoint,
): number | null {
  const nearest = nearestPointOnPath(fork, mainPath, mainCum);
  const beforeDist = Math.max(0, nearest.distanceAlong - 40);
  if (nearest.distanceAlong - beforeDist < 8) return null;

  // Find points along main near beforeDist and nearest.distanceAlong
  let before = mainPath[0]!;
  let after = nearest.point;
  let bestBefore = Infinity;
  let bestAfter = Infinity;
  for (let i = 0; i < mainPath.length; i++) {
    const d = Math.abs(mainCum[i]! - beforeDist);
    if (d < bestBefore) {
      bestBefore = d;
      before = mainPath[i]!;
    }
    const d2 = Math.abs(mainCum[i]! - nearest.distanceAlong);
    if (d2 < bestAfter) {
      bestAfter = d2;
      after = mainPath[i]!;
    }
  }
  if (haversineMeters(before, after) < 3) return null;
  return bearingDegrees(before, after);
}

function stubIsDistinctExit(
  stub: PathPoint[],
  mainPath: PathPoint[],
  mainCum: number[],
): boolean {
  if (stub.length < 2) return false;
  const end = stub[stub.length - 1]!;
  const mid = stub[Math.floor(stub.length / 2)]!;
  const endOff = nearestPointOnPath(end, mainPath, mainCum).offRouteMeters;
  const midOff = nearestPointOnPath(mid, mainPath, mainCum).offRouteMeters;
  return endOff >= END_OFF_M && midOff >= 25;
}

function stubFollowsTravel(
  stub: PathPoint[],
  approach: number | null,
): boolean {
  if (approach == null || stub.length < 2) return true;
  const tip = stub[Math.min(4, stub.length - 1)]!;
  const stubBearing = bearingDegrees(stub[0]!, tip);
  return bearingDelta(approach, stubBearing) <= MAX_TURN_FROM_APPROACH_DEG;
}

/** True if this OSM way is mostly the recommended corridor itself. */
function isMostlyMainRoad(
  way: OsmWayData,
  mainPath: PathPoint[],
  mainCum: number[],
): boolean {
  const step = Math.max(1, Math.floor(way.points.length / 12));
  let near = 0;
  let samples = 0;
  for (let i = 0; i < way.points.length; i += step) {
    samples++;
    if (
      nearestPointOnPath(way.points[i]!, mainPath, mainCum).offRouteMeters < 14
    ) {
      near++;
    }
  }
  return samples > 0 && near / samples >= 0.72;
}

function pushStub(
  stubs: PathPoint[][],
  fork: PathPoint,
  branch: PathPoint[],
  mainPath: PathPoint[],
  mainCum: number[],
  approach: number | null,
): void {
  if (branch.length < 1) return;
  const stub = slicePathToMaxMeters([fork, ...branch], EXIT_STUB_METERS);
  if (!stubIsDistinctExit(stub, mainPath, mainCum)) return;
  if (!stubFollowsTravel(stub, approach)) return;

  const end = stub[stub.length - 1]!;
  const dup = stubs.some((existing) => {
    const e0 = existing[0]!;
    const e1 = existing[existing.length - 1]!;
    return haversineMeters(e0, fork) < 35 && haversineMeters(e1, end) < 60;
  });
  if (!dup) stubs.push(stub);
}

/**
 * Find ~500 m stubs where OSM ways leave the recommended path,
 * keeping only exits you could legally drive onto (same level, allowed sense).
 */
export function extractExitStubsFromWays(
  mainPath: PathPoint[],
  ways: OsmWayData[],
): PathPoint[][] {
  if (mainPath.length < 2 || ways.length === 0) return [];
  const mainCum = buildCumulativeDistances(mainPath);
  const stubs: PathPoint[][] = [];

  for (const way of ways) {
    if (way.points.length < 2) continue;
    if (isMostlyMainRoad(way, mainPath, mainCum)) continue;

    const off = way.points.map(
      (p) => nearestPointOnPath(p, mainPath, mainCum).offRouteMeters,
    );

    for (let i = 1; i < way.points.length; i++) {
      const prevNear = off[i - 1]! <= NEAR_M;
      const currFar = off[i]! >= FAR_M;
      const prevFar = off[i - 1]! >= FAR_M;
      const currNear = off[i]! <= NEAR_M;

      if (prevNear && currFar) {
        const junction = way.points[i - 1]!;
        const fork = nearestPointOnPath(junction, mainPath, mainCum).point;
        const mainLayer = mainLayerAt(fork, ways, mainPath, mainCum);
        if (way.layer !== mainLayer) continue;
        if (!canTravel(way.oneway, true)) continue;
        const approach = approachBearingAt(mainPath, mainCum, fork);
        pushStub(
          stubs,
          fork,
          way.points.slice(i),
          mainPath,
          mainCum,
          approach,
        );
      }

      if (prevFar && currNear) {
        const junction = way.points[i]!;
        const fork = nearestPointOnPath(junction, mainPath, mainCum).point;
        const mainLayer = mainLayerAt(fork, ways, mainPath, mainCum);
        if (way.layer !== mainLayer) continue;
        if (!canTravel(way.oneway, false)) continue;
        const approach = approachBearingAt(mainPath, mainCum, fork);
        pushStub(
          stubs,
          fork,
          way.points.slice(0, i).reverse(),
          mainPath,
          mainCum,
          approach,
        );
      }
    }
  }

  return stubs;
}

/**
 * Query navigable OSM highways around a corridor and return exit stubs
 * you could actually take if you left the recommended path.
 */
export async function fetchOsmExitStubs(
  corridorPath: PathPoint[],
): Promise<PathPoint[][]> {
  if (corridorPath.length < 2) return [];
  const bbox = pathBBox(corridorPath, 180);
  if (!bbox) return [];

  const ways = await queryOverpass(bbox);
  return extractExitStubsFromWays(corridorPath, ways);
}
