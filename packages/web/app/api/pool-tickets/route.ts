import { NextResponse } from "next/server";
import { SQUADS_ADDRESS } from "@/lib/addresses";

// Resolves a pool's ticket numbers (which aren't exposed by any on-chain read) via the Megapot
// Data API. The client passes the on-chain ticket IDs (from getTicketIds); this route looks up the
// chosen normals/bonusball for each, keeping MEGAPOT_API_KEY server-side.
//
// The pool's Megapot tickets are owned by the Squads contract, so we scan that wallet's tickets for
// the round and match by user_ticket_id, short-circuiting once every requested ID is found.

const API_BASE = "https://api.megapot.io/v1";
const MAX_PAGES = 30; // 30 × 100 = up to 3000 tickets scanned

type TicketNumbers = { normals: number[]; bonusball: number; txHash?: string };

export async function POST(req: Request) {
  let body: { drawingId?: string | number; ids?: string[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const drawingId = body.drawingId !== undefined ? String(body.drawingId) : undefined;
  const ids = Array.isArray(body.ids) ? body.ids.map(String) : [];
  if (!drawingId || ids.length === 0) {
    return NextResponse.json({ tickets: {} });
  }

  const want = new Set(ids);
  const found: Record<string, TicketNumbers> = {};
  const key = process.env.MEGAPOT_API_KEY;
  const headers: HeadersInit = key ? { Authorization: `Bearer ${key}` } : {};

  try {
    let cursor: string | null | undefined;
    let pages = 0;
    do {
      const url = new URL(`${API_BASE}/wallets/${SQUADS_ADDRESS}/tickets/rounds/${drawingId}`);
      url.searchParams.set("limit", "100");
      if (cursor) url.searchParams.set("cursor", cursor);

      const res = await fetch(url, { headers, next: { revalidate: 30 } });
      if (!res.ok) {
        return NextResponse.json({ error: `Data API ${res.status}`, tickets: found }, { status: 502 });
      }
      const json = (await res.json()) as {
        data: Array<{ user_ticket_id: string; normals: number[]; bonusball: number; tx_hash?: string }>;
        next_cursor: string | null;
        has_more: boolean;
      };

      for (const t of json.data ?? []) {
        if (want.has(t.user_ticket_id) && !found[t.user_ticket_id]) {
          found[t.user_ticket_id] = { normals: t.normals, bonusball: t.bonusball, txHash: t.tx_hash };
        }
      }
      cursor = json.next_cursor;
      pages += 1;
    } while (cursor && Object.keys(found).length < want.size && pages < MAX_PAGES);

    return NextResponse.json({ tickets: found });
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message ?? "fetch failed", tickets: found }, { status: 502 });
  }
}
