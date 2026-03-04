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

// ── BPM detection via autocorrelation ─────────────────────────────────────
function detectBpm(audioData: Float32Array, sampleRate: number): number {
  // Downsample to ~4kHz for speed
  const step = Math.floor(sampleRate / 4000);
  const downsampled: number[] = [];
  for (let i = 0; i < audioData.length; i += step) {
    downsampled.push(Math.abs(audioData[i]));
  }

  // Onset strength: diff of downsampled envelope
  const onsets: number[] = [];
  for (let i = 1; i < downsampled.length; i++) {
    onsets.push(Math.max(0, downsampled[i] - downsampled[i - 1]));
  }

  const effectiveSr = sampleRate / step;

  // Autocorrelation over 60–200 BPM range
  const minLag = Math.floor(effectiveSr * 60 / 200);
  const maxLag = Math.floor(effectiveSr * 60 / 60);

  let bestLag = minLag;
  let bestCorr = -Infinity;

  for (let lag = minLag; lag <= maxLag; lag++) {
    let corr = 0;
    for (let i = 0; i < onsets.length - lag; i++) {
      corr += onsets[i] * onsets[i + lag];
    }
    if (corr > bestCorr) { bestCorr = corr; bestLag = lag; }
  }

  const rawBpm = (effectiveSr * 60) / bestLag;

  // Snap to nearest DJ-friendly BPM (within ±2)
  const djBpms = [
    70,72,74,76,78,80,82,84,86,88,90,92,94,96,98,100,
    102,104,106,108,110,112,114,116,118,120,122,124,126,128,130,
    132,134,136,138,140,142,144,146,148,150
  ];
  let nearest = Math.round(rawBpm);
  let nearestDist = Infinity;
  for (const b of djBpms) {
    const d = Math.abs(rawBpm - b);
    if (d < nearestDist) { nearestDist = d; nearest = b; }
  }

  // Half/double time correction
  if (nearest < 90) {
    const doubled = nearest * 2;
    if (doubled >= 110 && doubled <= 150) nearest = doubled;
  } else if (nearest > 155) {
    const halved = nearest / 2;
    if (halved >= 60 && halved <= 155) nearest = halved;
  }

  return nearest;
}

// ── Key detection via chromagram + Krumhansl-Schmuckler ───────────────────
function detectKey(audioData: Float32Array, sampleRate: number): { key: string; scale: string; strength: number } {
  const frameSize = 4096;
  const hopSize = 2048;
  const chroma = new Float32Array(12);

  // Build chromagram
  for (let start = 0; start + frameSize < audioData.length; start += hopSize) {
    const frame = audioData.slice(start, start + frameSize);

    // Hann window
    for (let i = 0; i < frameSize; i++) {
      frame[i] *= 0.5 * (1 - Math.cos(2 * Math.PI * i / (frameSize - 1)));
    }

    // Simple DFT at chromagram frequencies (C2–B5)
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
  }

  // Normalise
  const maxC = Math.max(...Array.from(chroma));
  if (maxC > 0) for (let i = 0; i < 12; i++) chroma[i] /= maxC;

  // Krumhansl-Schmuckler profiles
  const MAJOR = [6.35,2.23,3.48,2.33,4.38,4.09,2.52,5.19,2.39,3.66,2.29,2.88];
  const MINOR = [6.33,2.68,3.52,5.38,2.60,3.53,2.54,4.75,3.98,2.69,3.34,3.17];

  function correlate(chroma: Float32Array, profile: number[], shift: number) {
    const n = 12;
    let sum = 0;
    const cx = Array.from(chroma);
    const px = profile.map((_, i) => profile[(i + shift) % n]);
    const cmean = cx.reduce((a,b) => a+b) / n;
    const pmean = px.reduce((a,b) => a+b) / n;
    let num = 0, dc = 0, dp = 0;
    for (let i = 0; i < n; i++) {
      num += (cx[i] - cmean) * (px[i] - pmean);
      dc  += (cx[i] - cmean) ** 2;
      dp  += (px[i] - pmean) ** 2;
    }
    sum = dc * dp > 0 ? num / Math.sqrt(dc * dp) : 0;
    return sum;
  }

  let bestKey = 0, bestScale = 'major', bestStrength = -Infinity;

  for (let note = 0; note < 12; note++) {
    const majorCorr = correlate(chroma, MAJOR, note);
    const minorCorr = correlate(chroma, MINOR, note);
    if (majorCorr > bestStrength) { bestStrength = majorCorr; bestKey = note; bestScale = 'major'; }
    if (minorCorr > bestStrength) { bestStrength = minorCorr; bestKey = note; bestScale = 'minor'; }
  }

  return { key: NOTE_NAMES[bestKey], scale: bestScale, strength: bestStrength };
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
