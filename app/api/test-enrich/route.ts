import { NextRequest, NextResponse } from 'next/server';
export const dynamic = 'force-dynamic';

const TRACKS = [
  { artist: 'Atmosfear', title: 'Dancing In Outer Space' },
  { artist: 'Harvey Mason', title: 'How Does It Feel' },
  { artist: 'William DeVaughn', title: "Be Thankful For What You've Got" },
  { artist: 'Ezy & Isaac', title: 'Let Your Body Move (Oba Balu Balu)' },
];

export async function GET(req: NextRequest) {
  const results = [];
  for (const t of TRACKS) {
    const res = await fetch(`${new URL(req.url).origin}/api/enrich`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(t),
    });
    const data = await res.json();
    results.push({ ...t, ...data });
    await new Promise(r => setTimeout(r, 500));
  }
  return NextResponse.json(results);
}
