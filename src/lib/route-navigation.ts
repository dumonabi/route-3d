import {
  formatMeters,
  nearestPointOnPath,
  type PathPoint,
} from "@/lib/route-geo";
import {
  distanceToStepManeuver,
  fetchRouteData,
  findCurrentStep,
  type RouteData,
} from "@/lib/route-service";
import type { Mode, NavigationGuidance, Route } from "@/lib/route-types";

const REROUTE_COOLDOWN_MS = 12_000;

function offRouteThresholdM(mode: Mode): number {
  if (mode === "WALKING" || mode === "BICYCLING") return 30;
  return 55;
}

export class RouteNavigation {
  private readonly route: Route;
  private readonly onGuidance: (guidance: NavigationGuidance | null) => void;
  private readonly onReroute: (origin: PathPoint) => Promise<RouteData>;

  private data: RouteData;
  private running = false;
  private lastRerouteAt = 0;

  constructor(options: {
    route: Route;
    data: RouteData;
    onGuidance: (guidance: NavigationGuidance | null) => void;
    onReroute: (origin: PathPoint) => Promise<RouteData>;
  }) {
    this.route = options.route;
    this.data = options.data;
    this.onGuidance = options.onGuidance;
    this.onReroute = options.onReroute;
  }

  get isRunning(): boolean {
    return this.running;
  }

  updateRouteData(data: RouteData): void {
    this.data = data;
  }

  start(initialPosition?: PathPoint): void {
    this.running = true;
    if (initialPosition) {
      void this.handlePosition(initialPosition);
    }
  }

  stop(): void {
    this.running = false;
    this.onGuidance(null);
  }

  dispose(): void {
    this.stop();
  }

  handlePosition(point: PathPoint): void {
    if (!this.running) return;
    void this.onPosition(point);
  }

  private async onPosition(point: PathPoint): Promise<void> {
    if (!this.running) return;

    const nearest = nearestPointOnPath(
      point,
      this.data.path,
      this.data.cumDist,
    );
    const threshold = offRouteThresholdM(this.route.mode);

    if (
      nearest.offRouteMeters > threshold &&
      Date.now() - this.lastRerouteAt > REROUTE_COOLDOWN_MS
    ) {
      this.lastRerouteAt = Date.now();
      this.onGuidance({
        instruction: "Recalculando ruta…",
        distanceText: null,
        maneuver: null,
        rerouting: true,
        remainingText: null,
      });
      try {
        const next = await this.onReroute(point);
        this.updateRouteData(next);
        const nearestAfter = nearestPointOnPath(
          point,
          next.path,
          next.cumDist,
        );
        this.emitGuidance(point, next, nearestAfter.distanceAlong);
      } catch {
        this.onGuidance({
          instruction: "No se pudo recalcular la ruta",
          distanceText: null,
          maneuver: null,
          rerouting: false,
          remainingText: null,
        });
      }
      return;
    }

    this.emitGuidance(point, this.data, nearest.distanceAlong);
  }

  private emitGuidance(
    point: PathPoint,
    data: RouteData,
    distanceAlong: number,
  ): void {
    const nearest = nearestPointOnPath(point, data.path, data.cumDist);
    const along = Number.isFinite(distanceAlong)
      ? distanceAlong
      : nearest.distanceAlong;
    const step = findCurrentStep(along, data.steps);
    const remainingM = Math.max(0, data.totalMeters - along);

    if (!step) {
      this.onGuidance({
        instruction: "Continúa hacia el destino",
        distanceText: formatMeters(remainingM),
        maneuver: null,
        rerouting: false,
        remainingText: formatMeters(remainingM),
      });
      return;
    }

    const toManeuver = distanceToStepManeuver(along, step);
    const arrived = remainingM < 35;

    this.onGuidance({
      instruction: arrived ? "Has llegado al destino" : step.instruction,
      distanceText: arrived ? null : formatMeters(toManeuver),
      maneuver: step.maneuver,
      rerouting: false,
      remainingText: formatMeters(remainingM),
    });
  }
}

export { fetchRouteData };
