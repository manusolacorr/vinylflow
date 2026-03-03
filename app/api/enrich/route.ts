/**
 * POST /api/enrich
 * Body: { artist: string, title: string }
 * Returns: { bpm: number | null, key: string | null, source: string }
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const CAM_KEYS = ['1A','1B','2A','2B','3A','3B','4A','4B','5A','5B','6A','6B',
                  '7A','7B','8A','8B','9A','9B','10A','10B','11A','11B','12A','12B'];

// Convert standard key names to Camelot
const KEY_TO_CAM: Record<string, string> = {
  'C major':'8B','C minor':'5A','C# major':'3B','C# minor':'12A','Db major':'3B','Db minor':'12A',
  'D major':'10B','D minor':'7A','D# major':'5B','D# minor':'2A','Eb major':'5B','Eb minor':'2A',
  'E major':'12B','E minor':'9A','F major':'7B','F minor':'4A',
  'F# major':'2B','F# minor':'11A','Gb major':'2B','Gb minor':'11A',
  'G major':'9B','G minor':'6A','G# major':'4B','G# minor':'1A','Ab major':'4B','Ab minor':'1A',
  'A major':'11B','A minor':'8A','A# major':'6B','A# minor':'3A','Bb major':'6B','Bb minor':'3A',
  'B major':'1B','B minor':'10A',
};

function normalizeToCamelot(raw: string): string | null {
  if (!raw) return null;
  const upper = raw.trim().toUpperCase();
  if (CAM_KEYS.includes(upper)) return upper;
  // Try direct key map
  const lower = raw.trim().toLowerCase();
  for (const [k, v] of Object.entries(KEY_TO_CAM)) {
    if (lower.includes(k.toLowerCase())) return v;
  }
  // Try pattern: "G Major" "A Minor" etc
  const m = raw.match(/([A-Ga-g][#b♯♭]?)\s*(major|minor|maj|min)/i);
  if (m) {
    const note = m[1].charAt(0).toUpperCase() + (m[1].slice(1).replace('♯','#').replace('♭','b'));
    const qual = m[2].toLowerCase().startsWith('min') ? ' minor' : ' major';
    const key = (note + qual).toLowerCase();
    for (const [k, v] of Object.entries(KEY_TO_CAM)) {
      if (k.toLowerCase() === key) return v;
    }
  }
  return null;
}

function extractJSON(text: string): { bpm: number | null; key: string | null } | null {
  if (!text) return null;
  // Try to find JSON object with bpm field
  const patterns = [
    /```json\s*(\{[^`]*\})\s*```/s,
    /```\s*(\{[^`]*\})\s*```/s,
    /(\{"bpm"[^}]+\})/,
    /(\{[^}]*"bpm"[^}]*\})/,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) {
      try {
        const parsed = JSON.parse(m[1]);
        if ('bpm' in parsed || 'key' in parsed) {
          const bpm = typeof parsed.bpm === 'number' ? Math.round(parsed.bpm) : null;
          const keyRaw = parsed.key ? String(parsed.key) : null;
          const key = keyRaw ? (normalizeToCamelot(keyRaw) || (CAM_KEYS.includes(keyRaw.toUpperCase()) ? keyRaw.toUpperCase() : null)) : null;
          return { bpm, key };
        }
      } catch { continue; }
    }
  }
  // Try extracting BPM and key from plain text as last resort
  const bpmMatch = text.match(/\b(\d{2,3})\s*(?:BPM|bpm|Bpm)/);
  const keyMatch = text.match(/(?:key|Key)[\s:]+([A-Ga-g][#b♯♭]?\s*(?:major|minor|maj|min|Major|Minor))/);
  const camMatch = text.match(/\b(\d{1,2}[AB])\b/);
  const bpm = bpmMatch ? parseInt(bpmMatch[1]) : null;
  const key = keyMatch ? normalizeToCamelot(keyMatch[1]) : (camMatch && CAM_KEYS.includes(camMatch[1]) ? camMatch[1] : null);
  return (bpm || key) ? { bpm, key } : null;
}

async function enrichWithWebSearch(artist: string, title: string): Promise<{ bpm: number | null; key: string | null; source: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1024,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `Find the BPM and musical key of the track "${title}" by ${artist}.

Search multiple sources: Tunebat, Beatport, Juno Download, 1001Tracklists, or any music database.
Be persistent — if one search fails, try different search terms.

After searching, reply ONLY with this JSON (no other text):
{"bpm": 126, "key": "9B"}

Where:
- bpm is the integer BPM
- key is the Camelot wheel notation (e.g. "8A", "9B", "11A")
- If key is given as "G Major" convert it: G Major = 9B, A Minor = 8A, etc.
- Use null if truly not found after searching`
        }]
      }),
      signal: AbortSignal.timeout(30000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    // Collect all text from response (including after tool use)
    const allText = (data?.content || [])
      .filter((b: {type: string}) => b.type === 'text')
      .map((b: {text: string}) => b.text)
      .join('\n');

    const result = extractJSON(allText);
    if (result?.bpm || result?.key) return { ...result, source: 'web_search' };
    return null;
  } catch { return null; }
}

// Fallback: Claude knowledge only
async function enrichFromKnowledge(artist: string, title: string): Promise<{ bpm: number | null; key: string | null; source: string } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 200,
        messages: [{ role: 'user', content: `What is the BPM and Camelot key of "${title}" by ${artist}? Reply ONLY with JSON: {"bpm": 124, "key": "8A"}. Use null if unknown.` }]
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.[0]?.text || '';
    const result = extractJSON(text);
    if (result?.bpm || result?.key) return { ...result, source: 'claude' };
    return null;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  try {
    const { artist, title } = await req.json();
    if (!artist || !title) return NextResponse.json({ error: 'missing params' }, { status: 400 });

    const webResult = await enrichWithWebSearch(artist, title);
    if (webResult?.bpm || webResult?.key) return NextResponse.json(webResult);

    const knowledgeResult = await enrichFromKnowledge(artist, title);
    if (knowledgeResult?.bpm || knowledgeResult?.key) return NextResponse.json(knowledgeResult);

    return NextResponse.json({ bpm: null, key: null, source: 'none' });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
