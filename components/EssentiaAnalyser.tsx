'use client';
import { useState, useRef, useCallback, useEffect } from 'react';

interface AnalysisResult {
  bpm: number;
  key: string; // Camelot notation
  keyRaw: string; // e.g. "A minor"
  confidence: number;
}

interface Props {
  onResult: (result: AnalysisResult) => void;
  trackName?: string;
}

// Musical key → Camelot
const KEY_TO_CAM: Record<string, string> = {
  'C major':'8B','C minor':'5A','C# major':'3B','C# minor':'12A','Db major':'3B','Db minor':'12A',
  'D major':'10B','D minor':'7A','D# major':'5B','D# minor':'2A','Eb major':'5B','Eb minor':'2A',
  'E major':'12B','E minor':'9A','F major':'7B','F minor':'4A',
  'F# major':'2B','F# minor':'11A','Gb major':'2B','Gb minor':'11A',
  'G major':'9B','G minor':'6A','G# major':'4B','G# minor':'1A','Ab major':'4B','Ab minor':'1A',
  'A major':'11B','A minor':'8A','A# major':'6B','A# minor':'3A','Bb major':'6B','Bb minor':'3A',
  'B major':'1B','B minor':'10A',
};

const T = {
  bg: '#f7f6f3', surface: '#ffffff', surface2: '#f2f1ee',
  border: '#dddbd6', text: '#1a1916', muted: '#8a8680',
  accent: '#9a6c2e', green: '#2e7d52', red: '#c0392b',
};

type Mode = 'idle' | 'mic' | 'file' | 'analysing' | 'done' | 'error';

