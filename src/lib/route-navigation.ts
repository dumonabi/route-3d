import {
  formatMeters,
  nearestPointOnPath,
  type PathPoint,
} from "@/lib/route-geo";
import {
  distanceToStepManeuver,
  fetchRouteData,
  findStepIndexForDistance,
  type RouteData,
} from "@/lib/route-service";
import type { Mode, NavigationGuidance, Route } from "@/lib/route-types";

const REROUTE_COOLDOWN_MS = 12_000;
const STEP_ADVANCE_BUFFER_M = 15;

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
  private stepIndex = 0;

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

  updateRouteData(data: RouteData, distanceAlong?: number): void {
    this.data = data;
    this.stepIndex =
      distanceAlong == null
        ? 0
        : findStepIndexForDistance(distanceAlong, data.steps, this.stepIndex);
  }

  start(initialPosition?: PathPoint): void {
    this.running = true;
    this.stepIndex = 0;
    if (initialPosition) {
      void this.handlePosition(initialPosition);
    }
  }

  stop(): void {
    this.running = false;
    this.stepIndex = 0;
    this.onGuidance(null);
  }

  dispose(): void {
    this.stop();
  }

  handlePosition(point: PathPoint): void {
    if (!this.running) return;
    void this.onPosition(point);
  }

  private syncStepIndex(distanceAlong: number): void {
    this.stepIndex = findStepIndexForDistance(
      distanceAlong,
      this.data.steps,
      this.stepIndex,
    );
  }

  private currentStep() {
    return this.data.steps[this.stepIndex] ?? null;
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
        const nearestAfter = nearestPointOnPath(
          point,
          next.path,
          next.cumDist,
        );
        this.updateRouteData(next, nearestAfter.distanceAlong);
        this.emitGuidance(nearestAfter.distanceAlong);
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

    this.emitGuidance(nearest.distanceAlong);
  }

  private emitGuidance(distanceAlong: number): void {
    const data = this.data;
    const remainingM = Math.max(0, data.totalMeters - distanceAlong);
    const arrived = remainingM < 35;

    if (arrived) {
      this.onGuidance({
        instruction: "Has llegado al destino",
        distanceText: null,
        maneuver: "ARRIVE",
        rerouting: false,
        remainingText: null,
      });
      return;
    }

    while (
      this.stepIndex < data.steps.length - 1 &&
      distanceAlong >= data.steps[this.stepIndex]!.endDist - STEP_ADVANCE_BUFFER_M
    ) {
      this.stepIndex++;
    }

    while (
      this.stepIndex > 0 &&
      distanceAlong < data.steps[this.stepIndex]!.startDist - 25
    ) {
      this.stepIndex--;
    }

    const step = this.currentStep();
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

    const toManeuverM = distanceToStepManeuver(distanceAlong, step);
    const nextStep = data.steps[this.stepIndex + 1] ?? null;

    this.onGuidance({
      instruction: step.instruction,
      distanceText: formatMeters(toManeuverM),
      maneuver: step.maneuver,
      rerouting: false,
      remainingText: formatMeters(remainingM),
      nextInstruction: nextStep?.instruction ?? null,
    });
  }
}

export { fetchRouteData };
