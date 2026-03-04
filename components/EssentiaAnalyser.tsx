'use client';
import { useState, useRef, useCallback } from 'react';

interface AnalysisResult {
  bpm: number;
  key: string;
  keyRaw: string;
  confidence: number;
}

interface Props {
  onResult: (result: AnalysisResult) => void;
  trackName?: string;
}

const KEY_TO_CAM: Record<string, string> = {
  'C major':'8B','C minor':'5A','C# major':'3B','C# minor':'12A',
  'D major':'10B','D minor':'7A','D# major':'5B','D# minor':'2A','Eb major':'5B','Eb minor':'2A',
  'E major':'12B','E minor':'9A','F major':'7B','F minor':'4A',
  'F# major':'2B','F# minor':'11A','G major':'9B','G minor':'6A',
  'G# major':'4B','G# minor':'1A','Ab major':'4B','Ab minor':'1A',
  'A major':'11B','A minor':'8A','A# major':'6B','A# minor':'3A','Bb major':'6B','Bb minor':'3A',
  'B major':'1B','B minor':'10A',
};
const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// ── Simple FFT (Cooley-Tukey radix-2) ─────────────────────────────────────
function fft(re: Float64Array, im: Float64Array): void {
  const n = re.length;
  // Bit-reversal
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = -2 * Math.PI / len;
    const wRe = Math.cos(ang), wIm = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let curRe = 1, curIm = 0;
      for (let j = 0; j < len >> 1; j++) {
        const uRe = re[i + j], uIm = im[i + j];
        const vRe = re[i + j + len/2] * curRe - im[i + j + len/2] * curIm;
        const vIm = re[i + j + len/2] * curIm + im[i + j + len/2] * curRe;
        re[i + j] = uRe + vRe; im[i + j] = uIm + vIm;
        re[i + j + len/2] = uRe - vRe; im[i + j + len/2] = uIm - vIm;
        [curRe, curIm] = [curRe * wRe - curIm * wIm, curRe * wIm + curIm * wRe];
      }
    }
  }
}

// ── BPM via low-frequency energy + autocorrelation ───────────────────────
function detectBpm(audio: Float64Array, sr: number): number {
  const frameSize = 512;
  const hopSize   = 128; // ~2.9ms hop for tight onset resolution

  // Bandpass energy: keep only 50–300 Hz (kick/bass range)
  const lowBin  = Math.round(50  * frameSize / sr);
  const highBin = Math.round(300 * frameSize / sr);

  const energy: number[] = [];
  const re = new Float64Array(frameSize);
  const im = new Float64Array(frameSize);

  for (let start = 0; start + frameSize <= audio.length; start += hopSize) {
    re.fill(0); im.fill(0);
    for (let i = 0; i < frameSize; i++) {
      re[i] = audio[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / frameSize));
    }
    fft(re, im);
    let e = 0;
    for (let b = lowBin; b <= highBin; b++) e += re[b] * re[b] + im[b] * im[b];
    energy.push(e);
  }

  // Onset strength: half-wave rectified flux
  const onset: number[] = [0];
  for (let i = 1; i < energy.length; i++) {
    onset.push(Math.max(0, energy[i] - energy[i - 1]));
  }

  // Autocorrelation over 60–185 BPM
  const effectiveSr = sr / hopSize;
  const minLag = Math.floor(effectiveSr * 60 / 185);
  const maxLag = Math.floor(effectiveSr * 60 / 60);

  const corr = new Float64Array(maxLag + 1);
  for (let lag = minLag; lag <= maxLag; lag++) {
    let c = 0;
    for (let i = 0; i < onset.length - lag; i++) c += onset[i] * onset[i + lag];
    corr[lag] = c;
  }

  // Find top 5 peaks, collect BPM candidates
  const peaks: Array<{ lag: number; score: number }> = [];
  for (let lag = minLag + 1; lag < maxLag; lag++) {
    if (corr[lag] > corr[lag - 1] && corr[lag] > corr[lag + 1]) {
      peaks.push({ lag, score: corr[lag] });
    }
  }
  peaks.sort((a, b) => b.score - a.score);

  const candidates = peaks.slice(0, 6).map(p => (effectiveSr * 60) / p.lag);

  // Score candidates: prefer tempos in 110–145 range, penalise half/double
  function scoreTempo(t: number): number {
    let score = 0;
    if (t >= 110 && t <= 145) score += 3;
    else if (t >= 90 && t <= 155) score += 1;
    // Check if another candidate is at double/half — prefer the one in range
    for (const c of candidates) {
      if (Math.abs(c * 2 - t) < 3) score -= 1; // t is double of c, prefer c
      if (Math.abs(c / 2 - t) < 3) score += 1; // t is half of c, prefer t
    }
    return score;
  }

  let best = candidates[0] ?? 120;
  let bestScore = -Infinity;
  for (const t of candidates) {
    const s = scoreTempo(t);
    if (s > bestScore) { bestScore = s; best = t; }
  }

  // Snap to nearest integer
  return Math.round(best);
}

