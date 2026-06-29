// A Megapot explicit pick: 5 unique ascending normals (1..ballMax) + a bonusball (1..bonusballMax).
export type Ticket = { normals: number[]; bonusball: number };

// Design defaults; the live ranges come from getDrawingState (ballMax/bonusballMax).
export const DEFAULT_BALL_MAX = 37;
export const DEFAULT_BONUSBALL_MAX = 26;

function randInt(max: number): number {
  return Math.floor(Math.random() * max) + 1; // 1..max
}

/** A fresh random pick: 5 unique normals (sorted ascending) + a bonusball. */
export function randomTicket(ballMax = DEFAULT_BALL_MAX, bonusballMax = DEFAULT_BONUSBALL_MAX): Ticket {
  const set = new Set<number>();
  while (set.size < 5) set.add(randInt(ballMax));
  const normals = [...set].sort((a, b) => a - b);
  return { normals, bonusball: randInt(bonusballMax) };
}

export function pad2(n: number): string {
  return n.toString().padStart(2, "0");
}

/** Encode tickets for the contract: bonusball/normals as the on-chain uint8 tuple shape. */
export function toContractTickets(tickets: Ticket[]): { normals: number[]; bonusball: number }[] {
  return tickets.map((t) => ({ normals: t.normals, bonusball: t.bonusball }));
}
