"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  earthCameraLimits,
  flyToRouteView,
  initialMapRange,
  loadMaps,
  preloadMapScene,
  routeCenter,
  watchMoveControls,
} from "@/lib/maps";
import type {
  MapStatus,
  Mode,
  Place,
  Route,
  RouteInfo,
} from "@/lib/route-types";

type Screen = "form" | "map";

function formatRouteInfo(route: google.maps.routes.Route): RouteInfo {
  const localized = route.localizedValues;
  if (localized?.distance && localized?.duration) {
    return {
      distance: localized.distance,
      duration: localized.duration,
    };
  }
  const distance = route.distanceMeters
    ? `${Math.round(route.distanceMeters / 1000)} km`
    : "—";
  const duration = route.durationMillis
    ? `${Math.round(route.durationMillis / 60_000)} min`
    : "—";
  return { distance, duration };
}

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

const MODES: { value: Mode; label: string }[] = [
  { value: "DRIVING", label: "Car" },
  { value: "WALKING", label: "Walk" },
  { value: "BICYCLING", label: "Bike" },
  { value: "TRANSIT", label: "Transit" },
];

function isPlaceSelected(place: Place | null): place is Place {
  return place !== null;
}

function toTravelMode(mode: Mode): google.maps.TravelMode {
  if (mode === "WALKING") return google.maps.TravelMode.WALKING;
  if (mode === "BICYCLING") return google.maps.TravelMode.BICYCLING;
  if (mode === "TRANSIT") return google.maps.TravelMode.TRANSIT;
  return google.maps.TravelMode.DRIVING;
}

function modeLabel(mode: Mode): string {
  return MODES.find((m) => m.value === mode)?.label ?? mode;
}

