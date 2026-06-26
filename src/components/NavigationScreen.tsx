"use client";

import { useEffect, useRef, useState } from "react";
import {
  NavigationFullRoutePreview,
  NavigationRoutePreview,
  NavigationVisibleNorthPreview,
} from "@/components/NavigationRoutePreview";
import { NavAudio } from "@/lib/nav-audio";
import type {
  NavigationGuidance,
  NavigationLiveState,
} from "@/lib/route-types";

function SpeakerIcon({ muted, className = "h-8 w-8" }: { muted: boolean; className?: string }) {
  if (muted) {
    return (
      <svg viewBox="0 0 24 24" className={className} aria-hidden>
        <path
          fill="currentColor"
          d="M3 10v4h4l5 5V5L7 10H3zm13.5 2c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
          opacity="0.35"
        />
        <path
          d="M3 3 L21 21"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinecap="round"
        />
      </svg>
    );
  }

  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M3 10v4h4l5 5V5L7 10H3zm13.5 2c0-1.77-1.02-3.29-2.5-4.03v8.06c1.48-.74 2.5-2.26 2.5-4.03zM14 3.23v2.06c2.89.86 5 3.54 5 6.71s-2.11 5.85-5 6.71v2.06c4.01-.91 7-4.49 7-8.77s-2.99-7.86-7-8.77z"
      />
    </svg>
  );
}

function NavigationCompass({ heading }: { heading: number | null }) {
  const ringRotation = heading == null ? 0 : -heading;

  return (
    <div
      className="relative flex h-full max-h-36 w-full max-w-36 items-center justify-center rounded-full border-2 border-white/20 bg-black/55 shadow-lg backdrop-blur-md"
      aria-label={
        heading == null
          ? "Brújula, orientación desconocida"
          : `Orientación ${Math.round(heading)} grados`
      }
    >
      {/* Exterior: gira para alinear N/E/S/O con el mundo real */}
      <div
        className="absolute inset-0"
        style={{ transform: `rotate(${ringRotation}deg)` }}
        aria-hidden
      >
        <span className="absolute left-1/2 top-1.5 -translate-x-1/2 text-lg font-bold text-red-400">
          N
        </span>
        <span className="absolute bottom-1.5 left-1/2 -translate-x-1/2 text-sm font-semibold text-white">
          S
        </span>
        <span className="absolute left-2 top-1/2 -translate-y-1/2 text-sm font-semibold text-white">
          O
        </span>
        <span className="absolute right-2 top-1/2 -translate-y-1/2 text-sm font-semibold text-white">
          E
        </span>
      </div>

      {/* Flecha fija hacia arriba = dirección de avance */}
      <svg
        viewBox="0 0 48 56"
        className="relative z-10 h-[78%] w-[78%]"
        aria-hidden
      >
        <path
          d="M24 4 L34 46 L24 38 L14 46 Z"
          fill="#38bdf8"
          stroke="#7dd3fc"
          strokeWidth="1.4"
          strokeLinejoin="round"
        />
        <circle cx="24" cy="30" r="3.5" fill="#e2e8f0" />
      </svg>
    </div>
  );
}

function RoutePreviewExpanded({
  live,
  onClose,
}: {
  live: NavigationLiveState;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 px-6 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Vista ampliada de la ruta"
      onClick={onClose}
    >
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClose();
        }}
        className="absolute right-4 top-[max(0.5rem,env(safe-area-inset-top))] flex h-12 w-12 items-center justify-center rounded-full border border-white/25 bg-black/60 text-2xl text-white active:bg-black/80"
        aria-label="Cerrar vista ampliada"
      >
        ×
      </button>
      <div className="w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <NavigationRoutePreview
          fullPath={live.fullPath}
          remainingPath={live.remainingPath}
          visiblePath={live.visiblePath}
          destination={live.destination}
          position={live.position}
          large
          className="w-full max-w-lg"
        />
        <p className="mt-4 text-center text-sm text-white/50">
          Izquierda: ruta total · Derecha: lo visible en navegación (norte arriba)
        </p>
      </div>
    </div>
  );
}

