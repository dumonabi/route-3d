"use client";

import { useEffect, useRef, useState } from "react";
import { NavigationHeadingGuidePreview } from "@/components/NavigationRoutePreview";
import { NavAudio } from "@/lib/nav-audio";
import type {
  NavigationGuidance,
  NavigationLiveState,
} from "@/lib/route-types";

export type NavigationDisplayMode = "aerial" | "overview" | "guide";

function AerialIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="currentColor"
        d="M12 2 L4 9 H7 V14 H11 V10 H13 V14 H17 V9 H20 Z M4 16 V18 H20 V16 Z"
      />
    </svg>
  );
}

function OverviewIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <rect
        x="3.5"
        y="3.5"
        width="17"
        height="17"
        rx="2.5"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
      />
      <path
        d="M7 17 L11 9 L14 13 L18 7"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="7" cy="17" r="1.7" fill="#22c55e" />
      <circle cx="18" cy="7" r="1.7" fill="#ef4444" />
    </svg>
  );
}

function GuideIcon({ className = "h-6 w-6" }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden>
      <path
        fill="none"
        stroke="currentColor"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        d="M6 18 C6 12 10 10 12 6 C14 10 18 12 18 18"
      />
      <circle cx="12" cy="19" r="1.6" fill="currentColor" />
    </svg>
  );
}

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

export function NavigationTopPanel({
  destinationLabel,
  onBack,
}: {
  destinationLabel: string;
  onBack: () => void;
}) {
  return (
    <header className="flex h-full min-h-0 flex-col justify-end border-b border-white/10 bg-slate-950 px-3 pb-2 pt-[max(0.5rem,env(safe-area-inset-top))]">
      <div className="flex shrink-0 items-center gap-2">
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
  );
}

export function NavigationMiddleOverlay({
  live,
  mode,
  onModeChange,
}: {
  live: NavigationLiveState;
  mode: NavigationDisplayMode;
  onModeChange: (mode: NavigationDisplayMode) => void;
}) {
  return (
    <div className="pointer-events-none absolute inset-0 z-20">
      {mode === "guide" && (
        <div className="absolute inset-0 bg-slate-950">
          <NavigationHeadingGuidePreview
            visiblePath={live.visiblePath}
            remainingPath={live.remainingPath}
            exitPaths={live.exitPaths}
            position={live.position}
            heading={live.heading}
            className="h-full w-full"
          />
        </div>
      )}

      <div className="pointer-events-auto absolute right-2 top-1/2 flex -translate-y-1/2 flex-col gap-2">
        <button
          type="button"
          onClick={() => onModeChange("aerial")}
          aria-label="Vista aérea"
          aria-pressed={mode === "aerial"}
          className={`flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-2xl border text-[10px] font-semibold shadow-lg backdrop-blur-md active:scale-[0.97] ${
            mode === "aerial"
              ? "border-sky-400/60 bg-sky-600 text-white"
              : "border-white/25 bg-black/70 text-white/75"
          }`}
        >
          <AerialIcon className="h-5 w-5" />
          <span>Aérea</span>
        </button>
        <button
          type="button"
          onClick={() => onModeChange("overview")}
          aria-label="Vista ruta completa al norte"
          aria-pressed={mode === "overview"}
          className={`flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-2xl border text-[10px] font-semibold shadow-lg backdrop-blur-md active:scale-[0.97] ${
            mode === "overview"
              ? "border-sky-400/60 bg-sky-600 text-white"
              : "border-white/25 bg-black/70 text-white/75"
          }`}
        >
          <OverviewIcon className="h-5 w-5" />
          <span>Ruta</span>
        </button>
        <button
          type="button"
          onClick={() => onModeChange("guide")}
          aria-label="Vista guía"
          aria-pressed={mode === "guide"}
          className={`flex h-14 w-14 flex-col items-center justify-center gap-0.5 rounded-2xl border text-[10px] font-semibold shadow-lg backdrop-blur-md active:scale-[0.97] ${
            mode === "guide"
              ? "border-sky-400/60 bg-sky-600 text-white"
              : "border-white/25 bg-black/70 text-white/75"
          }`}
        >
          <GuideIcon className="h-5 w-5" />
          <span>Guía</span>
        </button>
      </div>
    </div>
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