// ── Key via accumulated chromagram (entire signal) ─────────────────────────
function detectKey(audio: Float64Array, sr: number): { key: string; scale: string; strength: number } {
  const frameSize = 4096;
  const hopSize   = frameSize; // non-overlapping for speed
  const chroma    = new Float64Array(12);
  const re = new Float64Array(frameSize);
  const im = new Float64Array(frameSize);

  // Accumulate chromagram over ALL frames
  for (let start = 0; start + frameSize <= audio.length; start += hopSize) {
    re.fill(0); im.fill(0);
    for (let i = 0; i < frameSize; i++) {
      re[i] = audio[start + i] * (0.5 - 0.5 * Math.cos(2 * Math.PI * i / frameSize));
    }
    fft(re, im);

    // Map FFT bins to chroma classes
    for (let bin = 1; bin < frameSize / 2; bin++) {
      const freq = bin * sr / frameSize;
      if (freq < 100 || freq > 4000) continue;
      const mag  = Math.sqrt(re[bin] * re[bin] + im[bin] * im[bin]);
      // Convert to MIDI note, take chroma class
      const midi = 69 + 12 * Math.log2(freq / 440);
      const note = ((Math.round(midi) % 12) + 12) % 12;
      chroma[note] += mag;
    }
  }

  // Normalise chroma
  const maxC = Math.max(...Array.from(chroma));
  if (maxC > 0) for (let i = 0; i < 12; i++) chroma[i] /= maxC;

  // Krumhansl-Schmuckler profiles
  const MAJOR = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
  const MINOR = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

  function correlate(profile: number[], shift: number): number {
    const n = 12;
    const c = Array.from(chroma);
    const p = profile.map((_, i) => profile[(i + shift) % n]);
    const cm = c.reduce((a,b) => a+b)/n, pm = p.reduce((a,b) => a+b)/n;
    let num = 0, dc = 0, dp = 0;
    for (let i = 0; i < n; i++) {
      num += (c[i]-cm)*(p[i]-pm);
      dc  += (c[i]-cm)**2;
      dp  += (p[i]-pm)**2;
    }
    return dc*dp > 0 ? num/Math.sqrt(dc*dp) : 0;
  }

  let bestKey = 0, bestScale = 'major', bestStrength = -Infinity;
  for (let note = 0; note < 12; note++) {
    const maj = correlate(MAJOR, note);
    const min = correlate(MINOR, note);
    if (maj > bestStrength) { bestStrength = maj; bestKey = note; bestScale = 'major'; }
    if (min > bestStrength) { bestStrength = min; bestKey = note; bestScale = 'minor'; }
  }

  return { key: NOTE_NAMES[bestKey], scale: bestScale, strength: bestStrength };
}

// ── Main analysis entry point ──────────────────────────────────────────────
async function analyse(audioData: Float32Array, sampleRate: number): Promise<AnalysisResult> {
  // Convert to Float64 for precision
  const audio = new Float64Array(audioData.length);
  for (let i = 0; i < audioData.length; i++) audio[i] = audioData[i];

  const bpm = detectBpm(audio, sampleRate);
  const { key, scale, strength } = detectKey(audio, sampleRate);
  const keyRaw = `${key} ${scale}`;
  const camelot = KEY_TO_CAM[keyRaw];

  if (!camelot) throw new Error(`Unknown key: ${keyRaw}`);

  return {
    bpm,
    key: camelot,
    keyRaw,
    confidence: Math.round(Math.min(98, Math.max(55, strength * 80 + 55))),
  };
}

// ── Theme ──────────────────────────────────────────────────────────────────
const T = {
  surface: '#ffffff', surface2: '#f2f1ee',
  border: '#dddbd6', text: '#1a1916', muted: '#8a8680',
  accent: '#9a6c2e', green: '#2e7d52', red: '#c0392b',
};

type Mode = 'idle' | 'mic' | 'analysing' | 'done' | 'error';

