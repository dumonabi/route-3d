import type { PathPoint } from "@/lib/route-geo";
import { bearingDegrees, haversineMeters } from "@/lib/route-geo";
import type { Route } from "@/lib/route-types";

const MAPS_VERSION = "alpha";

declare global {
  interface Window {
    __mapsReady?: Promise<void>;
    __mapSceneReady?: Promise<void>;
    __mapsVersion?: string;
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

if (typeof Element !== "undefined") {
  enableMap3DShadowAccess();
}

const ROTATE_LABEL =
  /rotate|rotation|girar|rotar|heading|orbit|clockwise|counterclockwise|horario|antihorario/i;

const TILT_LABEL =
  /tilt|incline|inclin|pitch|inclinar|inclinación|inclinacion/i;

const PAN_ZOOM_LABEL =
  /zoom|acercar|alejar|magnify|ampliar|reducir|range|closer|farther|alej|acerc|move\s+(the\s+)?map|pan\s+(the\s+)?map|mover\s+(el\s+)?mapa|desplaz|ward\b/i;

const DIRECTION_LABEL =
  /north|south|east|west|left|right|up|down|izquierda|derecha|arriba|abajo/i;

const CARDINAL_ONLY =
  /^(up|down|left|right|north|south|east|west|arriba|abajo|izquierda|derecha)$/i;

const DRAWER_LABEL =
  /expand|collapse|control panel|camera control|more control|menu|opciones|navigation control/i;

const GESTURE_HINT =
  /usa\s+\d|use\s+\d|dedos|fingers|two\s+finger|pellizca|pinch|arrastra|drag\s+to|inclinar|tilt|zoom/i;

function controlLabel(btn: Element): string {
  return (
    btn.getAttribute("aria-label") ??
    btn.getAttribute("title") ??
    btn.textContent ??
    ""
  ).trim();
}

function shouldKeepControl(label: string): boolean {
  if (!label) return false;
  if (PAN_ZOOM_LABEL.test(label)) return false;
  if (DRAWER_LABEL.test(label)) return false;
  if (CARDINAL_ONLY.test(label)) return false;
  if (
    /^(move|pan|mover|desplazar)/i.test(label) &&
    DIRECTION_LABEL.test(label) &&
    !ROTATE_LABEL.test(label) &&
    !TILT_LABEL.test(label)
  ) {
    return false;
  }
  if (ROTATE_LABEL.test(label)) return true;
  if (TILT_LABEL.test(label)) return true;
  return false;
}

function markHidden(el: HTMLElement): void {
  el.dataset.routeHidden = "true";
  el.style.setProperty("display", "none", "important");
}

function resetControlOverrides(root: ShadowRoot): void {
  for (const el of root.querySelectorAll<HTMLElement>("[data-route-hidden]")) {
    el.style.removeProperty("display");
    el.removeAttribute("data-route-hidden");
  }
  for (const el of root.querySelectorAll<HTMLElement>(
    "[data-route-camera-toolbar]",
  )) {
    el.removeAttribute("data-route-camera-toolbar");
    el.style.removeProperty("display");
    el.style.removeProperty("visibility");
    el.style.removeProperty("opacity");
  }
}

function isCompassButton(btn: Element): boolean {
  const label = controlLabel(btn).toLowerCase();
  return /compass|north|brújula|brujula/.test(label);
}

function isCameraDrawerToggle(btn: Element): boolean {
  const label = controlLabel(btn).toLowerCase();
  if (isCompassButton(btn)) return false;
  if (btn.getAttribute("aria-expanded") != null) return true;
  return DRAWER_LABEL.test(label);
}

function isInBottomChrome(rect: DOMRect, map: HTMLElement): boolean {
  const mapRect = map.getBoundingClientRect();
  return rect.bottom >= mapRect.bottom - 160 && rect.top >= mapRect.top;
}

function revealHiddenToolbar(root: ShadowRoot): boolean {
  let revealed = false;

  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    const pairKids = [...el.children].filter(
      (child) => child.querySelectorAll(":scope > button").length === 2,
    );
    if (pairKids.length < 4) continue;

    const style = getComputedStyle(el);
    const collapsed =
      style.display === "none" ||
      style.visibility === "hidden" ||
      el.hidden ||
      el.getAttribute("aria-hidden") === "true";

    if (!collapsed) continue;

    el.hidden = false;
    el.removeAttribute("hidden");
    el.setAttribute("aria-hidden", "false");
    el.style.removeProperty("display");
    el.style.removeProperty("visibility");
    revealed = true;
  }

  return revealed;
}

function findBottomExpandToggle(
  map: HTMLElement,
  root: ShadowRoot,
): HTMLElement | null {
  const mapRect = map.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestRight = 0;

  for (const btn of root.querySelectorAll<HTMLElement>("button")) {
    if (isCompassButton(btn)) continue;
    const rect = btn.getBoundingClientRect();
    if (rect.bottom < mapRect.bottom - 220) continue;
    if (rect.right > bestRight) {
      bestRight = rect.right;
      best = btn;
    }
  }

  return best;
}

/** Expand the collapsed camera-control drawer (otherwise only the compass shows). */
function expandCameraControls(map: HTMLElement, root: ShadowRoot): boolean {
  const pills = getBottomToolbarPills(root, map);
  if (pills.length >= 4) {
    map.dataset.route3dControlsExpanded = "true";
    return false;
  }

  if (revealHiddenToolbar(root)) return true;

  for (const el of root.querySelectorAll<HTMLElement>("[aria-expanded='false']")) {
    if (el.querySelector("button") && isCompassButton(el.querySelector("button")!)) {
      continue;
    }
    el.click();
    return true;
  }

  for (const btn of root.querySelectorAll<HTMLElement>("button")) {
    if (isCompassButton(btn)) continue;
    if (btn.getAttribute("aria-expanded") === "false") {
      btn.click();
      return true;
    }
  }

  const toggle = findBottomExpandToggle(map, root);
  if (toggle) {
    toggle.click();
    return true;
  }

  return false;
}

function findCameraToolbar(
  root: ShadowRoot,
  map: HTMLElement,
): HTMLElement | null {
  const mapRect = map.getBoundingClientRect();
  let best: HTMLElement | null = null;
  let bestScore = 0;

  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    const pairKids = [...el.children].filter(
      (child) => child.querySelectorAll(":scope > button").length === 2,
    );
    if (pairKids.length < 2) continue;

    const rect = el.getBoundingClientRect();
    if (rect.bottom < mapRect.bottom - 180) continue;

    const score = pairKids.length * 100 + rect.right;
    if (score > bestScore) {
      bestScore = score;
      best = el;
    }
  }

  return best;
}