function PlaceField({
  apiKey,
  label,
  value,
  onSelect,
  onClear,
  allowCurrentLocation = false,
}: {
  apiKey: string;
  label: string;
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
  const readyLocationRef = useRef<{ lat: number; lng: number } | null>(null);

  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    if (
      !allowCurrentLocation ||
      typeof navigator === "undefined" ||
      !("geolocation" in navigator) ||
      !navigator.permissions?.query
    ) {
      return;
    }

    let dead = false;
    let permission: PermissionStatus | null = null;

    const clearLocation = () => {
      readyLocationRef.current = null;
      if (!dead) setReadyLocation(null);
    };

    const cacheLocation = (coords: GeolocationCoordinates) => {
      const next = { lat: coords.latitude, lng: coords.longitude };
      readyLocationRef.current = next;
      if (!dead) setReadyLocation(next);
    };

    const readGrantedLocation = () => {
      navigator.geolocation.getCurrentPosition(
        (position) => cacheLocation(position.coords),
        clearLocation,
        { maximumAge: 300_000, timeout: 8000, enableHighAccuracy: false },
      );
    };

    const syncPermission = () => {
      if (permission?.state === "granted") readGrantedLocation();
      else clearLocation();
    };

    navigator.permissions
      .query({ name: "geolocation" })
      .then((status) => {
        if (dead) return;
        permission = status;
        syncPermission();
        status.addEventListener("change", syncPermission);
      })
      .catch(() => {
        // Unsupported: do not show the option (would require a permission prompt).
      });

    return () => {
      dead = true;
      permission?.removeEventListener("change", syncPermission);
    };
  }, [allowCurrentLocation]);

  useEffect(() => {
    const onDocClick = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("pointerdown", onDocClick);
    return () => document.removeEventListener("pointerdown", onDocClick);
  }, []);

  const fetchSuggestions = (input: string) => {
    if (debounceRef.current) window.clearTimeout(debounceRef.current);

    if (input.trim().length < 2) {
      setSuggestions([]);
      setOpen(readyLocationRef.current !== null);
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

  const pickCurrentLocation = () => {
    const cached = readyLocationRef.current;
    if (!cached) return;

    setOpen(false);
    setLoading(true);

    void (async () => {
      const { lat, lng } = cached;
      let placeLabel = "Mi ubicación";

      try {
        await loadMaps(apiKey);
        const { Geocoder } = await google.maps.importLibrary("geocoding");
        const geocoder = new Geocoder();
        const { results } = await geocoder.geocode({ location: { lat, lng } });
        placeLabel = results[0]?.formatted_address ?? placeLabel;
      } catch {
        // Keep fallback label.
      }

      const selected: Place = { label: placeLabel, lat, lng };
      setText(selected.label);
      onSelect(selected);
      setLoading(false);
    })();
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
    <div ref={rootRef} className="relative grid gap-2">
      <span className="text-sm font-medium text-slate-400">{label}</span>
      <div className="relative">
        <input
          type="text"
          value={text}
          autoComplete="off"
          enterKeyHint="search"
          placeholder={`Buscar ${label.toLowerCase()}`}
          onChange={(event) => {
            const next = event.target.value;
            setText(next);
            if (next.trim() === "") onClear();
            fetchSuggestions(next);
          }}
          onFocus={() => {
            if (readyLocation || suggestions.length > 0) setOpen(true);
          }}
          className="min-h-12 w-full rounded-xl border border-slate-600 bg-white px-4 text-base text-slate-900 outline-none focus:border-sky-500 focus:ring-2 focus:ring-sky-500/30"
        />
        {loading && (
          <p className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs text-slate-400">
            ...
          </p>
        )}
      </div>
      {open && (readyLocation || suggestions.length > 0) && (
        <ul className="absolute top-full z-20 mt-1 max-h-56 w-full overflow-y-auto rounded-xl border border-slate-600 bg-white py-1 shadow-lg">
          {readyLocation && (
            <li>
              <button
                type="button"
                onClick={pickCurrentLocation}
                className="w-full border-b border-slate-100 px-4 py-3 text-left text-sm text-slate-900 active:bg-slate-100"
              >
                <span className="block font-medium text-sky-700">
                  Ubicación actual
                </span>
                <span className="block text-xs text-slate-500">
                  Ya disponible en este dispositivo
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
                  onClick={() => void pickSuggestion(suggestion)}
                  className="w-full px-4 py-3 text-left text-sm text-slate-900 active:bg-slate-100"
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

function Map3D({
  apiKey,
  route,
  northUp,
  onStatusChange,
}: {
  apiKey: string;
  route: Route;
  northUp: boolean;
  onStatusChange: (status: MapStatus) => void;
}) {
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<google.maps.maps3d.Map3DElement | null>(null);
  const onStatusRef = useRef(onStatusChange);
  onStatusRef.current = onStatusChange;

  const applyNorthUp = useCallback(() => {
    if (northUp && mapRef.current) {
      mapRef.current.heading = 0;
    }
  }, [northUp]);

  useEffect(() => {
    const el = host.current;
    if (!el) return;

    let map: google.maps.maps3d.Map3DElement | null = null;
    let stopWatchingControls: (() => void) | null = null;
    let dead = false;
    let routeAttached = false;

    onStatusRef.current({
      loading: true,
      phase: "map",
      error: null,
      info: null,
    });

    const attachRoute = async (
      mapEl: google.maps.maps3d.Map3DElement,
    ) => {
      if (dead || routeAttached) return;
      routeAttached = true;

      onStatusRef.current({
        loading: true,
        phase: "route",
        error: null,
        info: null,
      });

      const { Route3DElement } = await google.maps.importLibrary("routes");
      if (dead) return;

      const line = new Route3DElement({
        origin: { lat: route.origin.lat, lng: route.origin.lng },
        destination: { lat: route.destination.lat, lng: route.destination.lng },
        travelMode: toTravelMode(route.mode),
        autofitsCamera: false,
        routingPreference: "TRAFFIC_UNAWARE",
      });

      mapEl.append(line);

      line.addEventListener(
        "gmp-load",
        () => {
          if (mapEl) flyToRouteView(mapEl, route, northUp);
          applyNorthUp();
          const primary = line.routes?.[0];
          onStatusRef.current({
            loading: false,
            phase: null,
            error: null,
            info: primary ? formatRouteInfo(primary) : null,
          });
        },
        { once: true },
      );

      line.addEventListener(
        "gmp-error",
        () => {
          onStatusRef.current({
            loading: false,
            phase: null,
            error: "No se pudo calcular la ruta.",
            info: null,
          });
        },
        { once: true },
      );
    };

    const onSteady = (event: Event) => {
      const { isSteady } = event as google.maps.maps3d.SteadyChangeEvent;
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
        gestureHandling: "GREEDY",
        ...earthCameraLimits(),
      });
      map.style.width = "100%";
      map.style.height = "100%";

      el.replaceChildren(map);
      mapRef.current = map;
      stopWatchingControls = watchMoveControls(map);
      map.addEventListener("gmp-steadychange", onSteady);

      // Fallback if steady event is slow on some devices.
      window.setTimeout(() => {
        if (map) void attachRoute(map);
      }, 1200);
    })();

    return () => {
      dead = true;
      stopWatchingControls?.();
      map?.removeEventListener("gmp-steadychange", onSteady);
      mapRef.current = null;
      map?.remove();
      el.replaceChildren();
    };
  }, [apiKey, applyNorthUp, northUp, route]);

  return (
    <div
      ref={host}
      className="map-3d-host h-full w-full"
      style={{ touchAction: "none" }}
    />
  );
}

function FormScreen({
  apiKey,
  origin,
  destination,
  mode,
  northUp,
  onOrigin,
  onDestination,
  onOriginClear,
  onDestinationClear,
  onMode,
  onNorthUp,
  onSubmit,
}: {
  apiKey: string;
  origin: Place | null;
  destination: Place | null;
  mode: Mode;
  northUp: boolean;
  onOrigin: (p: Place) => void;
  onDestination: (p: Place) => void;
  onOriginClear: () => void;
  onDestinationClear: () => void;
  onMode: (m: Mode) => void;
  onNorthUp: (v: boolean) => void;
  onSubmit: () => void;
}) {
  const canSubmit = isPlaceSelected(origin) && isPlaceSelected(destination);
  return (
    <div className="google-banner-reserve-top flex min-h-dvh flex-col px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))]">
      <header className="mb-8">
        <h1 className="text-3xl font-semibold tracking-tight text-white">
          Route 3D
        </h1>
        <p className="mt-2 text-base text-slate-400">
          Plan your trip, then explore it in 3D.
        </p>
      </header>

      <div className="grid flex-1 content-start gap-5">
        <PlaceField
          apiKey={apiKey}
          label="Origin"
          value={origin?.label ?? ""}
          onSelect={onOrigin}
          onClear={onOriginClear}
          allowCurrentLocation
        />
        <PlaceField
          apiKey={apiKey}
          label="Destination"
          value={destination?.label ?? ""}
          onSelect={onDestination}
          onClear={onDestinationClear}
        />

        <div className="grid gap-2">
          <span className="text-sm font-medium text-slate-400">Transport</span>
          <div className="grid grid-cols-2 gap-2">
            {MODES.map((m) => (
              <button
                key={m.value}
                type="button"
                onClick={() => onMode(m.value)}
                className={`min-h-12 rounded-xl border text-sm font-medium transition active:scale-[0.98] ${
                  mode === m.value
                    ? "border-sky-500 bg-sky-500/15 text-white"
                    : "border-slate-700 bg-slate-900 text-slate-400"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex min-h-12 items-center gap-3 rounded-xl border border-slate-800 bg-slate-900/50 px-4">
          <input
            type="checkbox"
            checked={northUp}
            onChange={(e) => onNorthUp(e.target.checked)}
            className="size-4 rounded border-slate-600"
          />
          <span className="text-sm text-slate-300">Keep north up on map</span>
        </label>

      </div>

      <button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="mt-6 min-h-14 w-full rounded-2xl bg-sky-600 text-base font-semibold text-white transition active:scale-[0.98] active:bg-sky-500 disabled:cursor-not-allowed disabled:opacity-40"
      >
        View route in 3D
      </button>
    </div>
  );
}

function MapScreen({
  apiKey,
  route,
  northUp,
  onBack,
}: {
  apiKey: string;
  route: Route;
  northUp: boolean;
  onBack: () => void;
}) {
  const [status, setStatus] = useState<MapStatus>({
    loading: true,
    phase: "map",
    error: null,
    info: null,
  });
  const [panelOpen, setPanelOpen] = useState(true);

  return (
    <div className="relative h-dvh w-full bg-slate-950">
      <Map3D
        apiKey={apiKey}
        route={route}
        northUp={northUp}
        onStatusChange={setStatus}
      />

      {status.loading && status.phase === "map" && (
        <div className="pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-slate-950/50">
          <div className="rounded-2xl border border-white/15 bg-black/70 px-5 py-4 text-sm text-white backdrop-blur-md">
            Cargando mapa 3D...
          </div>
        </div>
      )}

      <div className="google-banner-reserve-top pointer-events-none absolute inset-x-0 top-0 z-10 p-3">
        <div className="pointer-events-auto flex items-start gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Volver"
            className="flex min-h-11 min-w-11 shrink-0 items-center justify-center rounded-full border border-white/20 bg-black/55 text-lg text-white backdrop-blur-md active:bg-black/75"
          >
            ←
          </button>

          {panelOpen ? (
            <div className="min-w-0 flex-1 rounded-2xl border border-white/15 bg-black/55 backdrop-blur-md">
              <button
                type="button"
                onClick={() => setPanelOpen(false)}
                className="w-full px-4 py-3 text-left"
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium text-white">
                      {route.origin.label}
                    </p>
                    <p className="truncate text-sm text-slate-300">
                      → {route.destination.label}
                    </p>
                  </div>
                  <span className="shrink-0 text-xs text-slate-400">▲</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                  <span className="rounded-full bg-white/10 px-2 py-1 text-slate-200">
                    {modeLabel(route.mode)}
                  </span>
                  {status.loading && status.phase === "route" && (
                    <span className="rounded-full bg-white/10 px-2 py-1 text-slate-300">
                      Calculando ruta...
                    </span>
                  )}
                  {status.info && (
                    <span className="rounded-full bg-sky-500/20 px-2 py-1 text-sky-200">
                      {status.info.distance} · {status.info.duration}
                    </span>
                  )}
                </div>
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setPanelOpen(true)}
              className="min-h-11 flex-1 truncate rounded-full border border-white/15 bg-black/55 px-4 text-left text-sm text-white backdrop-blur-md"
            >
              {status.info
                ? `${status.info.distance} · ${status.info.duration}`
                : "Ver ruta"}
            </button>
          )}
        </div>

        {status.error && (
          <p className="pointer-events-auto mt-2 rounded-xl border border-red-400/30 bg-red-950/80 px-4 py-2 text-sm text-red-200 backdrop-blur-md">
            {status.error}
          </p>
        )}
      </div>

      <a
        href={buildMapsUrl(route)}
        target="_blank"
        rel="noopener noreferrer"
        className="absolute bottom-[max(0.75rem,env(safe-area-inset-bottom))] left-3 z-10 rounded-full border border-white/15 bg-black/55 px-3 py-1.5 text-xs font-medium text-white backdrop-blur-md active:bg-black/75"
      >
        Google Maps
      </a>

      <p className="pointer-events-none absolute inset-x-0 bottom-[calc(max(0.75rem,env(safe-area-inset-bottom))+2.5rem)] z-0 px-4 text-center text-xs text-white/45">
        Un dedo: mover · Pellizca: zoom · Dos dedos: inclinar y girar
      </p>
    </div>
  );
}

export default function Page() {
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
  const [screen, setScreen] = useState<Screen>("form");
  const [origin, setOrigin] = useState<Place | null>(null);
  const [destination, setDestination] = useState<Place | null>(null);
  const [mode, setMode] = useState<Mode>("DRIVING");
  const [northUp, setNorthUp] = useState(true);
  const [route, setRoute] = useState<Route | null>(null);
  const [mapMounted, setMapMounted] = useState(false);

  useEffect(() => {
    if (apiKey) void preloadMapScene(apiKey);
  }, [apiKey]);

  const openMap = useCallback(() => {
    if (!isPlaceSelected(origin) || !isPlaceSelected(destination)) return;
    void preloadMapScene(apiKey);
    setRoute({ origin, destination, mode });
    setMapMounted(true);
    setScreen("map");
  }, [apiKey, destination, mode, origin]);

  const goBack = useCallback(() => {
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
          northUp={northUp}
          onOrigin={setOrigin}
          onDestination={setDestination}
          onOriginClear={() => setOrigin(null)}
          onDestinationClear={() => setDestination(null)}
          onMode={setMode}
          onNorthUp={setNorthUp}
          onSubmit={openMap}
        />
      </div>

      {mapMounted && route && (
        <div
          className={
            screen === "map"
              ? "fixed inset-0 z-50"
              : "pointer-events-none invisible fixed inset-0 -z-10"
          }
        >
          <MapScreen
            key={routeKey(route)}
            apiKey={apiKey}
            route={route}
            northUp={northUp}
            onBack={goBack}
          />
        </div>
      )}
    </>
  );
}
