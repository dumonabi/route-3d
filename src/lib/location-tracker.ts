import type { PathPoint } from "@/lib/route-geo";
import { geolocationErrorMessage } from "@/lib/user-location-indicator";

export type LocationSample = {
  point: PathPoint;
  heading: number | null;
  accuracy: number | null;
  speed: number | null;
};

const STALE_REUSE_MS = 5 * 60_000;
const STALE_REPLAY_MS = 1_500;
const REFRESH_MS = 10_000;

const FAST_WATCH: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 600_000,
  timeout: 20_000,
};

const PRECISE_WATCH: PositionOptions = {
  enableHighAccuracy: true,
  maximumAge: 120_000,
  timeout: 20_000,
};

const INITIAL_CACHED: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 600_000,
  timeout: 3_000,
};

const REFRESH_OPTIONS: PositionOptions = {
  enableHighAccuracy: false,
  maximumAge: 600_000,
  timeout: 5_000,
};

let cachedLocation: { sample: LocationSample; at: number } | null = null;

export function peekLastKnownLocation(
  maxAgeMs = STALE_REUSE_MS,
): LocationSample | null {
  if (!cachedLocation) return null;
  if (Date.now() - cachedLocation.at > maxAgeMs) return null;
  return cachedLocation.sample;
}

function rememberSample(sample: LocationSample): void {
  cachedLocation = { sample, at: Date.now() };
}

function toSample(position: GeolocationPosition): LocationSample {
  return {
    point: {
      lat: position.coords.latitude,
      lng: position.coords.longitude,
    },
    heading: Number.isFinite(position.coords.heading)
      ? position.coords.heading
      : null,
    accuracy: Number.isFinite(position.coords.accuracy)
      ? position.coords.accuracy
      : null,
    speed: Number.isFinite(position.coords.speed) ? position.coords.speed : null,
  };
}

export function rememberLocationPoint(point: PathPoint): void {
  rememberSample({
    point,
    heading: null,
    accuracy: null,
    speed: null,
  });
}

export class LocationTracker {
  private fastWatchId: number | null = null;
  private preciseWatchId: number | null = null;
  private refreshTimer: number | null = null;
  private staleReplayTimer: number | null = null;
  private running = false;
  private onPosition: ((sample: LocationSample) => void) | null = null;
  private onError: ((message: string) => void) | null = null;
  private lastSampleAt = 0;
  private lastSuccessAt = 0;
  private lastKnown: LocationSample | null = null;

  get isRunning(): boolean {
    return this.running;
  }

  start(
    onPosition: (sample: LocationSample) => void,
    onError?: (message: string) => void,
  ): void {
    if (this.running || typeof navigator === "undefined") return;
    if (!("geolocation" in navigator)) {
      const stale = peekLastKnownLocation();
      if (stale) {
        onPosition(stale);
        return;
      }
      onError?.("Geolocalización no disponible en este navegador");
      return;
    }

    this.stop();
    this.running = true;
    this.onPosition = onPosition;
    this.onError = onError ?? null;

    const stale = peekLastKnownLocation();
    if (stale) {
      this.lastKnown = stale;
      this.lastSuccessAt = cachedLocation?.at ?? Date.now();
      this.lastSampleAt = this.lastSuccessAt;
      onPosition(stale);
    }

    const deliver = (position: GeolocationPosition) => {
      if (!this.running) return;
      const now = Date.now();
      const accuracy = position.coords.accuracy ?? null;

      // Drop noisy fast-watch updates if we already got a very recent precise fix.
      if (
        this.lastSampleAt !== 0 &&
        now - this.lastSampleAt < 350 &&
        (accuracy ?? 999) > 80
      ) {
        return;
      }

      const sample = toSample(position);
      this.lastSampleAt = now;
      this.lastSuccessAt = now;
      this.lastKnown = sample;
      rememberSample(sample);
      this.onPosition?.(sample);
    };

    const reportError = (error: GeolocationPositionError) => {
      // Keep using a recent fix instead of surfacing transient laptop timeouts.
      if (Date.now() - this.lastSuccessAt < STALE_REUSE_MS) return;
      this.onError?.(geolocationErrorMessage(error));
    };

    navigator.geolocation.getCurrentPosition(
      deliver,
      reportError,
      INITIAL_CACHED,
    );

    this.fastWatchId = navigator.geolocation.watchPosition(
      deliver,
      () => undefined,
      FAST_WATCH,
    );

    this.preciseWatchId = navigator.geolocation.watchPosition(
      deliver,
      reportError,
      PRECISE_WATCH,
    );

    this.refreshTimer = window.setInterval(() => {
      if (!this.running) return;
      navigator.geolocation.getCurrentPosition(
        deliver,
        () => undefined,
        REFRESH_OPTIONS,
      );
    }, REFRESH_MS);

    this.staleReplayTimer = window.setInterval(() => {
      if (!this.running || !this.lastKnown) return;
      const age = Date.now() - this.lastSuccessAt;
      if (age >= STALE_REPLAY_MS && age < STALE_REUSE_MS) {
        this.onPosition?.(this.lastKnown);
      }
    }, STALE_REPLAY_MS);
  }

  stop(): void {
    this.running = false;
    this.lastSampleAt = 0;
    this.lastSuccessAt = 0;
    this.lastKnown = null;
    if (this.fastWatchId !== null) {
      navigator.geolocation.clearWatch(this.fastWatchId);
      this.fastWatchId = null;
    }
    if (this.preciseWatchId !== null) {
      navigator.geolocation.clearWatch(this.preciseWatchId);
      this.preciseWatchId = null;
    }
    if (this.refreshTimer !== null) {
      window.clearInterval(this.refreshTimer);
      this.refreshTimer = null;
    }
    if (this.staleReplayTimer !== null) {
      window.clearInterval(this.staleReplayTimer);
      this.staleReplayTimer = null;
    }
    this.onPosition = null;
    this.onError = null;
  }
}
