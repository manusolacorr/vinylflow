'use client';
import { useState, useRef, useCallback } from 'react';

interface AnalysisResult {
  bpm: number;
  key: string;   // Camelot notation e.g. "11A"
  keyRaw: string; // e.g. "F# minor"
  confidence: number;
}

interface Props {
  onResult: (result: AnalysisResult) => void;
  trackName?: string;
}

// ── Camelot map ────────────────────────────────────────────────────────────
const KEY_TO_CAM: Record<string, string> = {
  'C major':'8B','C minor':'5A','C# major':'3B','C# minor':'12A','Db major':'3B','Db minor':'12A',
  'D major':'10B','D minor':'7A','D# major':'5B','D# minor':'2A','Eb major':'5B','Eb minor':'2A',
  'E major':'12B','E minor':'9A','F major':'7B','F minor':'4A',
  'F# major':'2B','F# minor':'11A','Gb major':'2B','Gb minor':'11A',
  'G major':'9B','G minor':'6A','G# major':'4B','G# minor':'1A','Ab major':'4B','Ab minor':'1A',
  'A major':'11B','A minor':'8A','A# major':'6B','A# minor':'3A','Bb major':'6B','Bb minor':'3A',
  'B major':'1B','B minor':'10A',
};

const NOTE_NAMES = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];

// ── BPM detection via multi-window autocorrelation + median vote ──────────
function detectBpmWindow(onsets: number[], effectiveSr: number): number | null {
  const minLag = Math.floor(effectiveSr * 60 / 200);
  const maxLag = Math.floor(effectiveSr * 60 / 60);
  if (onsets.length < maxLag * 2) return null;

  let bestLag = minLag, bestCorr = -Infinity;
  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < onsets.length - lag; i++) corr += onsets[i] * onsets[i + lag];
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }
  return (effectiveSr * 60) / bestLag;
}

function snapBpm(raw: number): number {
  // Half/double time correction first
  let bpm = raw;
  if (bpm < 90)       { const d = bpm * 2;  if (d >= 100 && d <= 155) bpm = d; }
  else if (bpm > 155) { const h = bpm / 2;  if (h >= 60  && h <= 155) bpm = h; }
  // Snap to nearest even integer (most DJ tempos are even)
  return Math.round(bpm / 2) * 2;
}

function detectBpm(audioData: Float32Array, sampleRate: number): number {
  const step = Math.floor(sampleRate / 4000);
  const effectiveSr = sampleRate / step;

  // Build full onset envelope
  const full: number[] = [];
  for (let i = 0; i < audioData.length; i += step) full.push(Math.abs(audioData[i]));
  const onsets: number[] = [0];
  for (let i = 1; i < full.length; i++) onsets.push(Math.max(0, full[i] - full[i - 1]));

  // Analyse in 10-second windows, collect raw BPMs
  const winSamples = Math.floor(effectiveSr * 10);
  const hopSamples = Math.floor(effectiveSr * 5);
  const rawBpms: number[] = [];

  for (let start = 0; start + winSamples < onsets.length; start += hopSamples) {
    const win = onsets.slice(start, start + winSamples);
    const bpm = detectBpmWindow(win, effectiveSr);
    if (bpm && bpm > 60 && bpm < 200) rawBpms.push(bpm);
  }

  if (rawBpms.length === 0) {
    // Fallback: full signal
    const bpm = detectBpmWindow(onsets, effectiveSr);
    return bpm ? snapBpm(bpm) : 120;
  }

  // Snap all, then take the most common snapped value
  const snapped = rawBpms.map(snapBpm);
  const votes: Record<number, number> = {};
  for (const b of snapped) votes[b] = (votes[b] || 0) + 1;
  const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  return parseInt(winner[0]);
}

// ── Key detection via chromagram + Krumhansl-Schmuckler (multi-window) ────
const MAJOR_PROFILE = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
const MINOR_PROFILE = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

function chromaCorrelate(chroma: number[], profile: number[], shift: number): number {
  const n = 12;
  const px = Array.from({ length: n }, (_, i) => profile[(i + shift) % n]);
  const cmean = chroma.reduce((a, b) => a + b) / n;
  const pmean = px.reduce((a, b) => a + b) / n;
  let num = 0, dc = 0, dp = 0;
  for (let i = 0; i < n; i++) {
    num += (chroma[i] - cmean) * (px[i] - pmean);
    dc  += (chroma[i] - cmean) ** 2;
    dp  += (px[i] - pmean) ** 2;
  }
  return dc * dp > 0 ? num / Math.sqrt(dc * dp) : 0;
}

