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
};

export type MapStatus = {
  loading: boolean;
  phase: "map" | "route" | null;
  error: string | null;
  info: RouteInfo | null;
};
