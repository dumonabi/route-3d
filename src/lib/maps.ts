import type { Route } from "@/lib/route-types";

declare global {
  interface Window {
    __mapsReady?: Promise<void>;
    __mapSceneReady?: Promise<void>;
  }
}

let shadowDomPatched = false;

export function enableMap3DShadowAccess() {
  if (shadowDomPatched || typeof Element === "undefined") return;
  shadowDomPatched = true;
  const attachShadow = Element.prototype.attachShadow;
  Element.prototype.attachShadow = function (init: ShadowRootInit) {
    if (this.tagName === "GMP-MAP-3D") {
      return attachShadow.call(this, { ...init, mode: "open" });
    }
    return attachShadow.call(this, init);
  };
}

const MOVE_LABEL =
  /move|pan|north|south|east|west|up|down|left|right|arrow/i;

function isMoveControlGroup(el: Element): boolean {
  const buttons = [...el.querySelectorAll(":scope > button")];
  if (buttons.length !== 4) return false;
  const labels = buttons.map(
    (btn) =>
      btn.getAttribute("aria-label") ??
      btn.getAttribute("title") ??
      btn.textContent ??
      "",
  );
  return labels.filter((label) => MOVE_LABEL.test(label)).length >= 2;
}

export function hideMoveControls(map: HTMLElement): void {
  const root = map.shadowRoot;
  if (!root) return;
  for (const el of root.querySelectorAll("*")) {
    if (isMoveControlGroup(el)) {
      (el as HTMLElement).style.display = "none";
      return;
    }
  }
}

export function watchMoveControls(map: HTMLElement): () => void {
  enableMap3DShadowAccess();
  let runs = 0;
  const run = () => {
    if (runs++ > 6) return;
    hideMoveControls(map);
  };

  run();
  map.addEventListener("gmp-steadychange", run);
  const t1 = window.setTimeout(run, 400);
  const t2 = window.setTimeout(run, 1500);

  return () => {
    window.clearTimeout(t1);
    window.clearTimeout(t2);
    map.removeEventListener("gmp-steadychange", run);
  };
}

export function loadMaps(key: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Maps only runs in the browser"));
  }
  if (window.__mapsReady) return window.__mapsReady;

  window.__mapsReady = new Promise((resolve, reject) => {
    const g = { key, v: "alpha" };
    const w = window as Window & { google?: { maps?: Record<string, unknown> } };
    w.google = w.google ?? {};
    w.google.maps = w.google.maps ?? {};
    const m = w.google.maps;
    const libs = new Set<string>();
    const q = new URLSearchParams();
    let pending: Promise<void> | undefined;

    const boot = () =>
      pending ??
      (pending = new Promise<void>((ok, err) => {
        const s = document.createElement("script");
        q.set("libraries", [...libs].join(","));
        for (const [k, v] of Object.entries(g)) {
          q.set(k.replace(/[A-Z]/g, (c) => `_${c[0].toLowerCase()}`), v);
        }
        q.set("callback", "google.maps.__boot");
        s.src = `https://maps.googleapis.com/maps/api/js?${q}`;
        m.__boot = ok;
        s.onerror = () => err(new Error("Failed to load Google Maps"));
        document.head.appendChild(s);
      }));

    if (!m.importLibrary) {
      m.importLibrary = (lib: string) => {
        libs.add(lib);
        return boot().then(() =>
          (m.importLibrary as (lib: string) => Promise<unknown>)(lib),
        );
      };
    }

    (w.google!.maps!.importLibrary as (lib: string) => Promise<unknown>)(
      "maps",
    )
      .then(() => resolve())
      .catch(reject);
  });

  return window.__mapsReady;
}

/** Warm up 3D map + routes libraries while user fills the form. */
export function preloadMapScene(apiKey: string): Promise<void> {
  if (typeof window === "undefined") return Promise.resolve();
  if (window.__mapSceneReady) return window.__mapSceneReady;

  window.__mapSceneReady = loadMaps(apiKey).then(() =>
    Promise.all([
      google.maps.importLibrary("maps3d"),
      google.maps.importLibrary("routes"),
    ]).then(() => undefined),
  );

  return window.__mapSceneReady;
}

export function routeCenter(route: Route) {
  return {
    lat: (route.origin.lat + route.destination.lat) / 2,
    lng: (route.origin.lng + route.destination.lng) / 2,
    altitude: 0,
  };
}

export function routeDistanceKm(route: Route): number {
  const lat = route.origin.lat - route.destination.lat;
  const lng = route.origin.lng - route.destination.lng;
  return Math.hypot(lat, lng) * 111;
}

/** Higher range = less detail = faster first paint. */
export function initialMapRange(route: Route): number {
  const km = routeDistanceKm(route);
  return Math.min(Math.max(km * 2200, 100_000), 550_000);
}

/** Bearing from origin to destination in degrees (0 = north). */
export function routeHeading(route: Route): number {
  const from = route.origin;
  const to = route.destination;
  const dLng = ((to.lng - from.lng) * Math.PI) / 180;
  const lat1 = (from.lat * Math.PI) / 180;
  const lat2 = (to.lat * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x =
    Math.cos(lat1) * Math.sin(lat2) -
    Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

/** Camera range for an immersive route fly-in. */
export function routeFlyRange(route: Route): number {
  const km = routeDistanceKm(route);
  return Math.min(Math.max(km * 1400, 60_000), 420_000);
}

/** Unrestricted Earth-like camera limits. */
export function earthCameraLimits(): Pick<
  google.maps.maps3d.Map3DElementOptions,
  "maxTilt" | "minTilt" | "minAltitude" | "maxAltitude" | "fov"
> {
  return {
    maxTilt: 90,
    minTilt: 0,
    minAltitude: 5,
    maxAltitude: 30_000_000,
    fov: 50,
  };
}

/** Smooth cinematic fly-in along the route with strong tilt. */
export function flyToRouteView(
  map: google.maps.maps3d.Map3DElement,
  route: Route,
  northUp: boolean,
): void {
  map.flyCameraTo({
    durationMillis: 2200,
    endCamera: {
      center: routeCenter(route),
      range: routeFlyRange(route),
      tilt: 72,
      heading: northUp ? 0 : routeHeading(route),
    },
  });
}
