"use client";

import Link from "next/link";
import { useEnsName } from "wagmi";
import { mainnet } from "wagmi/chains";
import type { LivePool } from "@/lib/hooks";
import { soldPct } from "@/lib/derive";
import { dotAddr, formatUsdc } from "@/lib/format";

/** Discover-feed pool card — matches the design: title, big ticket count, progress bar, footer.
 *  Settled pools get a win/no-win badge in the top-right. */
export function PoolCard({ pool }: { pool: LivePool }) {
  const { data: organizerEns } = useEnsName({ address: pool.organizer, chainId: mainnet.id });
  const building = pool.vis === "building";
  const settled = pool.vis === "settled";
  const won = pool.totalWinnings > 0n;
  const pct = soldPct(pool);
  const almost = pct >= 85; // "almost gone" → accent fill + accent border
  const soldOut = pool.soldOut;

  const fillColor = almost ? "#c6ff3a" : "#8f8a80";
  const soldLabel = soldOut ? "Sold out" : building ? "opens soon" : `${Math.round(pct)}% sold`;
  const soldColor = soldOut ? "#c6ff3a" : "#9b958a";
  const border = almost ? "rgba(198,255,58,0.35)" : "rgba(255,255,255,0.07)";

  // Shared badge treatment; only the colors differ per state (Live / Won / No win).
  const badgeBase = "shrink-0 rounded-[6px] px-2 py-1 font-mono text-[10px] font-bold uppercase tracking-[0.5px]";

  return (
    <Link
      href={`/pool/${pool.organizer}/${pool.drawingId}`}
      className="relative block overflow-hidden rounded-card bg-surface p-[17px]"
      style={{ border: `1px solid ${border}` }}
    >
      <div className="mb-4 flex items-start justify-between gap-2">
        <div className="truncate text-[17px] font-bold tracking-[-0.3px] text-txt">
          {pool.name?.trim() || "Unnamed pool"}
        </div>
        {settled ? (
          won ? (
            <span className={badgeBase} style={{ color: "#ffd23f", background: "rgba(255,210,63,0.14)" }}>
              Won {formatUsdc(pool.totalWinnings)}
            </span>
          ) : (
            <span className={badgeBase} style={{ color: "#9b958a", background: "rgba(255,255,255,0.06)" }}>
              No win
            </span>
          )
        ) : pool.vis === "live" ? (
          <span className={badgeBase} style={{ color: "#c6ff3a", background: "rgba(198,255,58,0.14)" }}>
            Live
          </span>
        ) : null}
      </div>

      <div className="mb-[14px] flex items-baseline gap-[5px]">
        <span className="font-mono text-[30px] font-bold leading-none tracking-[-1px] text-txt">
          {pool.ticketCount.toString()}
        </span>
        <span className="font-mono text-[11px] text-txt-muted">tickets</span>
      </div>

      <div className="mb-[9px] h-[7px] overflow-hidden rounded-[4px] bg-bg">
        <div className="mp-fill h-full rounded-[4px]" style={{ width: `${building ? 0 : pct}%`, background: fillColor }} />
      </div>

      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[10px] font-semibold" style={{ color: soldColor }}>
          {soldLabel}
        </span>
        <span className="truncate font-mono text-[10px] text-txt-muted">by {organizerEns ?? dotAddr(pool.organizer)}</span>
      </div>
    </Link>
  );
}