/** Pairs of buttons in the bottom camera toolbar (zoom, pan, rotate, tilt…). */
function getBottomToolbarPills(
  root: ShadowRoot,
  map: HTMLElement,
): HTMLElement[] {
  const toolbar = findCameraToolbar(root, map);
  if (toolbar) {
    return [...toolbar.children]
      .filter((child) => child.querySelectorAll(":scope > button").length === 2)
      .map((child) => child as HTMLElement)
      .filter((pill) => isInBottomChrome(pill.getBoundingClientRect(), map))
      .sort(
        (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
      );
  }

  const mapRect = map.getBoundingClientRect();
  const pills: HTMLElement[] = [];

  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    const buttons = [...el.querySelectorAll(":scope > button")];
    if (buttons.length !== 2) continue;

    const rect = el.getBoundingClientRect();
    if (rect.bottom < mapRect.bottom - 180 || rect.height === 0) continue;

    const parent = el.parentElement;
    if (!parent) continue;
    const pairSiblings = [...parent.children].filter(
      (child) => child.querySelectorAll(":scope > button").length === 2,
    );
    if (pairSiblings.length < 2) continue;

    pills.push(el);
  }

  return pills.sort(
    (a, b) => a.getBoundingClientRect().left - b.getBoundingClientRect().left,
  );
}

function pillButtonLabels(pill: HTMLElement): string[] {
  return [...pill.querySelectorAll("button")].map(controlLabel);
}

/** Rotate left/right — user: inclinar izquierda y derecha. */
function isRotatePill(pill: HTMLElement): boolean {
  return pillButtonLabels(pill).some((label) => ROTATE_LABEL.test(label));
}

