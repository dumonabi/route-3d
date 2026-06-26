"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  applyNavigationCamera,
  earthCameraLimits,
  flyToNavigationView,
  flyToRemainingRouteView,
  flyToRouteView,
  initialMapRange,
  loadMaps,
  NAVIGATION_VISIBLE_ROUTE_M,
  preloadMapScene,
  routeCenter,
} from "@/lib/maps";
import type { PathPoint } from "@/lib/route-geo";
import {
  bearingDegrees,
  nearestPointOnPath,
  slicePathToMaxMeters,
  sliceRemainingPath,
} from "@/lib/route-geo";
import {
  clampDeltaMs,
  hasMovedMeters,
  smoothPoint,
} from "@/lib/smooth-motion";
import { NavigationBottomPanel, NavigationTopPanel } from "@/components/NavigationScreen";
import {
  LocationTracker,
  peekLastKnownLocation,
  rememberLocationPoint,
  type LocationSample,
} from "@/lib/location-tracker";
import { RouteNavigation } from "@/lib/route-navigation";
import {
  renderRouteOnMap,
  type RouteData,
  type RouteRenderHandle,
} from "@/lib/route-service";
import {
  createUserLocationIndicator,
  type UserLocationIndicator,
} from "@/lib/user-location-indicator";
import type {
  MapStatus,
  Mode,
  NavigationGuidance,
  NavigationLiveState,
  Place,
  Route,
} from "@/lib/route-types";

type Screen = "form" | "map" | "navigation";

function routeKey(route: Route): string {
  return `${route.origin.lat},${route.origin.lng}|${route.destination.lat},${route.destination.lng}|${route.mode}`;
}

function buildMapsUrl(route: Route): string {
  const params = new URLSearchParams({
    api: "1",
    origin: `${route.origin.lat},${route.origin.lng}`,
    destination: `${route.destination.lat},${route.destination.lng}`,
    travelmode: route.mode.toLowerCase(),
  });
  return `https://www.google.com/maps/dir/?${params}`;
}

const MODES: { value: Mode; ariaLabel: string }[] = [
  { value: "DRIVING", ariaLabel: "Car" },
  { value: "WALKING", ariaLabel: "Walk" },
  { value: "BICYCLING", ariaLabel: "Bike" },
  { value: "TRANSIT", ariaLabel: "Train" },
];

const iconStroke = {
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 2.6,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
};

function OriginIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="9" fill="#22c55e" opacity="0.25" />
      <circle cx="12" cy="12" r="4.5" fill="#22c55e" />
    </svg>
  );
}

function DestinationIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        d="M12 3 C9 3 7 5.5 7 8.5 C7 13 12 21 12 21 C12 21 17 13 17 8.5 C17 5.5 15 3 12 3 Z"
        fill="#ef4444"
      />
      <circle cx="12" cy="8.8" r="2.2" fill="white" />
    </svg>
  );
}

function GpsIcon({ className = "h-5 w-5" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <circle cx="12" cy="12" r="3" fill="currentColor" />
      <path
        d="M12 2 V6 M12 18 V22 M2 12 H6 M18 12 H22"
        {...iconStroke}
      />
    </svg>
  );
}

/** Standard filled silhouettes (Material-style map icons). */
function ModeIcon({ mode, className = "h-full w-full" }: { mode: Mode; className?: string }) {
  if (mode === "DRIVING") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path
          fill="currentColor"
          d="M18.92 6.01C18.72 5.42 18.16 5 17.5 5h-11c-.66 0-1.21.42-1.42 1.01L3 12v8c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-1h12v1c0 .55.45 1 1 1h1c.55 0 1-.45 1-1v-8l-2.08-5.99zM6.5 16c-.83 0-1.5-.67-1.5-1.5S5.67 13 6.5 13s1.5.67 1.5 1.5S7.33 16 6.5 16zm11 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zM5 11l1.5-4.5h11L19 11H5z"
        />
      </svg>
    );
  }
  if (mode === "WALKING") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path
          fill="currentColor"
          d="M13.5 5.5c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zM9.8 8.9L7 23h2.1l1.8-8 2.1 2v6h2v-7.5l-2.1-2 .6-3C14.8 12 16.8 13 19 13v-2c-1.9 0-3.5-1-4.3-2.4l-1-1.6c-.4-.6-1-1-1.7-1-.3 0-.5.1-.8.1L6 8.3V13h2V9.6l1.8-.7"
        />
      </svg>
    );
  }
  if (mode === "BICYCLING") {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path
          fill="currentColor"
          d="M19 10c-.56 0-1.09.11-1.59.28L14.46 4.5H11V6h2.54l.88 1.72L12 13.13l-1.77-4.18c.27-.1.51-.37.51-.7c0-.41-.33-.75-.74-.75H8c-.42 0-.76.34-.76.75S7.58 9 8 9h.61l2.25 5.25h-.94C9.56 11.85 7.5 10 5 10c-2.76 0-5 2.24-5 5s2.24 5 5 5c2.5 0 4.56-1.85 4.92-4.25h2.58l2.79-6.32l.79 1.53A4.98 4.98 0 0 0 14 15c0 2.76 2.24 5 5 5s5-2.24 5-5s-2.24-5-5-5M5 18.5c-1.93 0-3.5-1.57-3.5-3.5s1.57-3.5 3.5-3.5c1.67 0 3.07 1.18 3.41 2.75H4v1.5h4.41A3.495 3.495 0 0 1 5 18.5m14 0c-1.93 0-3.5-1.57-3.5-3.5c0-1.08.5-2.03 1.27-2.67l1.8 3.52l1.32-.72l-1.79-3.5c.29-.07.59-.13.9-.13c1.93 0 3.5 1.57 3.5 3.5s-1.57 3.5-3.5 3.5"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M12 2c-4 0-8 .5-8 4v9.5C4 17.43 5.57 19 7.5 19L6 20.5v.5h2.23l2-2H14l2 2h2v-.5L16.5 19c1.93 0 3.5-1.57 3.5-3.5V6c0-3.5-3.58-4-8-4zM7.5 17c-.83 0-1.5-.67-1.5-1.5S6.67 14 7.5 14s1.5.67 1.5 1.5S8.33 17 7.5 17zm9 0c-.83 0-1.5-.67-1.5-1.5s.67-1.5 1.5-1.5 1.5.67 1.5 1.5-.67 1.5-1.5 1.5zm1.5-6H6V6h12v5z"
      />
    </svg>
  );
}

