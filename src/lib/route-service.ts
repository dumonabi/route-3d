import {
  buildCumulativeDistances,
  circlePath,
  haversineMeters,
  nearestPointOnPath,
  sliceRemainingPath,
  toPathPoint,
  type PathPoint,
} from "@/lib/route-geo";
import {
  buildExitStubsFromAlternatives,
  buildSyntheticExitStubs,
} from "@/lib/route-exits";
import type { Mode, Route } from "@/lib/route-types";

export type NavStep = {
  instruction: string;
  maneuver: string | null;
  distanceText: string | null;
  startDist: number;
  endDist: number;
};

export type RouteData = {
  googleRoute: google.maps.routes.Route;
  path: PathPoint[];
  cumDist: number[];
  totalMeters: number;
  steps: NavStep[];
  /** Short stubs for exits you should not take (first ~500 m). */
  exitStubs: PathPoint[][];
};

export type RouteRenderHandle = {
  remove: () => void;
  updateRemainingPath: (position: PathPoint) => void;
  resetPath: () => void;
};

function toTravelMode(mode: Mode): google.maps.TravelMode {
  if (mode === "WALKING") return google.maps.TravelMode.WALKING;
  if (mode === "BICYCLING") return google.maps.TravelMode.BICYCLING;
  if (mode === "TRANSIT") return google.maps.TravelMode.TRANSIT;
  return google.maps.TravelMode.DRIVING;
}

function stripHtml(text: string): string {
  return text
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function buildNavSteps(googleRoute: google.maps.routes.Route): NavStep[] {
  const steps: NavStep[] = [];
  let cum = 0;

  for (const leg of googleRoute.legs ?? []) {
    for (const step of leg.steps) {
      const stepPath = step.path?.map(toPathPoint) ?? [];
      let stepLen = step.distanceMeters ?? 0;
      if (stepLen <= 0 && stepPath.length > 1) {
        for (let i = 1; i < stepPath.length; i++) {
          stepLen += haversineMeters(stepPath[i - 1]!, stepPath[i]!);
        }
      }
      const startDist = cum;
      cum += stepLen;
      steps.push({
        instruction: stripHtml(step.instructions ?? "Continúa recto"),
        maneuver: step.maneuver ?? null,
        distanceText: step.localizedValues?.distance ?? null,
        startDist,
        endDist: cum,
      });
    }
  }

  return steps;
}

export async function fetchRouteData(
  route: Route,
  origin: PathPoint,
): Promise<RouteData> {
  const { Route: RouteClass } = await google.maps.importLibrary("routes");

  const request: google.maps.routes.ComputeRoutesRequest = {
    origin,
    destination: { lat: route.destination.lat, lng: route.destination.lng },
    travelMode: toTravelMode(route.mode),
    language: "es",
    units: google.maps.UnitSystem.METRIC,
    fields: [
      "path",
      "legs",
      "distanceMeters",
      "durationMillis",
      "localizedValues",
    ],
  };

  // routingPreference is only valid for DRIVE; it breaks walking/bike/transit.
  if (route.mode === "DRIVING") {
    request.routingPreference = "TRAFFIC_UNAWARE";
    request.computeAlternativeRoutes = true;
  }

  const { routes } = await RouteClass.computeRoutes(request);

  const googleRoute = routes?.[0];
  const path = googleRoute?.path?.map(toPathPoint);
  if (!googleRoute || !path?.length) {
    throw new Error("Route unavailable");
  }

  const cumDist = buildCumulativeDistances(path);
  const totalMeters = cumDist[cumDist.length - 1] ?? 0;
  const steps = buildNavSteps(googleRoute);

  const alternatives = (routes ?? [])
    .slice(1)
    .map((r) => r.path?.map(toPathPoint) ?? [])
    .filter((p) => p.length >= 2);

  // Prefer real OSM exits when available; keep Google alternatives + synthetic as fallback.
  const fromAlts = buildExitStubsFromAlternatives(path, cumDist, alternatives);
  const synthetic = buildSyntheticExitStubs(path, cumDist, steps);
  const exitStubs = [...fromAlts, ...synthetic];

  return {
    googleRoute,
    path,
    cumDist,
    totalMeters,
    steps,
    exitStubs,
  };
}

export async function renderRouteOnMap(
  map: google.maps.maps3d.Map3DElement,
  route: Route,
  origin: PathPoint,
  options: { showOriginMarker: boolean },
): Promise<{ handle: RouteRenderHandle; data: RouteData }> {
  const data = await fetchRouteData(route, origin);
  const elements: HTMLElement[] = [];
  const routeLines: google.maps.maps3d.Polyline3DElement[] = [];

  const polylines = await data.googleRoute.create3DPolylines();
  for (const line of polylines) {
    map.append(line);
    elements.push(line);
    routeLines.push(line);
  }

  const { Marker3DElement, Polygon3DElement, AltitudeMode } =
    await google.maps.importLibrary("maps3d");
  const { PinElement } = await google.maps.importLibrary("marker");

  const destMarker = new Marker3DElement({
    position: { lat: route.destination.lat, lng: route.destination.lng },
  });
  const destPin = new PinElement({
    background: "#ef4444",
    borderColor: "#ffffff",
    glyphText: "",
    scale: 1.1,
  });
  destMarker.append(destPin);
  map.append(destMarker);
  elements.push(destMarker);

  if (options.showOriginMarker) {
    const originDot = new Polygon3DElement({
      altitudeMode: AltitudeMode.CLAMP_TO_GROUND,
      fillColor: "#22c55e",
      strokeColor: "#ffffff",
      strokeWidth: 2.5,
      geodesic: true,
      drawsOccludedSegments: true,
      zIndex: 298,
      path: circlePath(origin, 22),
    });
    map.append(originDot);
    elements.push(originDot);
  }

  const applyPath = (path: PathPoint[]) => {
    for (const line of routeLines) {
      line.path = path;
    }
  };

  let lastTrimAt = 0;
  let lastTrimPos: PathPoint | null = null;

  return {
    data,
    handle: {
      remove: () => {
        for (const el of elements) el.remove();
      },
      updateRemainingPath: (position: PathPoint) => {
        const now = Date.now();
        if (
          lastTrimPos &&
          now - lastTrimAt < 120 &&
          haversineMeters(lastTrimPos, position) < 2
        ) {
          return;
        }
        lastTrimAt = now;
        lastTrimPos = position;

        const nearest = nearestPointOnPath(
          position,
          data.path,
          data.cumDist,
        );
        const remaining = sliceRemainingPath(
          data.path,
          data.cumDist,
          nearest.distanceAlong,
          nearest.point,
        );
        applyPath(remaining);
      },
      resetPath: () => {
        lastTrimPos = null;
        applyPath(data.path);
      },
    },
  };
}

export function findStepIndexForDistance(
  distanceAlong: number,
  steps: NavStep[],
  hintIndex = 0,
): number {
  if (!steps.length) return 0;
  let index = Math.min(Math.max(hintIndex, 0), steps.length - 1);
  while (index < steps.length - 1 && distanceAlong >= steps[index]!.endDist) {
    index++;
  }
  while (index > 0 && distanceAlong < steps[index]!.startDist) {
    index--;
  }
  return index;
}

export function findCurrentStep(
  distanceAlong: number,
  steps: NavStep[],
): NavStep | null {
  if (!steps.length) return null;
  return steps[findStepIndexForDistance(distanceAlong, steps)] ?? null;
}

export function distanceToStepManeuver(
  distanceAlong: number,
  step: NavStep,
): number {
  return Math.max(0, step.endDist - distanceAlong);
}