/** Tilt forward/back — user: inclinar alante y atrás. */
function isTiltPill(pill: HTMLElement): boolean {
  return pillButtonLabels(pill).some((label) => TILT_LABEL.test(label));
}

function isZoomOrPanPill(pill: HTMLElement): boolean {
  const labels = pillButtonLabels(pill).join(" ");
  if (labels && (PAN_ZOOM_LABEL.test(labels) || /^move |^pan /i.test(labels))) {
    return true;
  }
  const text = (pill.textContent ?? "").replace(/\s/g, "");
  if (text.includes("+") && text.includes("-")) return true;
  if (text.includes("<") && text.includes(">")) return true;
  if (text.includes("^") && text.includes("v")) return true;
  return false;
}

function shouldKeepPill(
  pill: HTMLElement,
  index: number,
  total: number,
): boolean {
  if (isRotatePill(pill) || isTiltPill(pill)) return true;
  if (isZoomOrPanPill(pill)) return false;
  if (total <= 2) return true;
  // Icon-only pills: last two in the bar are rotate + tilt.
  if (total >= 4 && index >= total - 2) return true;
  return false;
}

function hideZoomPanButton(btn: HTMLElement): void {
  const label = controlLabel(btn);
  if (shouldKeepControl(label)) return;
  if (PAN_ZOOM_LABEL.test(label) || /^move |^pan /i.test(label)) {
    markHidden(btn);
    return;
  }
  if (CARDINAL_ONLY.test(label)) {
    markHidden(btn);
  }
}

/** Hide Google's bottom gesture-hint overlay ("usa 2 dedos…"). */
function hideGestureHints(root: ShadowRoot): void {
  for (const el of root.querySelectorAll<HTMLElement>("*")) {
    const text = (el.textContent ?? "").replace(/\s+/g, " ").trim();
    if (text.length < 10 || text.length > 180) continue;
    if (!GESTURE_HINT.test(text)) continue;

    let target: HTMLElement = el;
    for (let depth = 0; depth < 5; depth++) {
      const parent = target.parentElement;
      if (!parent || parent === root as unknown as HTMLElement) break;
      target = parent;
    }
    markHidden(target);
  }
}

/** Expand drawer, then keep rotate + tilt in the bottom-right toolbar. */
export function hideMapControls(map: HTMLElement): void {
  const root = map.shadowRoot;
  if (!root) return;

  resetControlOverrides(root);
  hideGestureHints(root);

  if (expandCameraControls(map, root)) return;

  const pills = getBottomToolbarPills(root, map);
  if (pills.length < 4) return;

  const toolbar = pills[0]?.parentElement;

  pills.forEach((pill, index) => {
    if (shouldKeepPill(pill, index, pills.length)) {
      pill.style.removeProperty("display");
    } else {
      markHidden(pill);
    }
  });

  if (toolbar) {
    toolbar.style.removeProperty("display");
    for (const child of toolbar.children) {
      const el = child as HTMLElement;
      if (pills.includes(el)) continue;
      const btn = el.querySelector("button");
      if (btn && (isCompassButton(btn) || isCameraDrawerToggle(btn))) {
        markHidden(el);
        continue;
      }
      if (el.querySelector(":scope > button")) {
        markHidden(el);
      }
    }
  }
}

export function watchMoveControls(map: HTMLElement): () => void {
  enableMap3DShadowAccess();
  let debounceId: number | null = null;
  let observer: MutationObserver | null = null;

  const run = () => hideMapControls(map);

  const schedule = () => {
    if (debounceId !== null) window.clearTimeout(debounceId);
    debounceId = window.setTimeout(run, 200);
  };

  run();
  map.addEventListener("gmp-steadychange", run);

  const t1 = window.setTimeout(run, 300);
  const t2 = window.setTimeout(run, 800);
  const t3 = window.setTimeout(run, 2000);

  const root = map.shadowRoot;
  if (root) {
    observer = new MutationObserver(schedule);
    observer.observe(root, { childList: true, subtree: true });
  }

  return () => {
    if (debounceId !== null) window.clearTimeout(debounceId);
    observer?.disconnect();
    map.removeEventListener("gmp-steadychange", run);
    window.clearTimeout(t1);
    window.clearTimeout(t2);
    window.clearTimeout(t3);
  };
}

