// ── Core data types for vinyl.flow ───────────────────────────────────────

export interface Release {
  id: number;
  title: string;
  artist: string;
  genres: string[];
  styles: string[];
  year: number;
  label: string;
  catno: string;
  thumb: string | null;
  tracks: Track[];
  incomplete?: boolean;
}

export interface Track {
  id: string;           // "{releaseId}_{pos}" e.g. "1234_A1"
  title: string;
  pos: string;          // sleeve position e.g. "A1", "B2"
  trackArtist: string;
  duration: string;
  bpm: number | null;
  bpmSource: "guessed" | "enriched" | "manual" | null;
  key: string | null;   // Camelot key e.g. "8A", "11B"
  keySource: "guessed" | "enriched" | "manual" | null;
  roleOverride: string | null;
  // Denormalized release fields
  releaseId: number;
  releaseTitle: string;
  releaseArtist: string;
  thumb: string | null;
  year: number;
  genres: string[];
  styles: string[];
  incomplete?: boolean;
}

export interface Role {
  id: string;
  label: string;
  color: string;
  emoji: string;
}

export interface CamEntry {
  n: string;      // note name e.g. "Am", "C"
  c: string[];    // compatible keys
}

export interface BpmBridge {
  l: string;      // label e.g. "±3 BPM"
  ok: boolean;
}

export type Compat = "perfect" | "compatible" | "close" | "clash" | null;

export interface PitchDrift {
  pct: string;    // e.g. "7.3"
  sign: "+" | "-";
  high: boolean;  // true if >6%
}

export interface TransitionContext {
  recentReleases?: number[];
  usedReleases?: number[];
}
