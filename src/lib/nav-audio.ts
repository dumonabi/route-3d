import type { NavigationGuidance } from "@/lib/route-types";

const VOICE_SCORE: Array<{ pattern: RegExp; score: number }> = [
  { pattern: /premium|enhanced|neural|natural|wavenet/i, score: 100 },
  { pattern: /google.*español|español.*google/i, score: 90 },
  { pattern: /microsoft.*(helena|laura|pablo|elvira|alvaro)/i, score: 85 },
  { pattern: /monica|mónica|jorge|paulina|diego|lucia|lucía|marta|carlos/i, score: 80 },
  { pattern: /google/i, score: 70 },
  { pattern: /microsoft/i, score: 65 },
  { pattern: /samantha|karen|daniel|moira/i, score: 40 },
  { pattern: /espeak|festival|compact/i, score: -50 },
];

function scoreVoice(voice: SpeechSynthesisVoice): number {
  let score = 0;
  const lang = voice.lang.toLowerCase();
  const name = voice.name;

  if (lang.startsWith("es-es")) score += 30;
  else if (lang.startsWith("es-mx") || lang.startsWith("es-us")) score += 25;
  else if (lang.startsWith("es")) score += 15;

  if (voice.localService) score += 8;

  for (const rule of VOICE_SCORE) {
    if (rule.pattern.test(name)) score += rule.score;
  }

  return score;
}

function pickSpanishVoice(
  voices: SpeechSynthesisVoice[],
): SpeechSynthesisVoice | null {
  const spanish = voices.filter((v) => v.lang.toLowerCase().startsWith("es"));
  if (spanish.length === 0) return null;

  return spanish.reduce((best, voice) =>
    scoreVoice(voice) > scoreVoice(best) ? voice : best,
  );
}

/** Turn route text into phrasing that reads more naturally aloud. */
function toSpokenText(guidance: NavigationGuidance): string {
  const distance = guidance.distanceText
    ? normalizeDistanceForSpeech(guidance.distanceText)
    : null;
  const instruction = softenInstruction(guidance.instruction);

  if (distance && instruction) {
    return `En ${distance}, ${instruction}`;
  }
  return instruction || distance || "";
}

function normalizeDistanceForSpeech(text: string): string {
  return text
    .replace(/(\d+(?:[.,]\d+)?)\s*km\b/gi, "$1 kilómetros")
    .replace(/(\d+)\s*m\b/gi, "$1 metros");
}

function softenInstruction(text: string): string {
  return text
    .replace(/\bDirígete\b/gi, "Gira")
    .replace(/\bContinúa\b/gi, "Sigue")
    .replace(/\bhacia el\b/gi, "hacia")
    .replace(/\s+/g, " ")
    .trim();
}

export class NavAudio {
  private enabled = false;
  private lastKey = "";
  private voice: SpeechSynthesisVoice | null = null;
  private voicesReady = false;

  constructor() {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    this.refreshVoice();
    window.speechSynthesis.addEventListener("voiceschanged", this.refreshVoice);
  }

  private refreshVoice = (): void => {
    if (typeof window === "undefined" || !window.speechSynthesis) return;
    const voices = window.speechSynthesis.getVoices();
    if (voices.length === 0) return;
    this.voice = pickSpanishVoice(voices);
    this.voicesReady = true;
  };

  isEnabled(): boolean {
    return this.enabled;
  }

  setEnabled(value: boolean): void {
    this.enabled = value;
    if (!value && typeof window !== "undefined") {
      window.speechSynthesis?.cancel();
      this.lastKey = "";
    }
  }

  toggle(): boolean {
    this.setEnabled(!this.enabled);
    return this.enabled;
  }

  speak(guidance: NavigationGuidance | null): void {
    if (!this.enabled || !guidance || guidance.rerouting) return;
    if (typeof window === "undefined" || !window.speechSynthesis) return;

    const text = toSpokenText(guidance);
    if (!text) return;

    const key = text;
    if (key === this.lastKey) return;
    this.lastKey = key;

    if (!this.voicesReady) this.refreshVoice();

    const synth = window.speechSynthesis;
    synth.cancel();

    const utterance = new SpeechSynthesisUtterance(text);
    utterance.lang = this.voice?.lang ?? "es-ES";
    utterance.rate = 0.9;
    utterance.pitch = 1;
    utterance.volume = 1;

    if (this.voice) utterance.voice = this.voice;

    synth.speak(utterance);
  }

  dispose(): void {
    if (typeof window !== "undefined") {
      window.speechSynthesis?.removeEventListener(
        "voiceschanged",
        this.refreshVoice,
      );
    }
    this.setEnabled(false);
  }
}
