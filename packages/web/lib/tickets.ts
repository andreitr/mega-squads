// A Megapot explicit pick: 5 unique ascending normals (1..ballMax) + a bonusball (1..bonusballMax).
export type Ticket = { normals: number[]; bonusball: number };

// Design defaults; the live ranges come from getDrawingState (ballMax/bonusballMax).
export const DEFAULT_BALL_MAX = 37;
export const DEFAULT_BONUSBALL_MAX = 26;

// Fixed count of normal numbers per ticket. The contract exposes ball ranges, not a count.
export const NORMALS_COUNT = 5;

function randInt(max: number): number {
  return Math.floor(Math.random() * max) + 1; // 1..max
}

/** A fresh random pick: NORMALS_COUNT unique normals (sorted ascending) + a bonusball. */
export function randomTicket(ballMax = DEFAULT_BALL_MAX, bonusballMax = DEFAULT_BONUSBALL_MAX): Ticket {
  const set = new Set<number>();
  while (set.size < NORMALS_COUNT) set.add(randInt(ballMax));
  const normals = [...set].sort((a, b) => a - b);
  return { normals, bonusball: randInt(bonusballMax) };
}

/** True when a ticket is a complete, in-range pick: NORMALS_COUNT unique normals + one bonusball. */
export function isCompleteTicket(t: Ticket, ballMax: number, bonusballMax: number): boolean {
  const unique = new Set(t.normals);
  return (
    unique.size === NORMALS_COUNT &&
    [...unique].every((n) => Number.isInteger(n) && n >= 1 && n <= ballMax) &&
    Number.isInteger(t.bonusball) &&
    t.bonusball >= 1 &&
    t.bonusball <= bonusballMax
  );
}

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Encode tickets for the contract: bonusball/normals as the on-chain uint8 tuple shape. */
export function toContractTickets(tickets: Ticket[]): { normals: number[]; bonusball: number }[] {
  return tickets.map((t) => ({ normals: t.normals, bonusball: t.bonusball }));
}
