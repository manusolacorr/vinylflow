import type { CamEntry, BpmBridge, Compat } from "./types";

// ── Full Camelot Wheel (all 24 keys) ─────────────────────────────────────
export const CAM: Record<string, CamEntry> = {
  "1A":  { n: "Abm", c: ["1B", "12A", "2A"] },
  "1B":  { n: "B",   c: ["1A", "12B", "2B"] },
  "2A":  { n: "Ebm", c: ["2B", "1A", "3A"] },
  "2B":  { n: "F#",  c: ["2A", "1B", "3B"] },
  "3A":  { n: "Bbm", c: ["3B", "2A", "4A"] },
  "3B":  { n: "Db",  c: ["3A", "2B", "4B"] },
  "4A":  { n: "Fm",  c: ["4B", "3A", "5A"] },
  "4B":  { n: "Ab",  c: ["4A", "3B", "5B"] },
  "5A":  { n: "Cm",  c: ["5B", "4A", "6A"] },
  "5B":  { n: "Eb",  c: ["5A", "4B", "6B"] },
  "6A":  { n: "Gm",  c: ["6B", "5A", "7A"] },
  "6B":  { n: "Bb",  c: ["6A", "5B", "7B"] },
  "7A":  { n: "Dm",  c: ["7B", "6A", "8A"] },
  "7B":  { n: "F",   c: ["7A", "6B", "8B"] },
  "8A":  { n: "Am",  c: ["8B", "7A", "9A"] },
  "8B":  { n: "C",   c: ["8A", "7B", "9B"] },
  "9A":  { n: "Em",  c: ["9B", "8A", "10A"] },
  "9B":  { n: "G",   c: ["9A", "8B", "10B"] },
  "10A": { n: "Bm",  c: ["10B", "9A", "11A"] },
  "10B": { n: "D",   c: ["10A", "9B", "11B"] },
  "11A": { n: "F#m", c: ["11B", "10A", "12A"] },
  "11B": { n: "A",   c: ["11A", "10B", "12B"] },
  "12A": { n: "C#m", c: ["12B", "11A", "1A"] },
  "12B": { n: "E",   c: ["12A", "11B", "1B"] },
};

export const CAM_KEYS = Object.keys(CAM);

/**
 * Returns compatibility rating between two Camelot keys.
 * null if either key is missing.
 */
export function camCompat(keyA: string | null, keyB: string | null): Compat {
  if (!keyA || !keyB || !CAM[keyA] || !CAM[keyB]) return null;
  if (keyA === keyB) return "perfect";
  if (CAM[keyA].c.includes(keyB)) return "compatible";

  // "Close" — same letter (both major or both minor), within 2 steps
  const aNum = parseInt(keyA), bNum = parseInt(keyB);
  const aLet = keyA.slice(-1), bLet = keyB.slice(-1);
  if (aLet === bLet) {
    const diff = Math.abs(aNum - bNum);
    const wrap = Math.min(diff, 12 - diff);
    if (wrap <= 2) return "close";
  }

  return "clash";
}

/** Colour for a compatibility rating — used in UI. */
export function compatColor(c: Compat): string {
  switch (c) {
    case "perfect":    return "#9a6c2e";
    case "compatible": return "#27ae60";
    case "close":      return "#c96a1a";
    case "clash":      return "#c0392b";
    default:           return "#888";
  }
}

/**
 * Describes the BPM relationship between two tracks.
 * Returns { l: label, ok: boolean }
 */
export function bpmBridge(bpmA: number | null, bpmB: number | null): BpmBridge | null {
  if (!bpmA || !bpmB) return null;
  const diff = Math.abs(bpmA - bpmB);
  const ratio = bpmA > bpmB ? bpmA / bpmB : bpmB / bpmA;

  if (diff === 0)              return { l: "same BPM", ok: true };
  if (diff <= 8)               return { l: `±${diff} BPM`, ok: true };
  if (ratio >= 1.9 && ratio <= 2.1) return { l: "x2 bridge", ok: true };
  return { l: `±${diff} BPM`, ok: false };
}

/** Normalise various key string formats to Camelot e.g. "8A", "11B" */
export function normalizeCamelot(str: string): string | null {
  if (!str) return null;
  const clean = str.trim().toUpperCase().replace(/\s/g, "");
  if (CAM[clean]) return clean;
  // Try swapping letter to end: "A8" → "8A"
  const swapped = clean.slice(1) + clean[0];
  if (CAM[swapped]) return swapped;
  return null;
}
