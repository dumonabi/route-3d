"use client";

import { toLocalMeters, type PathPoint } from "@/lib/route-geo";

type BaseProps = {
  destination: PathPoint;
  className?: string;
  large?: boolean;
};

function emptyPlaceholder(className: string, label: string) {
  return (
    <div
      className={`flex items-center justify-center rounded-xl border border-white/15 bg-black/50 ${className}`}
      aria-hidden
    >
      <span className="text-xs text-white/30">{label}</span>
    </div>
  );
}

function projectBBox(
  anchor: PathPoint,
  points: { x: number; y: number }[],
  padFraction: number,
  minPadM: number,
) {
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    maxX = Math.max(maxX, p.x);
    minY = Math.min(minY, p.y);
    maxY = Math.max(maxY, p.y);
  }
  if (!Number.isFinite(minX)) {
    minX = -minPadM;
    maxX = minPadM;
    minY = -minPadM;
    maxY = minPadM;
  }
  const span = Math.max(maxX - minX, maxY - minY, 1);
  const pad = Math.max(span * padFraction, minPadM);
  minX -= pad;
  maxX += pad;
  minY -= pad;
  maxY += pad;

  const size = 100;
  const scale = size / Math.max(maxX - minX, maxY - minY);

  const project = (p: { x: number; y: number }) => ({
    x: (p.x - minX) * scale,
    y: size - (p.y - minY) * scale,
  });

  const toLine = (local: { x: number; y: number }[]) =>
    local
      .map((p) => {
        const { x, y } = project(p);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ");

  return { size, project, toLine };
}

/** Full route from origin to destination, north up. */
export function NavigationFullRoutePreview({
  fullPath,
  destination,
  className = "",
  large = false,
}: BaseProps & { fullPath: PathPoint[] }) {
  if (fullPath.length < 2) {
    return emptyPlaceholder(className, "Total");
  }

  const anchor = fullPath[0]!;
  const toLocal = (p: PathPoint) => toLocalMeters(anchor, p);
  const fullLocal = fullPath.map(toLocal);
  const destLocal = toLocal(destination);
  const { size, project, toLine } = projectBBox(
    anchor,
    [...fullLocal, destLocal],
    0.1,
    40,
  );

  const start = project(fullLocal[0]!);
  const end = project(destLocal);
  const stroke = large ? 3.2 : 2.4;
  const dotR = large ? 5.5 : 3.8;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={`rounded-xl border border-white/15 bg-slate-900/80 ${large ? "border-white/25 shadow-2xl" : ""} ${className}`}
      aria-label="Ruta total, norte arriba"
      role="img"
    >
      <polyline
        points={toLine(fullLocal)}
        fill="none"
        stroke="#38bdf8"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx={start.x} cy={start.y} r={dotR} fill="#22c55e" />
      <circle
        cx={end.x}
        cy={end.y}
        r={dotR}
        fill="#ef4444"
        stroke="#fecaca"
        strokeWidth={1}
      />
    </svg>
  );
}