function View3DIcon({ className = "h-7 w-7" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path d="M4 8 L12 4 L20 8 L12 12 Z" fill="currentColor" opacity="0.35" />
      <path
        d="M4 8 V16 L12 20 V12 M20 8 V16 L12 20"
        {...iconStroke}
      />
    </svg>
  );
}

function isPlaceSelected(place: Place | null): place is Place {
  return place !== null;
}

const CURRENT_LOCATION_LABEL = "Mi ubicación actual";

function PlaceField({
  apiKey,
  ariaLabel,
  placeholder,
  icon,
  value,
  onSelect,
  onClear,
  allowCurrentLocation = false,
}: {
  apiKey: string;
  ariaLabel: string;
  placeholder: string;
  icon: ReactNode;
  value: string;
  onSelect: (place: Place) => void;
  onClear: () => void;
  allowCurrentLocation?: boolean;
}) {
  const [text, setText] = useState(value);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [readyLocation, setReadyLocation] = useState<{
    lat: number;
    lng: number;
  } | null>(null);
  const [suggestions, setSuggestions] = useState<
    google.maps.places.AutocompleteSuggestion[]
  >([]);
  const sessionRef =
    useRef<google.maps.places.AutocompleteSessionToken | null>(null);
  const debounceRef = useRef<number | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const readyLocationRef = useRef<{ lat: number; lng: number } | null>(null);
  const pickingLocationRef = useRef(false);

  useEffect(() => {
    if (value) setText(value);
  }, [value]);

  useEffect(() => {
    if (
      !allowCurrentLocation ||
      typeof navigator === "undefined" ||
      !("geolocation" in navigator)
    ) {
      return;
    }

    let dead = false;

    const cacheLocation = (coords: GeolocationCoordinates) => {
      const next = { lat: coords.latitude, lng: coords.longitude };
      readyLocationRef.current = next;
      rememberLocationPoint(next);
      if (!dead) setReadyLocation(next);
    };

    const tryReadLocation = () => {
      navigator.geolocation.getCurrentPosition(
        (position) => cacheLocation(position.coords),
        () => {
          // Retry with cached positions allowed (laptops often lack GPS).
        },
        { maximumAge: 300_000, timeout: 15_000, enableHighAccuracy: false },
      );
    };

    tryReadLocation();

    if (navigator.permissions?.query) {
      navigator.permissions
        .query({ name: "geolocation" as PermissionName })
        .then((status) => {
          if (dead) return;
          const sync = () => {
            if (status.state === "granted") tryReadLocation();
          };
          sync();
          status.addEventListener("change", sync);
        })
        .catch(() => undefined);
    }

    return () => {
      dead = true;
    };
  }, [allowCurrentLocation]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("click", onDocClick);
    return () => document.removeEventListener("click", onDocClick);
  }, []);

  const fetchSuggestions = (input: string) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    if (input.trim().length < 2) {
      setSuggestions([]);
      setOpen(allowCurrentLocation || readyLocationRef.current !== null);
      setLoading(false);
      return;
    }

    debounceRef.current = window.setTimeout(async () => {
      setLoading(true);
      try {
        await loadMaps(apiKey);
        const { AutocompleteSuggestion, AutocompleteSessionToken } =
          await google.maps.importLibrary("places");

        if (!sessionRef.current) {
          sessionRef.current = new AutocompleteSessionToken();
        }

        const { suggestions: results } =
          await AutocompleteSuggestion.fetchAutocompleteSuggestions({
            input,
            sessionToken: sessionRef.current,
            language: "es",
            region: "es",
          });

        setSuggestions(results.filter((item) => item.placePrediction));
        setOpen(true);
      } catch {
        setSuggestions([]);
        setOpen(false);
      } finally {
        setLoading(false);
      }
    }, 250);
  };

  const applyCurrentLocation = (lat: number, lng: number) => {
    const selected: Place = {
      label: CURRENT_LOCATION_LABEL,
      lat,
      lng,
      isCurrentLocation: true,
    };
    setText(CURRENT_LOCATION_LABEL);
    onSelect(selected);
  };

  const pickCurrentLocation = () => {
    if (pickingLocationRef.current) return;
    pickingLocationRef.current = true;

    setOpen(false);
    setLoading(true);
    setText("Obteniendo ubicación...");

    const finish = () => {
      pickingLocationRef.current = false;
    };

    const done = (lat: number, lng: number) => {
      readyLocationRef.current = { lat, lng };
      rememberLocationPoint({ lat, lng });
      setReadyLocation(readyLocationRef.current);
      applyCurrentLocation(lat, lng);
      setLoading(false);
      finish();
    };

    const fail = () => {
      const stale =
        readyLocationRef.current ?? peekLastKnownLocation()?.point ?? null;
      if (stale) {
        done(stale.lat, stale.lng);
        return;
      }
      setText("No se pudo obtener tu ubicación");
      setLoading(false);
      finish();
    };

    if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
      fail();
      return;
    }

    const attempts: PositionOptions[] = [
      // Mobile GPS: prefer a fresh high-accuracy fix on user tap.
      { enableHighAccuracy: true, maximumAge: 30_000, timeout: 12_000 },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 18_000 },
      { enableHighAccuracy: false, maximumAge: 600_000, timeout: 8_000 },
    ];

    const runAttempt = (index: number) => {
      navigator.geolocation.getCurrentPosition(
        (position) => done(position.coords.latitude, position.coords.longitude),
        () => {
          if (index + 1 < attempts.length) {
            runAttempt(index + 1);
            return;
          }

          const watchId = navigator.geolocation.watchPosition(
            (position) => {
              navigator.geolocation.clearWatch(watchId);
              done(position.coords.latitude, position.coords.longitude);
            },
            () => {
              navigator.geolocation.clearWatch(watchId);
              if (readyLocationRef.current) {
                done(
                  readyLocationRef.current.lat,
                  readyLocationRef.current.lng,
                );
                return;
              }
              fail();
            },
            { enableHighAccuracy: true, maximumAge: 60_000, timeout: 15_000 },
          );
        },
        attempts[index]!,
      );
    };

    runAttempt(0);
  };

  const onPickCurrentLocation = (event: React.PointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    inputRef.current?.blur();
    pickCurrentLocation();
  };

  const pickSuggestion = async (
    suggestion: google.maps.places.AutocompleteSuggestion,
  ) => {
    const prediction = suggestion.placePrediction;
    if (!prediction) return;

    setOpen(false);
    setSuggestions([]);
    setLoading(true);

    try {
      const place = prediction.toPlace();
      await place.fetchFields({
        fields: ["location", "formattedAddress", "displayName"],
      });
      const loc = place.location;
      if (!loc) return;

      const selected: Place = {
        label:
          place.formattedAddress ??
          place.displayName ??
          prediction.text.text,
        lat: loc.lat(),
        lng: loc.lng(),
      };
      setText(selected.label);
      onSelect(selected);
    } finally {
      sessionRef.current = null;
      setLoading(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <div className="relative">
        <span className="pointer-events-none absolute left-3.5 top-1/2 z-10 -translate-y-1/2">
          {icon}
        </span>
        <input
          ref={inputRef}
          type="search"
          value={text}
          autoComplete="off"
          enterKeyHint="search"
          aria-label={ariaLabel}
          placeholder={placeholder}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (next.trim() === "") onClear();
            else if (next.trim() !== CURRENT_LOCATION_LABEL) {
              fetchSuggestions(next);
            }
          }}
          onFocus={() => {
            setOpen(true);
            window.requestAnimationFrame(() => {
              inputRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
            });
          }}
          className={`min-h-14 w-full rounded-xl border border-slate-600 bg-white py-3 pl-12 text-base text-slate-900 outline-none placeholder:text-slate-400 focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30 ${
            allowCurrentLocation ? "pr-14" : "pr-4"
          }`}
        />
        {allowCurrentLocation && (
          <button
            type="button"
            onPointerDown={onPickCurrentLocation}
            aria-label="Mi ubicación actual"
            className="absolute right-1 top-1/2 z-20 flex h-12 w-12 -translate-y-1/2 touch-manipulation items-center justify-center rounded-full text-sky-600 active:bg-sky-50"
          >
            <GpsIcon className="h-6 w-6" />
          </button>
        )}
        {loading && (
          <p
            className={`pointer-events-none absolute top-1/2 -translate-y-1/2 text-xs text-slate-400 ${
              allowCurrentLocation ? "right-14" : "right-3"
            }`}
          >
            ...
          </p>
        )}
      </div>
      {open && (allowCurrentLocation || suggestions.length > 0) && (
        <ul className="absolute top-full z-30 mt-1 max-h-56 w-full overflow-y-auto overscroll-contain rounded-xl border border-slate-600 bg-white py-1 shadow-lg">
          {allowCurrentLocation && (
            <li>
              <button
                type="button"
                onPointerDown={onPickCurrentLocation}
                aria-label="Mi ubicación actual"
                className="flex min-h-12 w-full touch-manipulation items-center gap-3 border-b border-slate-100 px-4 py-3.5 text-left text-slate-900 active:bg-slate-100"
              >
                <span className="text-sky-600">
                  <GpsIcon className="h-6 w-6" />
                </span>
                <span className="text-sm font-semibold text-sky-700">
                  Mi ubicación actual
                </span>
              </button>
            </li>
          )}
          {suggestions.map((suggestion, index) => {
            const prediction = suggestion.placePrediction;
            if (!prediction) return null;
            return (
              <li key={`${prediction.placeId}-${index}`}>
                <button
                  type="button"
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    inputRef.current?.blur();
                    void pickSuggestion(suggestion);
                  }}
                  className="min-h-12 w-full touch-manipulation px-4 py-3 text-left text-sm text-slate-900 active:bg-slate-100"
                >
                  <span className="block font-medium">
                    {prediction.mainText?.text ?? prediction.text.text}
                  </span>
                  {prediction.secondaryText?.text && (
                    <span className="block text-xs text-slate-500">
                      {prediction.secondaryText.text}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function CompassNeedle({ heading }: { heading: number }) {
  return (
    <svg
      viewBox="0 0 32 32"
      className="h-9 w-9"
      style={{ transform: `rotate(${-heading}deg)` }}
      aria-hidden
    >
      <path
        d="M16 3.5 L21.5 17.5 L16 14.5 L10.5 17.5 Z"
        fill="#e53935"
        stroke="#b71c1c"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path
        d="M16 28.5 L10.5 14.5 L16 17.5 L21.5 14.5 Z"
        fill="#eceff1"
        stroke="#90a4ae"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="16" cy="16" r="2.8" fill="#37474f" />
    </svg>
  );
}

function TiltForwardIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 text-white" aria-hidden>
      <path
        d="M5 15 L12 8 L19 15"
        {...iconStroke}
      />
      <path d="M12 8 V19" {...iconStroke} />
      <path
        d="M7.5 17.5 L12 13 L16.5 17.5"
        fill="currentColor"
        stroke="none"
        opacity="0.35"
      />
    </svg>
  );
}

function TiltBackIcon() {
  return (
    <svg viewBox="0 0 24 24" className="h-7 w-7 text-white" aria-hidden>
      <path
        d="M5 9 L12 16 L19 9"
        {...iconStroke}
      />
      <path d="M12 16 V5" {...iconStroke} />
      <path
        d="M7.5 6.5 L12 11 L16.5 6.5"
        fill="currentColor"
        stroke="none"
        opacity="0.35"
      />
    </svg>
  );
}


function NavigationIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M12 2 L19 19 L12 15 L5 19 Z"
        opacity="0.9"
      />
    </svg>
  );
}

function NavLaunchButton({
  enabled,
  onClick,
}: {
  enabled: boolean;
  onClick: () => void;
}) {
  if (!enabled) return null;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Iniciar navegación"
      className="pointer-events-auto flex h-12 min-w-12 items-center justify-center gap-2 rounded-full border border-white/25 bg-black/75 px-4 text-sm font-semibold text-white shadow-lg backdrop-blur-md active:scale-[0.98] active:bg-black/90"
    >
      <NavigationIcon />
      <span>Navegar</span>
    </button>
  );
}

function CameraPills({
  mapRef,
}: {
  mapRef: { current: google.maps.maps3d.Map3DElement | null };
}) {
  const [heading, setHeading] = useState(0);

  useEffect(() => {
    let map: google.maps.maps3d.Map3DElement | null = null;
    let cancelled = false;

    const sync = () => {
      if (map) setHeading(map.heading ?? 0);
    };

    const attach = () => {
      if (cancelled) return;
      const next = mapRef.current;
      if (!next || next === map) return;
      map?.removeEventListener("gmp-headingchange", sync);
      map = next;
      sync();
      map.addEventListener("gmp-headingchange", sync);
    };

    attach();
    const id = window.setInterval(attach, 300);
    return () => {
      cancelled = true;
      window.clearInterval(id);
      map?.removeEventListener("gmp-headingchange", sync);
    };
  }, [mapRef]);

  const resetNorth = () => {
    const map = mapRef.current;
    if (!map) return;
    map.heading = 0;
    setHeading(0);
  };

  const adjustTilt = (delta: number) => {
    const map = mapRef.current;
    if (!map) return;
    const tilt = map.tilt ?? 0;
    map.tilt = Math.min(90, Math.max(0, tilt + delta));
  };

  const btn =
    "pointer-events-auto flex h-11 w-11 items-center justify-center text-white active:bg-white/15";
  const pill =
    "pointer-events-none flex overflow-hidden rounded-full border border-white/25 bg-black/75 shadow-lg backdrop-blur-md";

  return (
    <>
      <button
        type="button"
        className="pointer-events-auto flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-black/75 shadow-lg backdrop-blur-md active:bg-black/90"
        aria-label="Orientar al norte"
        onClick={resetNorth}
      >
        <CompassNeedle heading={heading} />
      </button>
      <div className={pill}>
        <button
          type="button"
          className={btn}
          aria-label="Inclinar adelante"
          onClick={() => adjustTilt(-10)}
        >
          <TiltForwardIcon />
        </button>
        <button
          type="button"
          className={btn}
          aria-label="Inclinar atrás"
          onClick={() => adjustTilt(10)}
        >
          <TiltBackIcon />
        </button>
      </div>
    </>
  );
}

function Map3D({
  apiKey,
  route,
  view,
  onStatusChange,
  onGuidanceChange,
  onLiveStateChange,
  onStartNavigation,
}: {
  apiKey: string;
  route: Route;
  view: "map" | "navigation";
  onStatusChange: (status: MapStatus) => void;
  onGuidanceChange: (guidance: NavigationGuidance | null) => void;
  onLiveStateChange: (state: NavigationLiveState) => void;
  onStartNavigation: () => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.maps3d.Map3DElement | null>(null);
  const routeHandleRef = useRef<RouteRenderHandle | null>(null);
  const locationRef = useRef<UserLocationIndicator | null>(null);
  const lastPositionRef = useRef<PathPoint | null>(null);
  const navRef = useRef<RouteNavigation | null>(null);
  const trackerRef = useRef<LocationTracker | null>(null);
  const onStatusRef = useRef(onStatusChange);
  const onGuidanceRef = useRef(onGuidanceChange);
  const onLiveStateRef = useRef(onLiveStateChange);
  onStatusRef.current = onStatusChange;
  onGuidanceRef.current = onGuidanceChange;
  onLiveStateRef.current = onLiveStateChange;

  const [routeData, setRouteData] = useState<RouteData | null>(null);
  const viewRef = useRef(view);
  viewRef.current = view;
  const routeDataRef = useRef<RouteData | null>(null);
  routeDataRef.current = routeData;
  const headingRef = useRef<number | null>(null);
  const prevHeadingPointRef = useRef<PathPoint | null>(null);
  const targetRef = useRef<PathPoint | null>(null);
  const displayRef = useRef<PathPoint | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastFrameAtRef = useRef(0);
  const mapSteadyRef = useRef(true);
  const lastRouteVisualRef = useRef<PathPoint | null>(null);

  const applyNorthUp = useCallback(() => {
    if (mapRef.current) {
      mapRef.current.heading = 0;
    }
  }, []);

  const emitLiveState = useCallback(
    (position: PathPoint | null) => {
      const data = routeDataRef.current;
      const dest = {
        lat: route.destination.lat,
        lng: route.destination.lng,
      };
      if (!position || !data) {
        onLiveStateRef.current({
          position,
          heading: headingRef.current,
          fullPath: [],
          remainingPath: position ? [position, dest] : [],
          visiblePath: position ? [position, dest] : [],
          destination: dest,
        });
        return;
      }

      const nearest = nearestPointOnPath(position, data.path, data.cumDist);
      const remaining = sliceRemainingPath(
        data.path,
        data.cumDist,
        nearest.distanceAlong,
        nearest.point,
      );
      const visible = slicePathToMaxMeters(
        remaining,
        NAVIGATION_VISIBLE_ROUTE_M,
      );

      let heading = headingRef.current;
      if (heading == null && remaining.length >= 2) {
        heading = bearingDegrees(remaining[0]!, remaining[1]!);
      }

      onLiveStateRef.current({
        position,
        heading,
        fullPath: data.path,
        remainingPath: remaining,
        visiblePath: visible,
        destination: dest,
      });
    },
    [route.destination.lat, route.destination.lng],
  );

  const updateHeading = useCallback((sample: LocationSample) => {
    const point = sample.point;
    if (sample.heading != null) {
      headingRef.current = sample.heading;
    } else {
      const prev = prevHeadingPointRef.current;
      if (prev && hasMovedMeters(prev, point, 4)) {
        headingRef.current = bearingDegrees(prev, point);
      }
    }
    prevHeadingPointRef.current = point;
  }, []);

  const rerouteFrom = useCallback(
    async (origin: PathPoint) => {
      const map = mapRef.current;
      if (!map) throw new Error("Map not ready");
      routeHandleRef.current?.remove();
      const { handle, data } = await renderRouteOnMap(map, route, origin, {
        showOriginMarker: !route.originIsCurrentLocation,
      });
      routeHandleRef.current = handle;
      setRouteData(data);
      routeDataRef.current = data;
      lastPositionRef.current = origin;
      locationRef.current?.tick(origin, mapRef.current?.range ?? null);
      locationRef.current?.bringToFront();
      handle.updateRemainingPath(origin);
      navRef.current?.updateRouteData(data);
      return data;
    },
    [route],
  );

  const handleLivePosition = useCallback((sample: LocationSample) => {
    const point = sample.point;
    lastPositionRef.current = point;
    targetRef.current = point;
    if (!displayRef.current) displayRef.current = point;
    updateHeading(sample);
    if (viewRef.current === "navigation") {
      emitLiveState(point);
    }
    navRef.current?.handlePosition(point);
  }, [emitLiveState, updateHeading]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    let map: google.maps.maps3d.Map3DElement | null = null;
    let dead = false;
    let routeAttached = false;

    onStatusRef.current({
      loading: true,
      phase: "map",
      error: null,
      info: null,
    });
    onGuidanceRef.current(null);
    setRouteData(null);

    const stopTracker = () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
    };

    const stopAnimation = () => {
      if (rafRef.current !== null) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    const animateLive = (now: number) => {
      const map = mapRef.current;
      const target = targetRef.current;
      const display = displayRef.current;
      if (!map || !target || !display) return;

      const dt = clampDeltaMs(
        lastFrameAtRef.current ? now - lastFrameAtRef.current : 16,
      );
      lastFrameAtRef.current = now;

      const next = smoothPoint(display, target, dt, 260);
      displayRef.current = next;

      const interacting = !mapSteadyRef.current;
      locationRef.current?.tick(next, map.range ?? null, { light: interacting });

      if (
        routeHandleRef.current &&
        (!interacting ||
          hasMovedMeters(lastRouteVisualRef.current ?? next, next, 8))
      ) {
        const trimThreshold = viewRef.current === "navigation" ? 0.8 : 1.5;
        if (
          hasMovedMeters(lastRouteVisualRef.current ?? next, next, trimThreshold)
        ) {
          routeHandleRef.current.updateRemainingPath(next);
          lastRouteVisualRef.current = next;
        }
      }

      if (viewRef.current === "navigation") {
        emitLiveState(next);
        const data = routeDataRef.current;
        if (data) {
          const nearest = nearestPointOnPath(next, data.path, data.cumDist);
          const remaining = sliceRemainingPath(
            data.path,
            data.cumDist,
            nearest.distanceAlong,
            nearest.point,
          );
          applyNavigationCamera(
            map,
            next,
            remaining,
            headingRef.current,
          );
        }
      }
    };

    const startAnimation = () => {
      stopAnimation();
      lastFrameAtRef.current = 0;
      const tick = (now: number) => {
        if (!document.hidden) {
          animateLive(now);
        }
        rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    };

    const startTracker = () => {
      if (!route.originIsCurrentLocation) return;
      stopTracker();
      const tracker = new LocationTracker();
      trackerRef.current = tracker;
      tracker.start(handleLivePosition, (message) => {
        if (viewRef.current !== "navigation") return;
        if (peekLastKnownLocation()) return;
        onGuidanceRef.current({
          instruction: message,
          distanceText: null,
          maneuver: null,
          rerouting: false,
          remainingText: null,
        });
      });
    };

    const attachRoute = async (mapEl: google.maps.maps3d.Map3DElement) => {
      if (dead || routeAttached) return;
      routeAttached = true;

      onStatusRef.current({
        loading: true,
        phase: "route",
        error: null,
        info: null,
      });

      try {
        if (dead) return;

        if (route.originIsCurrentLocation) {
          const seed = { lat: route.origin.lat, lng: route.origin.lng };
          lastPositionRef.current = seed;
          locationRef.current = await createUserLocationIndicator(mapEl);
          locationRef.current.tick(seed, mapEl.range ?? null);
          targetRef.current = seed;
          displayRef.current = seed;
          lastRouteVisualRef.current = seed;
        }

        const origin: PathPoint = {
          lat: route.origin.lat,
          lng: route.origin.lng,
        };
        const { handle, data } = await renderRouteOnMap(mapEl, route, origin, {
          showOriginMarker: !route.originIsCurrentLocation,
        });
        if (dead) {
          handle.remove();
          return;
        }

        routeHandleRef.current = handle;
        setRouteData(data);
        routeDataRef.current = data;

        if (route.originIsCurrentLocation) {
          handle.updateRemainingPath(
            lastPositionRef.current ?? origin,
          );
          locationRef.current?.bringToFront();
          startTracker();
          startAnimation();
        }

        if (mapEl) flyToRouteView(mapEl, route, { path: data.path });
        applyNorthUp();

        const localized = data.googleRoute.localizedValues;
        onStatusRef.current({
          loading: false,
          phase: null,
          error: null,
          info: localized?.distance && localized?.duration
            ? {
                distance: localized.distance,
                duration: localized.duration,
              }
            : {
                distance: data.googleRoute.distanceMeters
                  ? `${Math.round(data.googleRoute.distanceMeters / 1000)} km`
                  : "—",
                duration: data.googleRoute.durationMillis
                  ? `${Math.round(data.googleRoute.durationMillis / 60_000)} min`
                  : "—",
              },
        });
      } catch {
        if (!dead) {
          onStatusRef.current({
            loading: false,
            phase: null,
            error: "No se pudo calcular la ruta.",
            info: null,
          });
        }
      }
    };

    const onSteady = (event: Event) => {
      const { isSteady } = event as google.maps.maps3d.SteadyChangeEvent;
      mapSteadyRef.current = isSteady;
      if (!isSteady || !map || dead) return;
      void attachRoute(map);
    };

    (async () => {
      await preloadMapScene(apiKey);
      if (dead || !el) return;

      const { Map3DElement, MapMode } =
        await google.maps.importLibrary("maps3d");

      map = new Map3DElement({
        center: routeCenter(route),
        range: initialMapRange(route),
        tilt: 35,
        heading: 0,
        mode: MapMode.SATELLITE,
        defaultUIHidden: true,
        gestureHandling: "GREEDY",
        ...earthCameraLimits(),
      });
      map.style.width = "100%";
      map.style.height = "100%";

      el.replaceChildren(map);
      mapRef.current = map;
      map.addEventListener("gmp-steadychange", onSteady);

      window.setTimeout(() => {
        if (map) void attachRoute(map);
      }, 1200);
    })();

    return () => {
      dead = true;
      stopTracker();
      stopAnimation();
      navRef.current?.dispose();
      navRef.current = null;
      map?.removeEventListener("gmp-steadychange", onSteady);
      routeHandleRef.current?.remove();
      routeHandleRef.current = null;
      locationRef.current?.remove();
      locationRef.current = null;
      mapRef.current = null;
      map?.remove();
      el.replaceChildren();
    };
  }, [apiKey, applyNorthUp, handleLivePosition, route]);

  const startNavigation = useCallback(() => {
    if (!route.originIsCurrentLocation || !routeData) return;
    navRef.current?.dispose();
    const nav = new RouteNavigation({
      route,
      data: routeData,
      onGuidance: onGuidanceChange,
      onReroute: rerouteFrom,
    });
    navRef.current = nav;
    nav.start(lastPositionRef.current ?? undefined);
  }, [onGuidanceChange, rerouteFrom, route, routeData]);

  const stopNavigation = useCallback(() => {
    navRef.current?.dispose();
    navRef.current = null;
    onGuidanceChange(null);
  }, [onGuidanceChange]);

  useEffect(() => {
    if (view === "navigation" && routeData) {
      startNavigation();
      const map = mapRef.current;
      const p = lastPositionRef.current;
      emitLiveState(p);
      if (map && p) {
        const nearest = nearestPointOnPath(p, routeData.path, routeData.cumDist);
        const remaining = sliceRemainingPath(
          routeData.path,
          routeData.cumDist,
          nearest.distanceAlong,
          nearest.point,
        );
        flyToNavigationView(map, p, remaining, headingRef.current);
      }
      return () => {
        stopNavigation();
        const mapOnExit = mapRef.current;
        const data = routeDataRef.current;
        const position = lastPositionRef.current ?? displayRef.current;
        if (!mapOnExit || !data || !position) return;

        const dest = {
          lat: route.destination.lat,
          lng: route.destination.lng,
        };
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

        routeHandleRef.current?.updateRemainingPath(position);
        applyNorthUp();
        flyToRemainingRouteView(mapOnExit, position, dest, remaining);
      };
    }
    stopNavigation();
  }, [
    view,
    routeData,
    route.destination.lat,
    route.destination.lng,
    startNavigation,
    stopNavigation,
    emitLiveState,
    applyNorthUp,
  ]);

  return (
    <div className="relative h-full w-full">
      <div ref={host} className="map-3d-host h-full w-full" />
      {view === "map" && (
        <div className="pointer-events-none absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] right-3 z-10 flex flex-col items-end gap-2">
          <NavLaunchButton
            enabled={Boolean(route.originIsCurrentLocation && routeData)}
            onClick={onStartNavigation}
          />
          <CameraPills mapRef={mapRef} />
        </div>
      )}
    </div>
  );
}

function FormScreen({
  apiKey,
  origin,
  destination,
  mode,
  onOrigin,
  onDestination,
  onOriginClear,
  onDestinationClear,
  onMode,
  onSubmit,
}: {
  apiKey: string;
  origin: Place | null;
  destination: Place | null;
  mode: Mode;
  onOrigin: (p: Place) => void;
  onDestination: (p: Place) => void;
  onOriginClear: () => void;
  onDestinationClear: () => void;
  onMode: (m: Mode) => void;
  onSubmit: () => void;
}) {
  const canSubmit = isPlaceSelected(origin) && isPlaceSelected(destination);
  return (
    <div className="google-banner-reserve-top flex min-h-dvh flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <header className="mb-6 flex items-center gap-3">
        <View3DIcon className="h-10 w-10 text-sky-400" />
        <h1 className="text-3xl font-semibold tracking-tight text-white">
          Route 3D
        </h1>
      </header>

      <div className="grid flex-1 content-start gap-4">
        <PlaceField
          apiKey={apiKey}
          ariaLabel="Origin"
          placeholder="Origin"
          icon={<OriginIcon />}
          value={origin?.label ?? ""}
          onSelect={onOrigin}
          onClear={onOriginClear}
          allowCurrentLocation
        />
        <PlaceField
          apiKey={apiKey}
          ariaLabel="Destination"
          placeholder="Destination"
          icon={<DestinationIcon />}
          value={destination?.label ?? ""}
          onSelect={onDestination}
          onClear={onDestinationClear}
        />

        <div className="grid grid-cols-4 gap-2 justify-items-center">
          {MODES.map((m) => (
            <button
              key={m.value}
              type="button"
              aria-label={m.ariaLabel}
              aria-pressed={mode === m.value}
              onClick={() => onMode(m.value)}
              className={`flex h-12 w-12 items-center justify-center rounded-xl border p-1.5 transition active:scale-[0.97] ${
                mode === m.value
                  ? "border-sky-500 bg-sky-500/20 text-white"
                  : "border-slate-700 bg-slate-900 text-slate-300"
              }`}
            >
              <ModeIcon mode={m.value} className="h-8 w-8" />
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        aria-label="Ver ruta en 3D"
        className="mt-6 flex min-h-16 w-full items-center justify-center gap-3 rounded-2xl bg-sky-600 text-lg font-semibold text-white transition active:scale-[0.98] active:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        <View3DIcon />
        <span>3D</span>
      </button>
    </div>
  );
}

function MapScreen({
  apiKey,
  route,
  view,
  onViewChange,
  onBackToForm,
}: {
  apiKey: string;
  route: Route;
  view: "map" | "navigation";
  onViewChange: (view: "map" | "navigation") => void;
  onBackToForm: () => void;
}) {
  const [status, setStatus] = useState<MapStatus>({
    loading: true,
    phase: "map",
    error: null,
    info: null,
  });
  const [guidance, setGuidance] = useState<NavigationGuidance | null>(null);
  const [live, setLive] = useState<NavigationLiveState>(() => ({
    position: null,
    heading: null,
    fullPath: [],
    remainingPath: [],
    visiblePath: [],
    destination: {
      lat: route.destination.lat,
      lng: route.destination.lng,
    },
  }));

  return (
    <div
      className={
        view === "navigation"
          ? "grid h-dvh w-full grid-rows-3 bg-slate-950"
          : "relative h-dvh w-full bg-slate-950"
      }
    >
      {view === "navigation" && (
        <div className="relative z-20 min-h-0">
          <NavigationTopPanel
            live={live}
            destinationLabel={route.destination.label}
            onBack={() => onViewChange("map")}
          />
        </div>
      )}

      <div
        className={
          view === "navigation"
            ? "relative z-10 min-h-0"
            : "absolute inset-0"
        }
      >
        <Map3D
          apiKey={apiKey}
          route={route}
          view={view}
          onStatusChange={setStatus}
          onGuidanceChange={setGuidance}
          onLiveStateChange={setLive}
          onStartNavigation={() => onViewChange("navigation")}
        />
      </div>

      {view === "navigation" && (
        <div className="relative z-20 min-h-0">
          <NavigationBottomPanel guidance={guidance} />
        </div>
      )}

      {view === "map" && status.loading && status.phase === "map" && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/50">
          <div className="rounded-2xl border border-white/15 bg-black/70 px-5 py-4 text-sm text-white backdrop-blur-md">
            Cargando mapa 3D...
          </div>
        </div>
      )}

      {view === "map" && (
        <>
          <div className="google-banner-reserve-top pointer-events-none absolute inset-x-0 top-0 z-10 p-3">
            <button
              type="button"
              onClick={onBackToForm}
              aria-label="Atrás"
              className="pointer-events-auto flex h-14 w-14 items-center justify-center rounded-full border border-sky-300/35 bg-sky-600 text-2xl font-semibold text-white shadow-lg backdrop-blur-md active:scale-[0.97] active:bg-sky-500"
            >
              ←
            </button>
          </div>

          {status.error && (
            <p className="pointer-events-none absolute inset-x-3 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+3.25rem)] z-10 rounded-xl border border-red-400/30 bg-red-950/80 px-4 py-2 text-center text-sm text-red-200 backdrop-blur-md">
              {status.error}
            </p>
          )}

          <a
            href={buildMapsUrl(route)}
            target="_blank"
            rel="noopener noreferrer"
            className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 z-10 flex min-h-11 items-center rounded-full border border-white/20 bg-black/65 px-4 py-2.5 text-sm font-semibold text-white shadow-md backdrop-blur-md active:bg-black/80"
          >
            Google Maps
          </a>
        </>
      )}
    </div>
  );
}

export default function Page() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const [screen, setScreen] = useState<Screen>("form");
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [mode, setMode] = useState<Mode>("DRIVING");
  const [route, setRoute] = useState<Route | null>(null);
  const [mapMounted, setMapMounted] = useState(false);

  useEffect(() => {
    if (apiKey) void preloadMapScene(apiKey);
  }, [apiKey]);

  const openMap = useCallback(() => {
    if (!isPlaceSelected(origin) || !isPlaceSelected(destination)) return;
    void preloadMapScene(apiKey);
    setRoute({
      origin,
      destination,
      mode,
      originIsCurrentLocation: origin.isCurrentLocation ?? false,
    });
    setMapMounted(true);
    setScreen("map");
  }, [apiKey, destination, mode, origin]);

  const goBackToForm = useCallback(() => {
    setScreen("form");
  }, []);

  if (!apiKey) {
    return (
      <main className="flex min-h-dvh items-center px-6 py-8">
        <div className="grid gap-3">
          <h1 className="text-2xl font-semibold">Route 3D</h1>
          <p className="text-slate-400">
            Add{" "}
            <code className="text-slate-200">NEXT_PUBLIC_GOOGLE_MAPS_API_KEY</code>{" "}
            to <code className="text-slate-200">.env.local</code>
          </p>
        </div>
      </main>
    );
  }

  return (
    <>
      <div className={screen === "form" ? "contents" : "hidden"}>
        <FormScreen
          apiKey={apiKey}
          origin={origin}
          destination={destination}
          mode={mode}
          onOrigin={setOrigin}
          onDestination={setDestination}
          onOriginClear={() => setOrigin(null)}
          onDestinationClear={() => setDestination(null)}
          onMode={setMode}
          onSubmit={openMap}
        />
      </div>

      {mapMounted && route && (
        <div
          className={
            screen === "form"
              ? "pointer-events-none invisible fixed inset-0 -z-10"
              : "fixed inset-0 z-50"
          }
        >
          <MapScreen
            key={routeKey(route)}
            apiKey={apiKey}
            route={route}
            view={screen === "navigation" ? "navigation" : "map"}
            onViewChange={(view) => setScreen(view)}
            onBackToForm={goBackToForm}
          />
        </div>
      )}
    </>
  );
}