export default function EssentiaAnalyser({ onResult, trackName }: Props) {
  const [mode, setMode]     = useState<Mode>('idle');
  const [msg,  setMsg]      = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [secs, setSecs]     = useState(0);

  const streamRef    = useRef<MediaStream | null>(null);
  const chunksRef    = useRef<Float32Array[]>([]);
  const contextRef   = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const timerRef     = useRef<ReturnType<typeof setInterval> | null>(null);

  const stopMic = useCallback(() => {
    if (timerRef.current)    { clearInterval(timerRef.current); timerRef.current = null; }
    if (processorRef.current){ processorRef.current.disconnect(); processorRef.current = null; }
    if (streamRef.current)   { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (contextRef.current)  { contextRef.current.close(); contextRef.current = null; }
  }, []);

  const runAnalysis = useCallback(async (audioData: Float32Array, sampleRate: number) => {
    setMode('analysing'); setMsg('Analysing BPM and key…');
    await new Promise(r => setTimeout(r, 30)); // let UI update
    try {
      const result = await analyse(audioData, sampleRate);
      setResult(result);
      setMode('done');
      setMsg('');
      onResult(result);
    } catch (e: unknown) {
      setMode('error');
      setMsg(e instanceof Error ? e.message : 'Analysis failed');
    }
  }, [onResult]);

  const startMic = useCallback(async () => {
    chunksRef.current = []; setSecs(0); setMode('mic'); setMsg('');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 44100, channelCount: 1, echoCancellation: false, noiseSuppression: false, autoGainControl: false },
      });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 44100 });
      contextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;
      processor.onaudioprocess = (e) => {
        chunksRef.current.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(processor);
      processor.connect(ctx.destination);
      timerRef.current = setInterval(() => setSecs(s => s + 1), 1000);
    } catch (e: unknown) {
      setMode('error');
      setMsg(e instanceof Error ? e.message : 'Microphone access denied');
    }
  }, []);

  const stopAndAnalyse = useCallback(async () => {
    stopMic();
    const chunks = chunksRef.current;
    if (!chunks.length) { setMode('error'); setMsg('No audio recorded'); return; }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const combined = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { combined.set(c, off); off += c.length; }
    await runAnalysis(combined, 44100);
  }, [stopMic, runAnalysis]);

  const handleFile = useCallback(async (file: File) => {
    setMode('analysing'); setMsg('Decoding audio…');
    try {
      const buf = await file.arrayBuffer();
      const ctx = new AudioContext({ sampleRate: 44100 });
      const audio = await ctx.decodeAudioData(buf);
      const mono  = new Float32Array(audio.length);
      for (let ch = 0; ch < audio.numberOfChannels; ch++) {
        const d = audio.getChannelData(ch);
        for (let i = 0; i < d.length; i++) mono[i] += d[i];
      }
      for (let i = 0; i < mono.length; i++) mono[i] /= audio.numberOfChannels;
      await ctx.close();
      await runAnalysis(mono, 44100);
    } catch (e: unknown) {
      setMode('error');
      setMsg(e instanceof Error ? e.message : 'Could not decode file');
    }
  }, [runAnalysis]);

  const reset = () => { stopMic(); setMode('idle'); setMsg(''); setResult(null); setSecs(0); };

  const btnStyle = (primary = false, disabled = false) => ({
    padding: '4px 12px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600,
    cursor: disabled ? 'default' : 'pointer',
    border: `1px solid ${T.border}`,
    background: primary ? T.accent : T.surface2,
    color: primary ? '#fff' : T.text,
    opacity: disabled ? 0.45 : 1,
  });

  // Recording quality indicator
  const quality = secs < 8 ? 'fair' : secs < 15 ? 'good' : 'excellent';
  const qualityColor = secs < 8 ? T.muted : secs < 15 ? '#c9a800' : T.green;

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '0.75rem', fontSize: '0.75rem' }}>
      {trackName && <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: T.text, fontSize: '0.7rem' }}>{trackName}</div>}

      {mode === 'idle' && (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button onClick={startMic} style={btnStyle(true)}>🎙 Mic</button>
          <label style={{ ...btnStyle(), cursor: 'pointer' }}>
            📁 File
            <input type="file" accept="audio/*" style={{ display: 'none' }}
              onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
        </div>
      )}

      {mode === 'mic' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          {/* Waveform bars */}
          <div style={{ display: 'flex', gap: 2, alignItems: 'flex-end', height: 18 }}>
            {[14,9,18,11,16,8,20,10,15].map((h, i) => (
              <div key={i} style={{ width: 3, borderRadius: 2, background: T.accent, height: h * (secs > 0 ? 1 : 0.4) }} />
            ))}
          </div>
          <span style={{ fontWeight: 700, color: T.accent, minWidth: 28 }}>{secs}s</span>
          <span style={{ fontSize: '0.65rem', color: qualityColor, fontWeight: 600 }}>{quality}</span>
          <button onClick={stopAndAnalyse} disabled={secs < 5} style={btnStyle(true, secs < 5)}>
            ⬛ Analyse
          </button>
          <button onClick={reset} style={{ ...btnStyle(), color: T.muted }}>✕</button>
        </div>
      )}

      {mode === 'analysing' && (
        <div style={{ color: T.muted, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, border: `2px solid ${T.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          {msg}
        </div>
      )}

      {mode === 'error' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: T.red }}>⚠ {msg}</span>
          <button onClick={reset} style={btnStyle()}>Retry</button>
        </div>
      )}

      {mode === 'done' && result && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: T.green, fontWeight: 700 }}>✓</span>
          <span><b style={{ color: T.accent, fontSize: '0.9rem' }}>{result.bpm}</b> <span style={{ color: T.muted }}>BPM</span></span>
          <span><b style={{ color: T.accent, fontSize: '0.9rem' }}>{result.key}</b> <span style={{ color: T.muted, fontSize: '0.65rem' }}>({result.keyRaw})</span></span>
          <span style={{ color: T.muted, fontSize: '0.65rem' }}>{result.confidence}% conf</span>
          <button onClick={reset} style={{ ...btnStyle(), color: T.muted, fontSize: '0.65rem' }}>↺</button>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
