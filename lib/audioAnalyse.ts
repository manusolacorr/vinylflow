/**
 * audioAnalyse.ts — Server-side BPM + key detection from a raw audio buffer.
 *
 * No WASM, no native addons — pure TypeScript math.
 * Works in Vercel Edge/Node runtime from an ArrayBuffer (MP3/WAV/OGG preview).
 *
 * Algorithm:
 *  BPM  — onset envelope autocorrelation, snapped to DJ-friendly grid
 *  Key  — accumulated chromagram (constant-Q approximation) + Krumhansl-Schmuckler
 */

// ── Camelot mapping ──────────────────────────────────────────────────────────
const PITCH_CLASS_TO_CAMELOT: Record<string, string> = {
  'C major':'8B',  'C minor':'5A',
  'C# major':'3B', 'C# minor':'12A',
  'D major':'10B', 'D minor':'7A',
  'Eb major':'5B', 'Eb minor':'2A',
  'E major':'12B', 'E minor':'9A',
  'F major':'7B',  'F minor':'4A',
  'F# major':'2B', 'F# minor':'11A',
  'G major':'9B',  'G minor':'6A',
  'Ab major':'4B', 'Ab minor':'1A',
  'A major':'11B', 'A minor':'8A',
  'Bb major':'6B', 'Bb minor':'3A',
  'B major':'1B',  'B minor':'10A',
};

const NOTE_NAMES = ['C','C#','D','Eb','E','F','F#','G','Ab','A','Bb','B'];

// Krumhansl-Schmuckler key profiles
const MAJOR_PROFILE = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const MINOR_PROFILE = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

// ── Simple PCM decoder (handles raw IEEE float 32 from Web Audio export) ─────
// For real MP3 decoding server-side we'd need ffmpeg; instead we work with
// whatever raw float32 data comes from the client-side Web Audio pipeline,
// OR we accept a Float32Array directly from a server fetch + manual decode.

function chromagram(samples: Float32Array, sampleRate: number): number[] {
  const chroma = new Array(12).fill(0);
  const windowSize = 4096;
  const hopSize = 2048;
  const numWindows = Math.floor((samples.length - windowSize) / hopSize);

  for (let w = 0; w < numWindows; w++) {
    const offset = w * hopSize;
    // Simple DFT-based chroma — map each DFT bin to a pitch class
    for (let k = 1; k < windowSize / 2; k++) {
      let re = 0, im = 0;
      for (let n = 0; n < windowSize; n++) {
        const angle = (2 * Math.PI * k * n) / windowSize;
        re += samples[offset + n] * Math.cos(angle);
        im -= samples[offset + n] * Math.sin(angle);
      }
      const mag = Math.sqrt(re * re + im * im);
      const freq = (k * sampleRate) / windowSize;
      if (freq < 80 || freq > 2000) continue; // focus on pitched content
      // Map frequency to pitch class
      const midi = Math.round(12 * Math.log2(freq / 440) + 69);
      const pc = ((midi % 12) + 12) % 12;
      chroma[pc] += mag;
    }
  }
  return chroma;
}

function detectKey(chroma: number[]): string {
  // Normalize chroma
  const sum = chroma.reduce((a, b) => a + b, 0) || 1;
  const norm = chroma.map(v => v / sum);

  let bestScore = -Infinity;
  let bestKey = 'C major';

  for (let root = 0; root < 12; root++) {
    // Major
    let majorScore = 0, minorScore = 0;
    for (let i = 0; i < 12; i++) {
      majorScore += norm[(root + i) % 12] * MAJOR_PROFILE[i];
      minorScore += norm[(root + i) % 12] * MINOR_PROFILE[i];
    }
    if (majorScore > bestScore) { bestScore = majorScore; bestKey = `${NOTE_NAMES[root]} major`; }
    if (minorScore > bestScore) { bestScore = minorScore; bestKey = `${NOTE_NAMES[root]} minor`; }
  }

  return PITCH_CLASS_TO_CAMELOT[bestKey] ?? '8B';
}

function detectBpm(samples: Float32Array, sampleRate: number): number {
  // Build onset envelope via RMS over short frames
  const frameSize = Math.round(sampleRate * 0.01); // 10ms frames
  const envelope: number[] = [];
  for (let i = 0; i + frameSize < samples.length; i += frameSize) {
    let rms = 0;
    for (let j = 0; j < frameSize; j++) rms += samples[i + j] ** 2;
    envelope.push(Math.sqrt(rms / frameSize));
  }

  // Half-wave rectified derivative (onset strength)
  const onset = envelope.map((v, i) => Math.max(0, v - (envelope[i - 1] ?? 0)));

  // Autocorrelation over BPM range 60–180
  const framesPerMinute = (1 / 0.01) * 60; // 100 frames/sec * 60
  const minLag = Math.round(framesPerMinute / 180);
  const maxLag = Math.round(framesPerMinute / 60);
  let bestBpm = 120, bestCorr = -1;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < onset.length - lag; i++) corr += onset[i] * onset[i + lag];
    const bpm = framesPerMinute / lag;
    if (corr > bestCorr) { bestCorr = corr; bestBpm = bpm; }
  }

  // Snap to DJ-friendly BPM grid (whole numbers)
  return Math.round(bestBpm);
}

// ── Public API ───────────────────────────────────────────────────────────────

export interface AudioAnalysisResult {
  bpm: number | null;
  key: string | null; // Camelot e.g. "11A"
}

/**
 * Analyse a Float32Array of mono audio samples.
 * Call this after decoding an audio buffer server-side.
 */
export function analyseAudio(samples: Float32Array, sampleRate: number): AudioAnalysisResult {
  if (samples.length < sampleRate * 5) {
    // Too short for reliable analysis (< 5 seconds)
    return { bpm: null, key: null };
  }
  const bpm = detectBpm(samples, sampleRate);
  const chroma = chromagram(samples, sampleRate);
  const key = detectKey(chroma);
  return { bpm, key };
}