export default function EssentiaAnalyser({ onResult, trackName }: Props) {
  const [mode, setMode] = useState<Mode>('idle');
  const [msg, setMsg] = useState('');
  const [result, setResult] = useState<AnalysisResult | null>(null);
  const [micSeconds, setMicSeconds] = useState(0);
  const [loaded, setLoaded] = useState(false);

  const essentiaRef = useRef<unknown>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Float32Array[]>([]);
  const contextRef = useRef<AudioContext | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Load Essentia.js on mount
  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        // Load Essentia WASM via CDN
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/essentia-wasm.umd.js';
          script.onload = () => resolve();
          script.onerror = reject;
          document.head.appendChild(script);
        });
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = 'https://cdn.jsdelivr.net/npm/essentia.js@0.1.3/dist/essentia.js-core.umd.js';
          script.onload = () => resolve();
          script.onerror = reject;
          document.head.appendChild(script);
        });
        if (cancelled) return;
        // Wait for WASM module to initialise
        await new Promise(r => setTimeout(r, 500));
        // @ts-expect-error: Essentia loaded via CDN
        const EssentiaWASM = window.EssentiaWASM;
        // @ts-expect-error: Essentia loaded via CDN
        const Essentia = window.Essentia;
        if (EssentiaWASM && Essentia) {
          const wasmModule = await EssentiaWASM();
          essentiaRef.current = new Essentia(wasmModule);
          setLoaded(true);
        }
      } catch(e) {
        console.error('Essentia load error', e);
      }
    }
    load();
    return () => { cancelled = true; };
  }, []);

  const stopMic = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current);
    if (processorRef.current) { processorRef.current.disconnect(); processorRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    if (contextRef.current) { contextRef.current.close(); contextRef.current = null; }
  }, []);

  const analyse = useCallback(async (audioData: Float32Array, sampleRate: number) => {
    setMode('analysing');
    setMsg('Analysing audio...');
    try {
      const essentia = essentiaRef.current as {
        arrayToVector: (a: Float32Array) => unknown;
        RhythmExtractor2013: (v: unknown) => { bpm: number; confidence: number };
        KeyExtractor: (v: unknown) => { key: string; scale: string; strength: number };
      };
      if (!essentia) throw new Error('Essentia not loaded');

      const vector = essentia.arrayToVector(audioData);

      setMsg('Detecting BPM...');
      const rhythm = essentia.RhythmExtractor2013(vector);
      const bpm = Math.round(rhythm.bpm);

      setMsg('Detecting key...');
      const keyResult = essentia.KeyExtractor(vector);
      const keyRaw = `${keyResult.key} ${keyResult.scale}`;
      const camelot = KEY_TO_CAM[keyRaw] || null;

      if (!camelot) throw new Error(`Unknown key: ${keyRaw}`);

      const r: AnalysisResult = {
        bpm,
        key: camelot,
        keyRaw,
        confidence: Math.round((rhythm.confidence + keyResult.strength) / 2 * 100),
      };
      setResult(r);
      setMode('done');
      setMsg('');
      onResult(r);
    } catch(e: unknown) {
      setMode('error');
      setMsg(e instanceof Error ? e.message : 'Analysis failed');
    }
  }, [onResult]);

  // Start microphone recording
  const startMic = useCallback(async () => {
    if (!loaded) { setMsg('Essentia still loading...'); return; }
    chunksRef.current = [];
    setMicSeconds(0);
    setMode('mic');
    setMsg('Listening... play your record');

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { sampleRate: 44100, channelCount: 1 } });
      streamRef.current = stream;
      const ctx = new AudioContext({ sampleRate: 44100 });
      contextRef.current = ctx;
      const source = ctx.createMediaStreamSource(stream);
      const processor = ctx.createScriptProcessor(4096, 1, 1);
      processorRef.current = processor;

      processor.onaudioprocess = (e) => {
        const chunk = new Float32Array(e.inputBuffer.getChannelData(0));
        chunksRef.current.push(chunk.slice());
      };

      source.connect(processor);
      processor.connect(ctx.destination);

      // Count seconds
      timerRef.current = setInterval(() => {
        setMicSeconds(s => s + 1);
      }, 1000);

    } catch(e: unknown) {
      setMode('error');
      setMsg(e instanceof Error ? e.message : 'Microphone access denied');
    }
  }, [loaded]);

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

  // Handle file drop / select
  const handleFile = useCallback(async (file: File) => {
    if (!loaded) { setMsg('Essentia still loading...'); return; }
    setMode('analysing'); setMsg('Decoding audio file...');
    try {
      const arrayBuffer = await file.arrayBuffer();
      const ctx = new AudioContext({ sampleRate: 44100 });
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
      // Mix to mono
      const mono = new Float32Array(audioBuffer.length);
      for (let ch = 0; ch < audioBuffer.numberOfChannels; ch++) {
        const channelData = audioBuffer.getChannelData(ch);
        for (let i = 0; i < channelData.length; i++) mono[i] += channelData[i];
      }
      for (let i = 0; i < mono.length; i++) mono[i] /= audioBuffer.numberOfChannels;
      await ctx.close();
      await analyse(mono, 44100);
    } catch(e: unknown) {
      setMode('error');
      setMsg(e instanceof Error ? e.message : 'Could not decode file');
    }
  }, [loaded, analyse]);

  const reset = () => { stopMic(); setMode('idle'); setMsg(''); setResult(null); setMicSeconds(0); };

  return (
    <div style={{ background: T.surface, border: `1px solid ${T.border}`, borderRadius: 10, padding: '0.75rem', fontSize: '0.75rem' }}>
      {trackName && <div style={{ fontWeight: 600, marginBottom: '0.5rem', color: T.text }}>{trackName}</div>}

      {/* Loading state */}
      {!loaded && (
        <div style={{ color: T.muted, fontSize: '0.7rem' }}>
          <span style={{ display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: T.accent, marginRight: 6, animation: 'pulse 1s infinite' }} />
          Loading Essentia.js audio engine...
        </div>
      )}

      {/* Idle */}
      {loaded && mode === 'idle' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <button onClick={startMic} style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.accent, color: '#fff', fontWeight: 600, cursor: 'pointer', fontSize: '0.72rem' }}>
            🎙 Analyse via Mic
          </button>
          <label style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${T.border}`, background: T.surface, cursor: 'pointer', fontSize: '0.72rem' }}>
            📁 Drop Audio File
            <input type="file" accept="audio/*" style={{ display: 'none' }} onChange={e => e.target.files?.[0] && handleFile(e.target.files[0])} />
          </label>
        </div>
      )}

      {/* Mic recording */}
      {mode === 'mic' && (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center' }}>
          <div style={{ display: 'flex', gap: 3 }}>
            {[0,1,2,3,4].map(i => (
              <div key={i} style={{ width: 3, borderRadius: 2, background: T.accent, height: `${8 + Math.random() * 16}px`, transition: 'height 0.1s' }} />
            ))}
          </div>
          <span style={{ color: T.accent, fontWeight: 600 }}>Recording {micSeconds}s</span>
          <span style={{ color: T.muted, fontSize: '0.65rem' }}>(min 8s recommended)</span>
          <button onClick={stopAndAnalyse} disabled={micSeconds < 4} style={{ padding: '4px 12px', borderRadius: 6, border: `1px solid ${T.border}`, background: micSeconds >= 4 ? T.green : T.surface2, color: micSeconds >= 4 ? '#fff' : T.muted, fontWeight: 600, cursor: micSeconds >= 4 ? 'pointer' : 'default', fontSize: '0.72rem' }}>
            ⬛ Stop & Analyse
          </button>
        </div>
      )}

      {/* Analysing */}
      {mode === 'analysing' && (
        <div style={{ color: T.muted, display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 12, height: 12, border: `2px solid ${T.accent}`, borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          {msg}
        </div>
      )}

      {/* Error */}
      {mode === 'error' && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
          <span style={{ color: T.red }}>⚠ {msg}</span>
          <button onClick={reset} style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${T.border}`, background: T.surface, cursor: 'pointer', fontSize: '0.7rem' }}>Retry</button>
        </div>
      )}

      {/* Done */}
      {mode === 'done' && result && (
        <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
          <span style={{ fontWeight: 700, color: T.green }}>✓</span>
          <span><b style={{ color: T.accent }}>{result.bpm}</b> BPM</span>
          <span><b style={{ color: T.accent }}>{result.key}</b> <span style={{ color: T.muted, fontSize: '0.65rem' }}>({result.keyRaw})</span></span>
          <span style={{ color: T.muted, fontSize: '0.65rem' }}>{result.confidence}% conf</span>
          <button onClick={reset} style={{ padding: '3px 8px', borderRadius: 5, border: `1px solid ${T.border}`, background: T.surface, cursor: 'pointer', fontSize: '0.7rem', color: T.muted }}>Re-analyse</button>
        </div>
      )}

      <style>{`
        @keyframes spin { to { transform: rotate(360deg); } }
        @keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.4; } }
      `}</style>
    </div>
  );
}