export function NavigationTopPanel({
  live,
  destinationLabel,
  onBack,
}: {
  live: NavigationLiveState;
  destinationLabel: string;
  onBack: () => void;
}) {
  const [routePreviewOpen, setRoutePreviewOpen] = useState(false);

  return (
    <>
      <header className="flex h-full min-h-0 flex-col border-b border-white/10 bg-slate-950 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
        <div className="flex min-h-0 flex-1 items-stretch gap-2">
          <button
            type="button"
            onClick={() => setRoutePreviewOpen(true)}
            aria-label="Ampliar vistas de la ruta"
            className="flex min-h-0 flex-[1.1] flex-col gap-1 active:scale-[0.98]"
          >
            <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-white/40">
              Total
            </span>
            <NavigationFullRoutePreview
              fullPath={live.fullPath}
              destination={live.destination}
              className="min-h-0 flex-1"
            />
          </button>
          <button
            type="button"
            onClick={() => setRoutePreviewOpen(true)}
            aria-label="Ampliar vista norte del tramo visible"
            className="flex min-h-0 flex-[1.1] flex-col gap-1 active:scale-[0.98]"
          >
            <span className="shrink-0 text-[9px] font-medium uppercase tracking-wide text-white/40">
              Visible (N)
            </span>
            <NavigationVisibleNorthPreview
              visiblePath={live.visiblePath}
              remainingPath={live.remainingPath}
              destination={live.destination}
              position={live.position}
              className="min-h-0 flex-1"
            />
          </button>
          <div className="flex min-h-0 flex-1 items-center justify-center">
            <NavigationCompass heading={live.heading} />
          </div>
        </div>

        <div className="mt-2 flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            aria-label="Volver al mapa"
            className="flex h-10 items-center justify-center rounded-full border border-white/20 bg-white/10 px-3 text-sm font-semibold text-white active:bg-white/20"
          >
            ← Mapa
          </button>
          <p className="min-w-0 flex-1 truncate text-xs text-white/50">
            {destinationLabel}
          </p>
        </div>
      </header>

      {routePreviewOpen && (
        <RoutePreviewExpanded
          live={live}
          onClose={() => setRoutePreviewOpen(false)}
        />
      )}
    </>
  );
}

export function NavigationBottomPanel({
  guidance,
}: {
  guidance: NavigationGuidance | null;
}) {
  const audioRef = useRef(new NavAudio());
  const [audioOn, setAudioOn] = useState(false);

  useEffect(() => {
    const audio = audioRef.current;
    return () => audio.dispose();
  }, []);

  useEffect(() => {
    if (!audioOn) return;
    audioRef.current.speak(guidance);
  }, [guidance, audioOn]);

  const toggleAudio = () => {
    const next = audioRef.current.toggle();
    setAudioOn(next);
    if (next && guidance && !guidance.rerouting) {
      audioRef.current.speak(guidance);
    }
  };

  return (
    <footer className="flex h-full min-h-0 flex-col border-t border-white/10 bg-slate-950 px-4 pb-[max(0.5rem,env(safe-area-inset-bottom))] pt-3">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {!guidance ? (
          <p className="text-center text-lg text-white/50">
            Obteniendo indicaciones…
          </p>
        ) : guidance.rerouting ? (
          <p className="text-center text-2xl font-semibold text-sky-300">
            Recalculando ruta…
          </p>
        ) : (
          <div className="text-center">
            {guidance.distanceText && (
              <p className="text-5xl font-bold leading-none tracking-tight text-sky-400 sm:text-6xl">
                {guidance.distanceText}
              </p>
            )}
            <p className="mt-3 text-2xl font-semibold leading-snug text-white sm:text-3xl">
              {guidance.instruction}
            </p>
            {guidance.nextInstruction && (
              <p className="mt-4 text-xl leading-relaxed text-white/60 sm:text-2xl">
                Después: {guidance.nextInstruction}
              </p>
            )}
            {guidance.remainingText && (
              <p className="mt-4 text-lg text-white/50 sm:text-xl">
                {guidance.remainingText} al destino
              </p>
            )}
          </div>
        )}
      </div>

      <div className="flex shrink-0 justify-center pt-3">
        <button
          type="button"
          onClick={toggleAudio}
          aria-label={audioOn ? "Desactivar audio" : "Activar audio"}
          aria-pressed={audioOn}
          className={`flex h-16 w-16 items-center justify-center rounded-full border-2 shadow-lg transition active:scale-[0.97] sm:h-[4.5rem] sm:w-[4.5rem] ${
            audioOn
              ? "border-sky-400/60 bg-sky-600 text-white"
              : "border-white/25 bg-white/10 text-white/70"
          }`}
        >
          <SpeakerIcon muted={!audioOn} />
        </button>
      </div>
    </footer>
  );
}
