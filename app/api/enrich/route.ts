/**
 * POST /api/enrich
 * Body: { artist: string, title: string }
 * Returns: { bpm: number | null, key: string | null, source: string }
 *
 * Uses Claude with web search to find real BPM/key from Tunebat, Beatport etc.
 */
import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const CAM_KEYS = ['1A','1B','2A','2B','3A','3B','4A','4B','5A','5B','6A','6B',
                  '7A','7B','8A','8B','9A','9B','10A','10B','11A','11B','12A','12B'];

async function tryClaudeWebSearch(artist: string, title: string): Promise<{ bpm: number | null; key: string | null } | null> {
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
        max_tokens: 200,
        tools: [{ type: 'web_search_20250305', name: 'web_search' }],
        messages: [{
          role: 'user',
          content: `Search for the BPM and musical key of "${title}" by ${artist}. Look on Tunebat, Beatport, or similar DJ databases. Reply ONLY with JSON: {"bpm": 124, "key": "8A"} where key is in Camelot notation. No explanation.`
        }]
      }),
      signal: AbortSignal.timeout(20000),
    });

    if (!res.ok) return null;
    const data = await res.json();

    // Extract text from all content blocks (may include tool_use and tool_result blocks)
    const textBlocks = (data?.content || []).filter((b: {type: string}) => b.type === 'text');
    const text = textBlocks.map((b: {text: string}) => b.text).join('');

    const match = text.match(/\{[^{}]*"bpm"[^{}]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);

    const bpm = parsed.bpm && typeof parsed.bpm === 'number' ? Math.round(parsed.bpm) : null;
    const keyRaw = parsed.key ? String(parsed.key).toUpperCase().trim() : null;
    const key = keyRaw && CAM_KEYS.includes(keyRaw) ? keyRaw : null;

    if (!bpm && !key) return null;
    return { bpm, key };
  } catch { return null; }
}

// Fallback: Claude without web search (training data only)
async function tryClaudeKnowledge(artist: string, title: string): Promise<{ bpm: number | null; key: string | null } | null> {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 100,
        messages: [{ role: 'user', content: `BPM and Camelot key of "${title}" by ${artist}? Best estimate. JSON only: {"bpm": 124, "key": "8A"}` }]
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const text = data?.content?.[0]?.text || '';
    const match = text.match(/\{[\s\S]*\}/);
    if (!match) return null;
    const parsed = JSON.parse(match[0]);
    const bpm = parsed.bpm && typeof parsed.bpm === 'number' ? Math.round(parsed.bpm) : null;
    const key = parsed.key && CAM_KEYS.includes(String(parsed.key).toUpperCase()) ? String(parsed.key).toUpperCase() : null;
    return (bpm || key) ? { bpm, key } : null;
  } catch { return null; }
}

export async function POST(req: NextRequest) {
  try {
    const { artist, title } = await req.json();
    if (!artist || !title) return NextResponse.json({ error: 'missing params' }, { status: 400 });

    // Try web search first — finds real data from Tunebat/Beatport
    const webResult = await tryClaudeWebSearch(artist, title);
    if (webResult?.bpm || webResult?.key) {
      return NextResponse.json({ ...webResult, source: 'web_search' });
    }

    // Fallback to training data
    const knowledgeResult = await tryClaudeKnowledge(artist, title);
    if (knowledgeResult?.bpm || knowledgeResult?.key) {
      return NextResponse.json({ ...knowledgeResult, source: 'claude' });
    }

    return NextResponse.json({ bpm: null, key: null, source: 'none' });
  } catch (err: unknown) {
    return NextResponse.json({ error: err instanceof Error ? err.message : 'Unknown' }, { status: 500 });
  }
}