function buildChroma(audioData: Float32Array, sampleRate: number, start: number, frameSize: number): number[] {
  const chroma = new Array(12).fill(0);
  const frame = new Float32Array(frameSize);
  for (let i = 0; i < frameSize && start + i < audioData.length; i++) {
    frame[i] = audioData[start + i] * 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
  }
  for (let note = 0; note < 12; note++) {
    for (let octave = 2; octave <= 5; octave++) {
      const freq = 261.63 * Math.pow(2, (note + (octave - 4) * 12) / 12);
      let re = 0, im = 0;
      for (let n = 0; n < frameSize; n++) {
        const angle = 2 * Math.PI * freq * n / sampleRate;
        re += frame[n] * Math.cos(angle);
        im -= frame[n] * Math.sin(angle);
      }
      chroma[note] += Math.sqrt(re * re + im * im);
    }
  }
  return chroma;
}

function detectKey(audioData: Float32Array, sampleRate: number): { key: string; scale: string; strength: number } {
  const frameSize = 8192;
  const hopSize   = frameSize * 2; // sparse hops — key doesn't change

  // Vote across windows
  const votes: Record<string, number> = {};

  for (let start = 0; start + frameSize < audioData.length; start += hopSize) {
    const chroma = buildChroma(audioData, sampleRate, start, frameSize);
    const maxC = Math.max(...chroma);
    if (maxC === 0) continue;
    const norm = chroma.map(v => v / maxC);

    let bestKey = 0, bestScale = 'major', bestCorr = -Infinity;
    for (let note = 0; note < 12; note++) {
      const maj = chromaCorrelate(norm, MAJOR_PROFILE, note);
      const min = chromaCorrelate(norm, MINOR_PROFILE, note);
      if (maj > bestCorr) { bestCorr = maj; bestKey = note; bestScale = 'major'; }
      if (min > bestCorr) { bestCorr = min; bestKey = note; bestScale = 'minor'; }
    }
    const label = `${NOTE_NAMES[bestKey]} ${bestScale}`;
    votes[label] = (votes[label] || 0) + 1;
  }

  if (Object.keys(votes).length === 0) return { key: 'C', scale: 'major', strength: 0 };

  // Pick most-voted key
  const winner = Object.entries(votes).sort((a, b) => b[1] - a[1])[0];
  const total  = Object.values(votes).reduce((a, b) => a + b, 0);
  const [note, scale] = winner[0].split(' ');
  return { key: note, scale, strength: winner[1] / total }; // strength = vote share
}

// ── Theme ──────────────────────────────────────────────────────────────────
const T = {
  surface: '#ffffff', surface2: '#f2f1ee',
  border: '#dddbd6', text: '#1a1916', muted: '#8a8680',
  accent: '#9a6c2e', green: '#2e7d52', red: '#c0392b',
};

type Mode = 'idle' | 'mic' | 'analysing' | 'done' | 'error';