export function loadMaps(key: string): Promise<void> {
  if (typeof window === "undefined") {
    return Promise.reject(new Error("Maps only runs in the browser"));
  }
  if (window.__mapsReady && window.__mapsVersion === MAPS_VERSION) {
    return window.__mapsReady;
  }

  window.__mapsVersion = MAPS_VERSION;
  window.__mapSceneReady = undefined;

  window.__mapsReady = new Promise((resolve, reject) => {
    const g = { key, v: MAPS_VERSION };
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
      google.maps.importLibrary("marker"),
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
  return (
    haversineMeters(
      { lat: route.origin.lat, lng: route.origin.lng },
      { lat: route.destination.lat, lng: route.destination.lng },
    ) / 1000
  );
}

/** Ground span to fit on screen: trip length or bounding box, whichever is larger. */
export function routeSpanMeters(route: Route): number {
  const a = { lat: route.origin.lat, lng: route.origin.lng };
  const b = { lat: route.destination.lat, lng: route.destination.lng };
  const trip = haversineMeters(a, b);
  const midLat = (a.lat + b.lat) / 2;
  const latM = Math.abs(a.lat - b.lat) * 111_320;
  const lngM =
    Math.abs(a.lng - b.lng) * 111_320 * Math.cos((midLat * Math.PI) / 180);
  return Math.max(trip, latM, lngM, 200);
}

export function routeSpanFromPath(points: PathPoint[]): number {
  if (points.length === 0) return 200;
  let minLat = points[0]!.lat;
  let maxLat = points[0]!.lat;
  let minLng = points[0]!.lng;
  let maxLng = points[0]!.lng;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  const midLat = (minLat + maxLat) / 2;
  const latM = (maxLat - minLat) * 111_320;
  const lngM = (maxLng - minLng) * 111_320 * Math.cos((midLat * Math.PI) / 180);
  return Math.max(latM, lngM, 200);
}

export function pathCenter(points: PathPoint[]) {
  if (points.length === 0) return { lat: 0, lng: 0, altitude: 0 };
  let minLat = points[0]!.lat;
  let maxLat = points[0]!.lat;
  let minLng = points[0]!.lng;
  let maxLng = points[0]!.lng;
  for (const p of points) {
    minLat = Math.min(minLat, p.lat);
    maxLat = Math.max(maxLat, p.lat);
    minLng = Math.min(minLng, p.lng);
    maxLng = Math.max(maxLng, p.lng);
  }
  return {
    lat: (minLat + maxLat) / 2,
    lng: (minLng + maxLng) / 2,
    altitude: 0,
  };
}

/** Preview + navigation camera: same oblique angle as route overview. */
export const NAV_CAMERA_TILT = 72;
export const NAV_CAMERA_HEADING = 0;

/** In-navigation 3D panel: ~30° above the horizon, 2 km of route visible. */
export const NAVIGATION_CAMERA_TILT = 30;
export const NAVIGATION_VISIBLE_ROUTE_M = 2000;
export const NAVIGATION_VIEWPORT_HEIGHT_FRACTION = 1 / 3;

const ROUTE_VIEW_FOV = 50;

/**
 * Camera range that fits a ground span on screen (as close as possible with padding).
 * Accounts for oblique preview tilt and vertical field of view.
 */
export function cameraRangeForRouteView(
  spanMeters: number,
  tiltDeg = NAV_CAMERA_TILT,
  fovDeg = ROUTE_VIEW_FOV,
  viewportHeightFraction = 1,
): number {
  const padding = 1.42;
  const halfFovRad = ((fovDeg * Math.PI) / 180) / 2;
  const tiltRad = (tiltDeg * Math.PI) / 180;

  const baseRange = (spanMeters * padding) / (2 * Math.tan(halfFovRad));
  const obliqueFactor = 0.5 + 0.5 / Math.max(0.28, Math.cos(tiltRad));
  const viewportScale = 1 / Math.max(0.2, viewportHeightFraction);
  const range = baseRange * obliqueFactor * viewportScale;

  return Math.min(Math.max(Math.round(range), 320), 520_000);
}

export function navigationCameraRange(): number {
  return cameraRangeForRouteView(
    NAVIGATION_VISIBLE_ROUTE_M,
    NAVIGATION_CAMERA_TILT,
    ROUTE_VIEW_FOV,
    NAVIGATION_VIEWPORT_HEIGHT_FRACTION,
  );
}

export function resolveNavigationHeading(
  position: PathPoint,
  remainingPath: PathPoint[],
  deviceHeading: number | null,
): number {
  if (deviceHeading != null) return deviceHeading;
  const path = remainingPath.length >= 2 ? remainingPath : [position];
  if (path.length < 2) return 0;
  return bearingDegrees(path[0]!, path[1]!);
}

export function navigationCameraTarget(
  position: PathPoint,
  remainingPath: PathPoint[],
  deviceHeading: number | null = null,
): { center: google.maps.LatLngAltitudeLiteral; heading: number } {
  const path = remainingPath.length >= 2 ? remainingPath : [position, position];
  return {
    center: { lat: position.lat, lng: position.lng, altitude: 0 },
    heading: resolveNavigationHeading(position, path, deviceHeading),
  };
}

export function applyNavigationCamera(
  map: google.maps.maps3d.Map3DElement,
  position: PathPoint,
  remainingPath: PathPoint[],
  deviceHeading: number | null = null,
): void {
  const { center, heading } = navigationCameraTarget(
    position,
    remainingPath,
    deviceHeading,
  );
  map.center = center;
  map.range = navigationCameraRange();
  map.tilt = NAVIGATION_CAMERA_TILT;
  map.heading = heading;
}

export function flyToNavigationView(
  map: google.maps.maps3d.Map3DElement,
  position: PathPoint,
  remainingPath: PathPoint[],
  deviceHeading: number | null = null,
): void {
  const { center, heading } = navigationCameraTarget(
    position,
    remainingPath,
    deviceHeading,
  );
  map.flyCameraTo({
    durationMillis: 900,
    endCamera: {
      center,
      range: navigationCameraRange(),
      tilt: NAVIGATION_CAMERA_TILT,
      heading,
    },
  });
}

/** Initial map range before the route path is known. */
export function initialMapRange(route: Route): number {
  return cameraRangeForRouteView(routeSpanMeters(route));
}

/** Camera range for the route overview fly-in. */
export function routeFlyRange(route: Route, path?: PathPoint[]): number {
  const span = path?.length ? routeSpanFromPath(path) : routeSpanMeters(route);
  return cameraRangeForRouteView(span);
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
    fov: ROUTE_VIEW_FOV,
  };
}

/** Smooth cinematic fly-in along the route with strong tilt. */
export function flyToRouteView(
  map: google.maps.maps3d.Map3DElement,
  route: Route,
  options?: { path?: PathPoint[] },
): void {
  const path = options?.path;
  const center = path?.length ? pathCenter(path) : routeCenter(route);
  map.flyCameraTo({
    durationMillis: 2200,
    endCamera: {
      center,
      range: routeFlyRange(route, path),
      tilt: NAV_CAMERA_TILT,
      heading: NAV_CAMERA_HEADING,
    },
  });
}

/** Refit the map to the remaining journey (current position + destination). */
export function flyToRemainingRouteView(
  map: google.maps.maps3d.Map3DElement,
  current: PathPoint,
  destination: PathPoint,
  remainingPath?: PathPoint[],
): void {
  const path =
    remainingPath && remainingPath.length >= 2
      ? remainingPath
      : [current, destination];

  const framing: PathPoint[] = [current, ...path.slice(1), destination];
  const unique: PathPoint[] = [];
  for (const p of framing) {
    const last = unique[unique.length - 1];
    if (!last || haversineMeters(last, p) > 3) unique.push(p);
  }

  map.flyCameraTo({
    durationMillis: 1400,
    endCamera: {
      center: pathCenter(unique),
      range: cameraRangeForRouteView(routeSpanFromPath(unique)),
      tilt: NAV_CAMERA_TILT,
      heading: NAV_CAMERA_HEADING,
    },
  });
}
