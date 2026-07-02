import { NextResponse } from "next/server";

// Round-level info from the Megapot Data API (keeps MEGAPOT_API_KEY server-side). Used on the pool
// detail page to show a settled drawing's winning numbers.
const API_BASE = "https://api.megapot.io/v1";

export async function GET(req: Request) {
  const drawingId = new URL(req.url).searchParams.get("drawingId");
  if (!drawingId) return NextResponse.json({ error: "drawingId required" }, { status: 400 });

  const key = process.env.MEGAPOT_API_KEY;
  const headers: HeadersInit = key ? { Authorization: `Bearer ${key}` } : {};
  try {
    const res = await fetch(`${API_BASE}/rounds/${drawingId}`, { headers, next: { revalidate: 60 } });
    if (!res.ok) return NextResponse.json({ error: `Data API ${res.status}` }, { status: 502 });
    const r = (await res.json()) as {
      status?: string;
      settled_at?: string | null;
      winning_numbers?: { normals: number[]; bonusball: number } | null;
    };
    return NextResponse.json({
      status: r.status ?? null,
      settledAt: r.settled_at ?? null,
      winningNumbers: r.winning_numbers ? { normals: r.winning_numbers.normals, bonusball: r.winning_numbers.bonusball } : null,
    });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message ?? "fetch failed" }, { status: 502 });
  }
}