export default function EssentiaAnalyser({ onResult, trackName }: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  const [msg, setMsg]   = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [micSeconds, setMicSeconds] = useState(0);

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

  const analyse = useCallback(async (audioData: Float32Array, sampleRate: number) => {
    setMode('analysing');

    // Run in a setTimeout so the UI updates before the heavy computation
    await new Promise(r => setTimeout(r, 50));

    try {
      setMsg('Detecting BPM...');
      await new Promise(r => setTimeout(r, 20));
      const bpm = detectBpm(audioData, sampleRate);

      setMsg('Detecting key...');
      await new Promise(r => setTimeout(r, 20));
      const { key, scale, strength } = detectKey(audioData, sampleRate);
      const keyRaw = `${key} ${scale}`;
      const camelot = KEY_TO_CAM[keyRaw];

      if (!camelot) throw new Error(`Unrecognised key: ${keyRaw}`);

      const r: AnalysisResult = {
        bpm,
        key: camelot,
        keyRaw,
        confidence: Math.round(Math.min(99, Math.max(50, strength * 100 + 50))),
      };
      setResult(r);
      setMode('done');
      setMsg('');
      onResult(r);
    } catch (e: unknown) {
      setMode('error');
      setMsg(e instanceof Error ? e.message : 'Analysis failed');
    }
  }, [onResult]);

  const startMic = useCallback(async () => {
    chunksRef.current = [];
    setMicSeconds(0);
    setMode('mic');
    setMsg('Listening... play your record');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { sampleRate: 44100, channelCount: 1, echoCancellation: false, noiseSuppression: false },
      });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 44100 });
      contextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      // eslint-disable-next-line @typescript-eslint/no-deprecated
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
        chunksRef.current.push(chunk.slice());
      };
      source.connect(processor);
      processor.connect(ctx.destination);

      timerRef.current = setInterval(() => setMicSeconds(s => s + 1), 1000);
    } catch (e: unknown) {
      setMode('error');
      setMsg(e instanceof Error ? e.message : 'Microphone access denied');
    }
  }, []);

  const stopAndAnalyse = useCallback(async () => {
    stopMic();
    const chunks = chunksRef.current;
    if (chunks.length === 0) { setMode('error'); setMsg('No audio recorded'); return; }
    const total = chunks.reduce((s, c) => s + c.length, 0);
    const combined = new Float32Array(total);
    let offset = 0;
    for (const c of chunks) { combined.set(c, offset); offset += c.length; }
    await analyse(combined, 44100);
  }, [stopMic, analyse]);

  const handleFile = useCallback(async (file: File) => {
    setMode('analysing'); setMsg('Decoding audio file...');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new AudioContext({ sampleRate: 44100 });
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      const mono = new Float32Array(audioBuffer.length);
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        const data = audioBuffer.getChannelData(ch);
        for (let i = 0; i < data.length; i++) mono[i] += data[i];
      }
      for (let i = 0; i < mono.length; i++) mono[i] /= audioBuffer.numberOfChannels;
      await ctx.close();
      await analyse(mono, 44100);
    } catch (e: unknown) {
      setMode('error');
      setMsg(e instanceof Error ? e.message : 'Could not decode file');
    }
  }, [analyse]);

  const reset = () => { stopMic(); setMode('idle'); setMsg(''); setResult(null); setMicSeconds(0); };

  const btnStyle = (primary = false) => ({
    padding: '4px 12px', borderRadius: 6, fontSize: '0.72rem', fontWeight: 600,
    cursor: 'pointer', border: `1px solid ${T.border}`,
    background: primary ? T.accent : T.surface2,
    color: primary ? '#fff' : T.text,
  });

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '0.75rem', fontSize: '0.75rem' }}>
      {trackName && <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: T.text, fontSize: '0.7rem' }}>{trackName}</div>}

      {/* Idle */}
      {mode === 'idle' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={startMic} style={btnStyle(true)}>🎙 Mic (live record)</button>
          <label style={{ ...btnStyle(), cursor: 'pointer' }}>
            📁 Audio file
            <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
        </div>
      )}

      {/* Mic recording */}
      {mode === 'mic' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ display: 'flex', gap: 3, alignItems: 'flex-end', height: 20 }}>
            {[12,8,16,10,14,7,18].map((h, i) => (
              <div key={i} style={{ width: 3, borderRadius: 2, background: T.accent, height: h }} />
            ))}
          </div>
          <span style={{ color: T.accent, fontWeight: 700 }}>{micSeconds}s</span>
          <span style={{ color: T.muted, fontSize: '0.65rem' }}>min 8s recommended</span>
          <button
            onClick={stopAndAnalyse}
            disabled={micSeconds < 4}
            style={{ ...btnStyle(micSeconds >= 4), opacity: micSeconds < 4 ? 0.5 : 1 }}
          >
            ⬛ Stop & Analyse
          </button>
          <button onClick={reset} style={{ ...btnStyle(), fontSize: '0.65rem', color: T.muted }}>Cancel</button>
        </div>
      )}

      {/* Analysing */}
      {mode === 'analysing' && (
        <div style={{ color: T.muted, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, border: `2px solid ${T.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite', flexShrink: 0 }} />
          {msg || 'Analysing...'}
        </div>
      )}

      {/* Error */}
      {mode === 'error' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: T.red }}>⚠ {msg}</span>
          <button onClick={reset} style={btnStyle()}>Retry</button>
        </div>
      )}

      {/* Done */}
      {mode === 'done' && result && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ color: T.green, fontWeight: 700 }}>✓</span>
          <span><b style={{ color: T.accent, fontSize: '0.85rem' }}>{result.bpm}</b> <span style={{ color: T.muted }}>BPM</span></span>
          <span><b style={{ color: T.accent, fontSize: '0.85rem' }}>{result.key}</b> <span style={{ color: T.muted, fontSize: '0.65rem' }}>({result.keyRaw})</span></span>
          <span style={{ color: T.muted, fontSize: '0.65rem' }}>{result.confidence}% conf</span>
          <button onClick={reset} style={{ ...btnStyle(), color: T.muted }}>Re-analyse</button>
        </div>
      )}

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
