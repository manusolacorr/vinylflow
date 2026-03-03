import type { Track, TransitionContext } from "./types";
import { camCompat, bpmBridge } from "./camelot";
import { sameSide, sameRecord } from "./helpers";

// ── Blocked transitions ───────────────────────────────────────────────────

/** True if this transition is physically impossible (same vinyl side). */
export function isVinylBlocked(a: Track, b: Track): boolean {
  return sameSide(a, b);
}

/** True if this transition is harmonically terrible AND same record. */
export function isHardClash(a: Track, b: Track): boolean {
  return sameRecord(a, b) && camCompat(a.key, b.key) === "clash";
}

export function isBlocked(a: Track, b: Track): boolean {
  return isVinylBlocked(a, b) || isHardClash(a, b);
}

// ── Core scoring function ─────────────────────────────────────────────────

/**
 * Scores how good it is to play track B after track A.
 * Higher = better. Negative scores mean bad transition.
 *
 * Scoring breakdown:
 *   Harmonic:    perfect +200, compatible +130, close +50, clash -300
 *   BPM ok:      +up to 70 (decreases with diff)
 *   BPM bad:     -120
 *   Same record: -150
 *   Shared genre/style: +12/+10 each
 *   Repeat in recent window: -150 per time
 *   Played 2+ times: -300
 *   BPM gently rising: +25 (0-8 BPM), +8 (8-15 BPM)
 *   BPM dropping >10: -15
 */
export function transitionScore(
  a: Track,
  b: Track,
  context: TransitionContext = {},
): number {
  if (!a || !b) return -9999;

  const compat = camCompat(a.key, b.key);
  const bridge = bpmBridge(a.bpm, b.bpm);
  let score = 0;

  // Harmonic compatibility
  if (compat === "perfect")         score += 200;
  else if (compat === "compatible") score += 130;
  else if (compat === "close")      score += 50;
  else if (compat === "clash")      score -= 300;

  // BPM compatibility
  if (bridge?.ok) {
    const d = Math.abs((a.bpm || 0) - (b.bpm || 0));
    score += Math.max(0, 70 - d * 5);
  } else {
    score -= 120;
  }

  // Same record penalty
  if (sameRecord(a, b)) score -= 150;

  // Shared genre/style bonus
  const cg = (a.genres || []).filter(g => (b.genres || []).includes(g)).length;
  const cs = (a.styles || []).filter(s => (b.styles || []).includes(s)).length;
  score += cg * 12 + cs * 10;

  // Recent release repeat penalty (promotes variety in last 4 tracks)
  if (context.recentReleases) {
    const timesPlayed = context.recentReleases.filter(id => id === b.releaseId).length;
    score -= timesPlayed * 150;
  }

  // Full set repeat penalty (hard limit at 2 plays)
  if (context.usedReleases) {
    const totalTimes = context.usedReleases.filter(id => id === b.releaseId).length;
    if (totalTimes >= 2) score -= 300;
  }

  // BPM direction bonus/penalty
  if (a.bpm && b.bpm) {
    const delta = b.bpm - a.bpm;
    if (delta >= 0 && delta <= 8)       score += 25;
    else if (delta > 8 && delta <= 15)  score += 8;
    else if (delta < -10)               score -= 15;
  }

  return score;
}

// ── Engine 1: Build a set from scratch ───────────────────────────────────

/**
 * Greedy harmonic set builder.
 * Picks a random starting track, then greedily picks the best
 * next track at each step using transitionScore().
 */
