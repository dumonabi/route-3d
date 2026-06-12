export type Mode = "DRIVING" | "WALKING" | "BICYCLING" | "TRANSIT";
export type Place = { label: string; lat: number; lng: number };
export type Route = { origin: Place; destination: Place; mode: Mode };

export type RouteInfo = { distance: string; duration: string };

export type MapStatus = {
  loading: boolean;
  phase: "map" | "route" | null;
  error: string | null;
  info: RouteInfo | null;
};
