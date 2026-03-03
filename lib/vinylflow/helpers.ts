import type { PitchDrift, Track } from "./types";

// ── Pitch Drift ───────────────────────────────────────────────────────────

/**
 * Calculates pitch drift percentage between two BPMs.
 * >6% is flagged as a warning (audible distortion on most turntables).
 */
export function pitchDrift(bpmA: number | null, bpmB: number | null): PitchDrift | null {
  if (!bpmA || !bpmB) return null;
  const pct = ((bpmB - bpmA) / bpmA) * 100;
  return {
    pct:  Math.abs(pct).toFixed(1),
    sign: pct >= 0 ? "+" : "-",
    high: Math.abs(pct) > 6,
  };
}

// ── Vinyl Side Logic ──────────────────────────────────────────────────────

/** Extracts the side letter from a sleeve position: "A1" → "A", "B2" → "B" */
export function vinylSide(pos: string): string | null {
  const m = String(pos).trim().toUpperCase().match(/^([A-Z]+)/);
  return m ? m[1] : null;
}

/** True if both tracks are on the same side of the same record. */
export function sameSide(a: Track, b: Track): boolean {
  if (a.releaseId !== b.releaseId) return false;
  const sa = vinylSide(a.pos), sb = vinylSide(b.pos);
  return !!(sa && sb && sa === sb);
}

/** True if both tracks are from the same release. */
export function sameRecord(a: Track, b: Track): boolean {
  return !!(a && b && a.releaseId === b.releaseId);
}

// ── Decade Helper ─────────────────────────────────────────────────────────

/** Converts a year to a decade string: 1994 → "1990s" */
export function decadeOf(year: number): string {
  if (!year || year < 1900) return "Unknown";
  return `${Math.floor(year / 10) * 10}s`;
}

// ── BPM / Key Guessing (fallback before enrichment) ───────────────────────

const BPM_MAP: [RegExp, number][] = [
  [/ambient|drone|experimental|new age/, 90],
  [/deep house|balearic/, 122],
  [/house/, 126],
  [/techno/, 132],
  [/hard techno|industrial techno/, 140],
  [/trance|psytrance/, 138],
  [/drum.?n.?bass|dnb|jungle/, 174],
  [/disco|funk/, 118],
  [/hip.?hop|rap/, 90],
  [/jazz/, 110],
];

export function guessBPM(genres: string[], styles: string[]): number {
  const all = [...genres, ...styles].join(" ").toLowerCase();
  for (const [re, bpm] of BPM_MAP) {
    if (re.test(all)) return bpm;
  }
  return 125; // generic dance music default
}

// ── Visual Cue for White Labels ───────────────────────────────────────────

const VCUES = ["◆","▲","●","★","▼","■","◉","✦","⬟","⬡","⬢","◈","◇","△","▽","☽","⊕","⊗","⬤","◎"];

export function visualCue(id: number): string {
  return VCUES[Math.abs((id || 0) * 7 + (id || 0)) % VCUES.length];
}

// ── Sleep helper ──────────────────────────────────────────────────────────
export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));
