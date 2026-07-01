"use client";

import Link from "next/link";
import { TopBar } from "@/components/TopBar";
import { useCurrentRoundPools } from "@/lib/hooks";
import { soldPct } from "@/lib/derive";
import { dotAddr } from "@/lib/format";

const AVATAR_COLORS = ["#ff7a3c", "#5ad1ff", "#b388ff", "#ffd23f", "#ff5247", "#c6ff3a"];

// "Organizer board" — ranks this round's pools by sell-through, derived purely from on-chain reads.
export default function LeaderboardPage() {
  const { pools, isLoading } = useCurrentRoundPools();
  const ranked = [...pools].sort((a, b) => soldPct(b) - soldPct(a));

  return (
    <main className="relative">
      <TopBar />
      <div className="mx-auto w-full max-w-[780px] px-4 py-[30px] sm:px-7">
        <div className="text-[26px] font-bold tracking-[-0.5px] text-txt">Organizer board</div>
        <div className="mb-[22px] text-[14px] text-txt-muted">The hosts filling the most pots. Climb the ranks.</div>

        {isLoading && ranked.length === 0 ? (
          <div className="flex flex-col gap-[10px]">
            {[0, 1, 2].map((i) => (
              <div key={i} className="h-[72px] animate-pulse rounded-[15px] border border-white/[0.06] bg-surface" />
            ))}
          </div>
        ) : ranked.length === 0 ? (
          <div className="rounded-card border border-white/[0.06] bg-surface p-8 text-center font-mono text-[12px] text-txt-faint">
            No pools this round yet.
          </div>
        ) : (
          <div className="flex flex-col gap-[10px]">
            {ranked.map((p, i) => {
              const pct = soldPct(p);
              const init = p.organizer.slice(2, 4).toUpperCase();
              const color = AVATAR_COLORS[parseInt(p.organizer.slice(2, 4), 16) % AVATAR_COLORS.length];
              const top = i === 0;
              return (
                <Link
                  key={`${p.organizer}-${p.drawingId}`}
                  href={`/pool/${p.organizer}/${p.drawingId}`}
                  className="flex items-center gap-[14px] rounded-[15px] px-4 py-[15px]"
                  style={{
                    background: top ? "linear-gradient(110deg,rgba(198,255,58,0.12),#161412)" : "#161412",
                    border: `1px solid ${top ? "rgba(198,255,58,0.35)" : "rgba(255,255,255,0.07)"}`,
                  }}
                >
                  <span
                    className="w-[26px] shrink-0 text-center font-mono text-[17px] font-bold"
                    style={{ color: i < 3 ? "#c6ff3a" : "#645e54" }}
                  >
                    {i + 1}
                  </span>
                  <span
                    className="flex h-[42px] w-[42px] shrink-0 items-center justify-center rounded-full font-mono text-[13px] font-bold text-bg"
                    style={{ background: color }}
                  >
                    {init}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[15px] font-semibold text-txt">{p.name?.trim() || "Unnamed pool"}</div>
                    <div className="font-mono text-[11px] text-txt-muted">
                      by {dotAddr(p.organizer)} · {p.ticketCount.toString()} tickets
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="font-mono text-[17px] font-bold text-accent">{Math.round(pct)}%</div>
                    <div className="font-mono text-[9px] uppercase tracking-[0.5px] text-txt-faint">sold</div>
                  </div>
                </Link>
              );
            })}
          </div>
        )}

        <Link
          href="/create"
          className="mt-[22px] block rounded-[16px] bg-accent py-[18px] text-center"
        >
          <div className="text-[16px] font-bold text-bg">Get on the board</div>
          <div className="text-[12px] font-medium text-[rgba(10,9,8,0.7)]">Host your first pool today</div>
        </Link>
      </div>
    </main>
  );
}