/** North-up view of the segment visible in the navigation map, with context around. */
export function NavigationVisibleNorthPreview({
  visiblePath,
  remainingPath,
  destination,
  position,
  className = "",
  large = false,
}: BaseProps & {
  visiblePath: PathPoint[];
  remainingPath: PathPoint[];
  position: PathPoint | null;
}) {
  const frame =
    visiblePath.length >= 2
      ? visiblePath
      : remainingPath.length >= 2
        ? remainingPath
        : [];

  if (frame.length < 2) {
    return emptyPlaceholder(className, "Visible");
  }

  const anchor = frame[0]!;
  const toLocal = (p: PathPoint) => toLocalMeters(anchor, p);
  const visibleLocal = visiblePath.map(toLocal);
  const remainingLocal = remainingPath.map(toLocal);
  const positionLocal = position ? toLocal(position) : null;

  const bboxPoints = [
    ...visibleLocal,
    ...(positionLocal ? [positionLocal] : []),
  ];
  const { size, project, toLine } = projectBBox(anchor, bboxPoints, 0.5, 100);

  const strokeRemaining = large ? 1.8 : 1.2;
  const strokeVisible = large ? 4 : 2.8;
  const dotR = large ? 5 : 3.8;
  const northSize = large ? "text-[11px]" : "text-[8px]";

  const you = positionLocal ? project(positionLocal) : null;

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      className={`rounded-xl border border-white/15 bg-slate-900/80 ${large ? "border-white/25 shadow-2xl" : ""} ${className}`}
      aria-label="Tramo visible en navegación, norte arriba"
      role="img"
    >
      <text
        x={size / 2}
        y={large ? 12 : 10}
        textAnchor="middle"
        className={`fill-white/70 font-bold ${northSize}`}
      >
        N
      </text>

      {remainingLocal.length >= 2 && (
        <polyline
          points={toLine(remainingLocal)}
          fill="none"
          stroke="#ffffff"
          strokeOpacity={0.2}
          strokeWidth={strokeRemaining}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {visibleLocal.length >= 2 && (
        <polyline
          points={toLine(visibleLocal)}
          fill="none"
          stroke="#38bdf8"
          strokeWidth={strokeVisible}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      {you && <circle cx={you.x} cy={you.y} r={dotR} fill="#22c55e" />}
    </svg>
  );
}

/**
 * Route guide like the top “Visible” panel, but heading-up:
 * your travel direction is always toward the top of the screen (no map tiles).
 */
export function NavigationHeadingGuidePreview({
  visiblePath,
  remainingPath,
  exitPaths = [],
  position,
  heading,
  className = "",
}: {
  visiblePath: PathPoint[];
  remainingPath: PathPoint[];
  exitPaths?: PathPoint[][];
  position: PathPoint | null;
  heading: number | null;
  className?: string;
}) {
  const frame =
    visiblePath.length >= 2
      ? visiblePath
      : remainingPath.length >= 2
        ? remainingPath
        : [];

  if (frame.length < 2 || !position) {
    return emptyPlaceholder(className, "Guía");
  }

  const headingRad = ((heading ?? 0) * Math.PI) / 180;
  const cos = Math.cos(headingRad);
  const sin = Math.sin(headingRad);

  const toHeadingLocal = (p: PathPoint) => {
    const { x: east, y: north } = toLocalMeters(position, p);
    return {
      x: east * cos - north * sin,
      y: east * sin + north * cos,
    };
  };

  const guidePath =
    visiblePath.length >= 2
      ? visiblePath
      : remainingPath.length >= 2
        ? remainingPath
        : [];
  const guideLocal = guidePath.map(toHeadingLocal);
  const exitLocals = exitPaths.map((exit) => exit.map(toHeadingLocal));
  const youLocal = { x: 0, y: 0 };

  const bboxPoints = [
    ...guideLocal,
    youLocal,
    ...exitLocals.flat(),
  ];
  const { size, project, toLine } = projectBBox(position, bboxPoints, 0.35, 80);
  const you = project(youLocal);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      preserveAspectRatio="xMidYMid meet"
      className={`h-full w-full bg-slate-950 ${className}`}
      aria-label="Guía de ruta orientada a tu dirección"
      role="img"
    >
      <rect width={size} height={size} fill="#0b1220" />

      {exitLocals.map((exit, i) =>
        exit.length >= 2 ? (
          <polyline
            key={`exit-${i}`}
            points={toLine(exit)}
            fill="none"
            stroke="#cbd5e1"
            strokeOpacity={0.55}
            strokeWidth={2}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null,
      )}

      {guideLocal.length >= 2 && (
        <polyline
          points={toLine(guideLocal)}
          fill="none"
          stroke="#38bdf8"
          strokeWidth={5.5}
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      )}

      <path
        d={`M ${you.x} ${you.y - 6} L ${you.x + 5} ${you.y + 5} L ${you.x} ${you.y + 2.5} L ${you.x - 5} ${you.y + 5} Z`}
        fill="#22c55e"
        stroke="#bbf7d0"
        strokeWidth={0.8}
      />
    </svg>
  );
}

/** Combined preview for expanded modal. */
export function NavigationRoutePreview({
  fullPath,
  remainingPath,
  visiblePath,
  destination,
  position,
  className = "",
  large = false,
}: BaseProps & {
  fullPath: PathPoint[];
  remainingPath: PathPoint[];
  visiblePath: PathPoint[];
  position?: PathPoint | null;
}) {
  return (
    <div className={`grid grid-cols-2 gap-3 ${className}`}>
      <div>
        <p className="mb-1 text-center text-xs text-white/50">Ruta total</p>
        <NavigationFullRoutePreview
          fullPath={fullPath}
          destination={destination}
          large={large}
          className="aspect-square w-full"
        />
      </div>
      <div>
        <p className="mb-1 text-center text-xs text-white/50">Vista norte</p>
        <NavigationVisibleNorthPreview
          visiblePath={visiblePath}
          remainingPath={remainingPath}
          destination={destination}
          position={position ?? null}
          large={large}
          className="aspect-square w-full"
        />
      </div>
    </div>
  );
}
