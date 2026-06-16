import { haversineMeters, type PathPoint } from "@/lib/route-geo";

export type UserLocationIndicator = {
  tick: (
    point: PathPoint,
    range: number | null,
    options?: { light?: boolean },
  ) => void;
  bringToFront: () => void;
  remove: () => void;
};

function circlePath(center: PathPoint, radiusM: number, segments = 28): PathPoint[] {
  const points: PathPoint[] = [];
  const latRad = (center.lat * Math.PI) / 180;
  const mPerDegLat = 111_320;
  const mPerDegLng = 111_320 * Math.cos(latRad);

  for (let i = 0; i <= segments; i++) {
    const angle = (i / segments) * 2 * Math.PI;
    points.push({
      lat: center.lat + (radiusM * Math.sin(angle)) / mPerDegLat,
      lng: center.lng + (radiusM * Math.cos(angle)) / mPerDegLng,
    });
  }
  return points;
}

export async function createUserLocationIndicator(
  map: google.maps.maps3d.Map3DElement,
): Promise<UserLocationIndicator> {
  const { Polygon3DElement, AltitudeMode } = await google.maps.importLibrary("maps3d");

  const halo = new Polygon3DElement({
    altitudeMode: AltitudeMode.CLAMP_TO_GROUND,
    fillColor: "#22c55e33",
    strokeColor: "#22c55e88",
    strokeWidth: 1.5,
    geodesic: true,
    drawsOccludedSegments: true,
    zIndex: 300,
  });

  const dot = new Polygon3DElement({
    altitudeMode: AltitudeMode.CLAMP_TO_GROUND,
    fillColor: "#22c55e",
    strokeColor: "#ffffff",
    strokeWidth: 2.5,
    geodesic: true,
    drawsOccludedSegments: true,
    zIndex: 301,
  });

  let currentPoint: PathPoint | null = null;
  let drawnPoint: PathPoint | null = null;
  let currentRange = map.range ?? 150_000;
  let drawnRange = currentRange;

  const mount = () => {
    map.append(halo);
    map.append(dot);
  };
  mount();

  const radiiForRange = (range: number) => {
    const safeRange = Math.max(250, range);
    const highAltitudeT = Math.min(1, Math.max(0, (safeRange - 25_000) / 275_000));
    const highAltitudeBoost = 1 + highAltitudeT * 0.45;
    const dotRadiusM = Math.max(6, safeRange * 0.00055 * highAltitudeBoost);
    const haloRadiusM = dotRadiusM * 2.6;
    return { dotRadiusM, haloRadiusM };
  };

  const redraw = () => {
    if (!currentPoint) return;
    const { dotRadiusM, haloRadiusM } = radiiForRange(currentRange);
    dot.path = circlePath(currentPoint, dotRadiusM);
    halo.path = circlePath(currentPoint, haloRadiusM);
    drawnPoint = currentPoint;
    drawnRange = currentRange;
  };

  const tick = (
    point: PathPoint,
    range: number | null,
    options?: { light?: boolean },
  ) => {
    currentPoint = point;
    if (range != null && Number.isFinite(range)) {
      currentRange = range;
    }

    const rangeDelta =
      drawnRange > 0 ? Math.abs(currentRange - drawnRange) / drawnRange : 1;
    const moved =
      !drawnPoint || haversineMeters(drawnPoint, point) >= (options?.light ? 1.2 : 0.25);
    const rangeChanged = rangeDelta >= (options?.light ? 0.025 : 0.008);

    if (!moved && !rangeChanged) return;
    redraw();
  };

  return {
    tick,
    bringToFront: mount,
    remove: () => {
      halo.remove();
      dot.remove();
    },
  };
}

export function geolocationErrorMessage(error: GeolocationPositionError): string {
  if (error.code === error.PERMISSION_DENIED) {
    return "Permite el acceso a la ubicación en el navegador";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "No se pudo obtener tu ubicación";
  }
  if (error.code === error.TIMEOUT) {
    return "Tiempo de espera agotado al buscar tu ubicación";
  }
  return "No se pudo obtener tu ubicación";
}
