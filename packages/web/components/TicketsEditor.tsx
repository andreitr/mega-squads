"use client";

import { type Ticket, randomTicket, pad2 } from "@/lib/tickets";

export function TicketsEditor({
  tickets,
  setTickets,
  ballMax,
  bonusballMax,
}: {
  tickets: Ticket[];
  setTickets: (t: Ticket[]) => void;
  ballMax: number;
  bonusballMax: number;
}) {
  const total = tickets.length;

  const add = () => setTickets([...tickets, randomTicket(ballMax, bonusballMax)]);
  const reroll = (i: number) =>
    setTickets(tickets.map((t, j) => (j === i ? randomTicket(ballMax, bonusballMax) : t)));
  const remove = (i: number) => {
    if (tickets.length <= 1) return; // min 1
    setTickets(tickets.filter((_, j) => j !== i));
  };

  return (
    <div className="rounded-card border border-white/[0.06] bg-surface p-[17px]">
      <div className="mb-3 flex items-baseline justify-between">
        <span className="text-[14px] font-semibold text-txt">Tickets</span>
        <span className="font-mono text-[12px] text-txt-faint">
          {total} × $1.00 · ${total}.00
        </span>
      </div>

      <div className="divide-y divide-white/[0.06]">
        {tickets.map((t, i) => (
          <div key={i} className="flex items-center gap-3 py-3">
            <span className="w-7 shrink-0 font-mono text-[12px] text-txt-faint">#{pad2(i + 1)}</span>
            <div className="flex flex-1 flex-wrap items-center gap-[6px]">
              {t.normals.map((n, k) => (
                <Ball key={k}>{pad2(n)}</Ball>
              ))}
              <Ball bonus>{pad2(t.bonusball)}</Ball>
            </div>
            <div className="flex shrink-0 items-center gap-1">
              <IconBtn title="Re-roll numbers" onClick={() => reroll(i)}>
                {/* pencil */}
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z" />
                </svg>
              </IconBtn>
              {total > 1 && (
                <IconBtn title="Delete ticket" danger onClick={() => remove(i)}>
                  {/* trash */}
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6" />
                  </svg>
                </IconBtn>
              )}
            </div>
          </div>
        ))}
      </div>

      <button
        onClick={add}
        className="mt-3 flex w-full items-center justify-center gap-2 rounded-box border-[1.5px] border-dashed border-accent/40 py-3 text-[13px] font-semibold text-accent hover:bg-accent/[0.07]"
      >
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add ticket
      </button>
    </div>
  );
}

function Ball({ children, bonus }: { children: React.ReactNode; bonus?: boolean }) {
  return (
    <span
      className={`flex h-[30px] w-[30px] items-center justify-center rounded-full font-mono text-[12px] ${
        bonus
          ? "bg-accent text-bg shadow-ball"
          : "border-[1.5px] border-white/[0.26] text-txt"
      }`}
    >
      {children}
    </span>
  );
}

function IconBtn({
  children,
  onClick,
  title,
  danger,
}: {
  children: React.ReactNode;
  onClick: () => void;
  title: string;
  danger?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-8 w-8 items-center justify-center rounded-chip text-txt-faint ${
        danger ? "hover:bg-danger/10 hover:text-danger" : "hover:text-accent"
      }`}
    >
      {children}
    </button>
  );
}