export function engine1BuildSet(pool: Track[], targetSize = 20): Track[] {
  if (pool.length === 0) return [];

  const available = [...pool];
  const set: Track[] = [];
  const usedReleases: number[] = [];

  // Random start
  const startIdx = Math.floor(Math.random() * available.length);
  set.push(available.splice(startIdx, 1)[0]);
  usedReleases.push(set[0].releaseId);

  while (set.length < targetSize && available.length > 0) {
    const last = set[set.length - 1];
    const recentReleases = usedReleases.slice(-4);
    const context: TransitionContext = { recentReleases, usedReleases: [...usedReleases] };

    // Score all remaining tracks
    let bestScore = -Infinity;
    let bestIdx   = -1;

    for (let i = 0; i < available.length; i++) {
      const candidate = available[i];
      if (isBlocked(last, candidate)) continue;
      const score = transitionScore(last, candidate, context);
      if (score > bestScore) {
        bestScore = score;
        bestIdx   = i;
      }
    }

    // If all options are blocked, pick least-bad unblocked
    if (bestIdx === -1) {
      for (let i = 0; i < available.length; i++) {
        if (!isVinylBlocked(last, available[i])) {
          bestIdx = i;
          break;
        }
      }
    }

    if (bestIdx === -1) break; // all remaining are vinyl-blocked — stop

    const picked = available.splice(bestIdx, 1)[0];
    set.push(picked);
    usedReleases.push(picked.releaseId);
  }

  return set;
}

// ── Engine 2: Re-sort an existing set ────────────────────────────────────

/**
 * Nearest-neighbour re-sort of an existing set.
 * Keeps the first track, then greedily picks the best order
 * for the remaining tracks.
 */
export function engine2SortSet(tracks: Track[]): Track[] {
  if (tracks.length <= 1) return [...tracks];

  const remaining = tracks.slice(1);
  const sorted    = [tracks[0]];
  const usedReleases = [tracks[0].releaseId];

  while (remaining.length > 0) {
    const last = sorted[sorted.length - 1];
    const recentReleases = usedReleases.slice(-4);
    const context: TransitionContext = { recentReleases, usedReleases: [...usedReleases] };

    let bestScore = -Infinity;
    let bestIdx   = 0;

    for (let i = 0; i < remaining.length; i++) {
      if (isBlocked(last, remaining[i])) continue;
      const score = transitionScore(last, remaining[i], context);
      if (score > bestScore) {
        bestScore = score;
        bestIdx   = i;
      }
    }

    const picked = remaining.splice(bestIdx, 1)[0];
    sorted.push(picked);
    usedReleases.push(picked.releaseId);
  }

  return sorted;
}

// ── Set analysis: suggestions ─────────────────────────────────────────────

export interface Suggestion {
  type: "warning" | "info";
  message: string;
}

export function setSuggestions(set: Track[]): Suggestion[] {
  const suggestions: Suggestion[] = [];
  if (set.length < 2) return suggestions;

  let clashes = 0, blocked = 0, highDrift = 0;

  for (let i = 0; i < set.length - 1; i++) {
    const a = set[i], b = set[i + 1];
    if (isVinylBlocked(a, b))         blocked++;
    if (camCompat(a.key, b.key) === "clash") clashes++;

    const drift = b.bpm && a.bpm
      ? Math.abs((b.bpm - a.bpm) / a.bpm * 100)
      : 0;
    if (drift > 6) highDrift++;
  }

  if (blocked > 0)
    suggestions.push({ type: "warning",
      message: `${blocked} same-side transition${blocked > 1 ? "s" : ""} — physically impossible on vinyl` });

  if (clashes > 0)
    suggestions.push({ type: "warning",
      message: `${clashes} key clash${clashes > 1 ? "es" : ""} — consider re-ordering` });

  if (highDrift > 0)
    suggestions.push({ type: "warning",
      message: `${highDrift} transition${highDrift > 1 ? "s" : ""} with >6% pitch drift` });

  const bpms = set.map(t => t.bpm).filter(Boolean) as number[];
  if (bpms.length > 1) {
    const min = Math.min(...bpms), max = Math.max(...bpms);
    suggestions.push({ type: "info",
      message: `BPM range: ${min}–${max} BPM` });
  }

  const uniqueReleases = new Set(set.map(t => t.releaseId)).size;
  suggestions.push({ type: "info",
    message: `${uniqueReleases} releases across ${set.length} tracks` });

  return suggestions;
}
