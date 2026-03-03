/**
 * Genre-aware BPM/Key validation layer.
 * Corrects half-time and double-time detection errors.
 * Returns corrected values + confidence flag.
 */

export interface ValidationResult {
  bpm: number | null;
  key: string | null;
  confidence: 'high' | 'low';
  correction: string | null; // human-readable note about what was corrected
}

// BPM ranges per genre family (min, max, typical)
const GENRE_BPM_RANGES: Record<string, { min: number; max: number; label: string }> = {
  house:        { min: 118, max: 130, label: 'House' },
  techno:       { min: 128, max: 145, label: 'Techno' },
  deephouse:    { min: 118, max: 126, label: 'Deep House' },
  disco:        { min: 108, max: 130, label: 'Disco' },
  funk:         { min: 85,  max: 128, label: 'Funk' },
  soul:         { min: 60,  max: 120, label: 'Soul' },
  jazz:         { min: 60,  max: 200, label: 'Jazz' },
  ambient:      { min: 60,  max: 100, label: 'Ambient' },
  hiphop:       { min: 75,  max: 100, label: 'Hip-Hop' },
  afrobeat:     { min: 90,  max: 130, label: 'Afrobeat' },
  latin:        { min: 90,  max: 130, label: 'Latin' },
  electronic:   { min: 100, max: 145, label: 'Electronic' },
  rb:           { min: 60,  max: 110, label: 'R&B' },
};

// Map genre/style strings → genre family key
function detectGenreFamily(genres: string[], styles: string[]): string | null {
  const all = [...genres, ...styles].map(s => s.toLowerCase());
  if (all.some(s => s.includes('deep house'))) return 'deephouse';
  if (all.some(s => s.includes('house'))) return 'house';
  if (all.some(s => s.includes('techno'))) return 'techno';
  if (all.some(s => s.includes('disco'))) return 'disco';
  if (all.some(s => s.includes('funk'))) return 'funk';
  if (all.some(s => s.includes('soul'))) return 'soul';
  if (all.some(s => s.includes('jazz'))) return 'jazz';
  if (all.some(s => s.includes('ambient') || s.includes('downtempo'))) return 'ambient';
  if (all.some(s => s.includes('hip'))) return 'hiphop';
  if (all.some(s => s.includes('afro'))) return 'afrobeat';
  if (all.some(s => s.includes('latin') || s.includes('cumbia') || s.includes('salsa'))) return 'latin';
  if (all.some(s => s.includes('electronic') || s.includes('synth'))) return 'electronic';
  if (all.some(s => s.includes('r&b') || s.includes('rhythm'))) return 'rb';
  return null;
}

const CAM_KEYS = new Set(['1A','1B','2A','2B','3A','3B','4A','4B','5A','5B','6A','6B',
                           '7A','7B','8A','8B','9A','9B','10A','10B','11A','11B','12A','12B']);

export function validateBpmKey(
  bpm: number | null,
  key: string | null,
  genres: string[],
  styles: string[],
  artistHint?: string,
): ValidationResult {
  let correctedBpm = bpm;
  let correctedKey = key && CAM_KEYS.has(key.toUpperCase()) ? key.toUpperCase() : null;
  let correction: string | null = null;
  let confidence: 'high' | 'low' = 'high';

  if (bpm && bpm > 0) {
    const family = detectGenreFamily(genres, styles);
    const range = family ? GENRE_BPM_RANGES[family] : null;

    if (range) {
      // Half-time: detected BPM is ~half the expected range
      if (bpm < range.min * 0.65 && bpm * 2 >= range.min && bpm * 2 <= range.max * 1.1) {
        correctedBpm = Math.round(bpm * 2);
        correction = `Half-time corrected: ${bpm} → ${correctedBpm} BPM (${range.label} range: ${range.min}–${range.max})`;
        confidence = 'low'; // was wrong, now corrected
      }
      // Double-time: detected BPM is ~double the expected range
      else if (bpm > range.max * 1.5 && bpm / 2 >= range.min && bpm / 2 <= range.max) {
        correctedBpm = Math.round(bpm / 2);
        correction = `Double-time corrected: ${bpm} → ${correctedBpm} BPM (${range.label} range: ${range.min}–${range.max})`;
        confidence = 'low';
      }
      // Out of range but no clean half/double fix
      else if (bpm < range.min * 0.7 || bpm > range.max * 1.4) {
        confidence = 'low';
        correction = `BPM ${bpm} outside ${range.label} range (${range.min}–${range.max}) — verify manually`;
      }
    }
  }

  // Validate BPM is in sane absolute range (40–220)
  if (correctedBpm && (correctedBpm < 40 || correctedBpm > 220)) {
    correctedBpm = null;
    confidence = 'low';
    correction = (correction ? correction + '; ' : '') + 'BPM out of valid range (40–220)';
  }

  return { bpm: correctedBpm, key: correctedKey, confidence, correction };
}
