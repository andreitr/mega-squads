import type { Address } from "viem";

// getPool() returns an 11-field tuple (see lib/abis.ts). Parse by index into a typed object.
export type PoolRaw = readonly [
  number, // 0 state enum: 0 None, 1 Building, 2 Live, 3 Settled
  boolean, // 1 soldOut
  bigint, // 2 totalShares
  bigint, // 3 sharesForSale
  bigint, // 4 sharesSold
  bigint, // 5 reserveShares
  bigint, // 6 ticketCount
  bigint, // 7 pricePerShare
  bigint, // 8 ticketFunding
  bigint, // 9 totalWinnings
  bigint, // 10 feesCollected
];

export type Pool = {
  organizer: Address;
  drawingId: bigint;
  name?: string;
  reserveBps?: number;
  state: number;
  soldOut: boolean;
  totalShares: bigint;
  sharesForSale: bigint;
  sharesSold: bigint;
  reserveShares: bigint;
  ticketCount: bigint;
  pricePerShare: bigint;
  ticketFunding: bigint;
  totalWinnings: bigint;
  feesCollected: bigint;
};

export function parsePool(organizer: Address, drawingId: bigint, raw: PoolRaw): Pool {
  return {
    organizer,
    drawingId,
    state: raw[0],
    soldOut: raw[1],
    totalShares: raw[2],
    sharesForSale: raw[3],
    sharesSold: raw[4],
    reserveShares: raw[5],
    ticketCount: raw[6],
    pricePerShare: raw[7],
    ticketFunding: raw[8],
    totalWinnings: raw[9],
    feesCollected: raw[10],
  };
}

export type VisualState = "building" | "live" | "locked" | "settled";

export const STATE_META: Record<VisualState, { label: string; color: string; tint: string }> = {
  building: { label: "Building", color: "#5ad1ff", tint: "rgba(90,209,255,0.14)" },
  live: { label: "Live", color: "#c6ff3a", tint: "rgba(198,255,58,0.14)" },
  locked: { label: "Locked", color: "#ff7a3c", tint: "rgba(255,122,60,0.14)" },
  settled: { label: "Settled", color: "#ffd23f", tint: "rgba(255,210,63,0.14)" },
};

/**
 * Map the 3 contract states + the live Megapot drawing onto the 4 design states.
 * A `Live` pool whose drawing has closed (time reached or already drawn) but isn't `Settled`
 * shows as "Locked" — sales ended, awaiting claimAndDistribute.
 */
export function visualState(p: Pool, drawing?: { drawingTime?: bigint; winningTicket?: bigint }, nowSec?: number): VisualState {
  if (p.state === 3) return "settled";
  if (p.state === 1) return "building";
  // Live (state 2):
  const closed =
    (drawing?.winningTicket !== undefined && drawing.winningTicket !== 0n) ||
    (drawing?.drawingTime !== undefined && nowSec !== undefined && nowSec >= Number(drawing.drawingTime));
  return closed ? "locked" : "live";
}

/** Sell-through percentage 0..100. While Building (forSale not yet set) returns 0. */
export function soldPct(p: Pool): number {
  if (p.sharesForSale === 0n) return 0;
  const v = Number((p.sharesSold * 10000n) / p.sharesForSale) / 100;
  return Math.max(0, Math.min(100, v));
}
