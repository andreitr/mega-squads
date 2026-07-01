import Link from "next/link";
import type { LivePool } from "@/lib/hooks";
import { soldPct } from "@/lib/derive";
import { dotAddr } from "@/lib/format";

/** Discover-feed pool card — matches the design: title, big ticket count, progress bar, footer. */
export function PoolCard({ pool }: { pool: LivePool }) {
  const building = pool.vis === "building";
  const pct = soldPct(pool);
  const almost = pct >= 85; // "almost gone" → accent fill + accent border
  const soldOut = pool.soldOut;

  const fillColor = almost ? "#c6ff3a" : "#8f8a80";
  const soldLabel = soldOut ? "Sold out" : building ? "opens soon" : `${Math.round(pct)}% sold`;
  const soldColor = soldOut ? "#c6ff3a" : "#9b958a";
  const border = almost ? "rgba(198,255,58,0.35)" : "rgba(255,255,255,0.07)";

  return (
    <Link
      href={`/pool/${pool.organizer}/${pool.drawingId}`}
      className="relative block overflow-hidden rounded-card bg-surface p-[17px]"
      style={{ border: `1px solid ${border}` }}
    >
      <div className="mb-4 truncate text-[17px] font-bold tracking-[-0.3px] text-txt">
        {pool.name?.trim() || "Unnamed pool"}
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
        <span className="truncate font-mono text-[10px] text-txt-muted">by {dotAddr(pool.organizer)}</span>
      </div>
    </Link>
  );
}
