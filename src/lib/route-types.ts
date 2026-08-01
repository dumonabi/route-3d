export type Mode = "DRIVING" | "WALKING" | "BICYCLING" | "TRANSIT";
export type Place = {
  label: string;
  lat: number;
  lng: number;
  isCurrentLocation?: boolean;
};
export type Route = {
  origin: Place;
  destination: Place;
  mode: Mode;
  originIsCurrentLocation?: boolean;
};

export type RouteInfo = { distance: string; duration: string };

export type NavigationGuidance = {
  instruction: string;
  distanceText: string | null;
  maneuver: string | null;
  rerouting: boolean;
  remainingText: string | null;
  nextInstruction?: string | null;
};

export type NavigationLiveState = {
  position: { lat: number; lng: number } | null;
  heading: number | null;
  fullPath: { lat: number; lng: number }[];
  remainingPath: { lat: number; lng: number }[];
  visiblePath: { lat: number; lng: number }[];
  /** Wrong-turn exits ahead (first ~500 m), light gray in guide view. */
  exitPaths: { lat: number; lng: number }[][];
  destination: { lat: number; lng: number };
};

export type MapStatus = {
  loading: boolean;
  phase: "map" | "route" | null;
  error: string | null;
  info: RouteInfo | null;
};
