import type { Role, Track } from "./types";

// ── 4 Intent-Based Roles ──────────────────────────────────────────────────
export const ROLES: Record<string, Role> = {
  warmup:     { id: "warmup",     label: "Warm Up",     color: "#2980B9", emoji: "🔵" },
  midset:     { id: "midset",     label: "Mid Set",     color: "#C9A800", emoji: "🟡" },
  peak:       { id: "peak",       label: "Peak Time",   color: "#C0392B", emoji: "🔴" },
  afterhours: { id: "afterhours", label: "After-Hours", color: "#7D3C98", emoji: "🟣" },
};

export const ROLE_IDS = Object.keys(ROLES);

/**
 * Auto-assigns a role based on genre/style keywords and BPM.
 * Keyword match takes priority over BPM — a 140 BPM ambient track
 * is After-Hours, not Peak.
 */
export function autoRole(track: Track): string {
  const all = [...(track.styles || []), ...(track.genres || [])]
    .join(" ").toLowerCase();
  const bpm = track.bpm || 0;

  // After-Hours — highest priority
  if (/ambient|drone|experimental|noise|new age|isolationism|microsound/.test(all))
    return "afterhours";
  if (/dub techno|minimal techno|abstract|microhouse|lowercase/.test(all))
    return "afterhours";
  if (/after.?hour|late.?night/.test(all))
    return "afterhours";

  // Warm Up
  if (/warm.?up|deep house|balearic|nu.?jazz|soul jazz|slowcore|meditation/.test(all))
    return "warmup";
  if (/jazz funk|bossa/.test(all))
    return "warmup";
  if (bpm > 0 && bpm < 110)
    return "warmup";

  // Peak
  if (/hard techno|industrial techno|gabber|hardcore|rave|big room/.test(all))
    return "peak";
  if (/trance|psytrance|hard trance|uplifting/.test(all))
    return "peak";
  if (/drum.?n.?bass|dnb|jungle|breakbeat/.test(all))
    return "peak";
  if (bpm >= 135)
    return "peak";

  // Mid Set — default
  return "midset";
}

/** Returns the role ID, respecting manual overrides. */
export function assignRole(track: Track): string {
  if (track.roleOverride) return track.roleOverride;
  return autoRole(track);
}

/** Returns the full Role object for a track. */
export function roleOf(track: Track): Role {
  return ROLES[assignRole(track)] || ROLES.midset;
}
