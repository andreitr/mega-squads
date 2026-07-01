"use client";

import { useState } from "react";
import Link from "next/link";
import { useCurrentRoundPools, useJackpotPrize, useNow } from "@/lib/hooks";
import { soldPct } from "@/lib/derive";
import { jackpotUsd, hms } from "@/lib/format";
import { PoolCard } from "./PoolCard";

type Tab = "selling" | "soldout";

export function Discover() {
  const { pools, drawingTime, isLoading } = useCurrentRoundPools();
  const jackpotPrize = useJackpotPrize();
  const [tab, setTab] = useState<Tab>("selling");
  const now = useNow();

  const filtered = pools
    .filter((p) => (tab === "selling" ? p.vis === "live" && !p.soldOut : p.soldOut))
    .sort((a, b) => soldPct(b) - soldPct(a));

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 py-[30px] sm:px-7">
      {/* Hero + promo */}
      <div className="mb-[30px] grid grid-cols-1 gap-[18px] md:grid-cols-[1.7fr_1fr]">
        <div className="relative overflow-hidden rounded-[22px] border border-accent/[0.28] bg-[linear-gradient(160deg,#1f1d17,#131110)] p-8 sm:p-[38px]">
          <div className="pointer-events-none absolute -right-[50px] -top-[50px] h-[240px] w-[240px] rounded-full bg-[radial-gradient(circle,rgba(198,255,58,0.16),transparent_70%)]" />
          <span className="mb-[14px] block font-mono text-[11px] uppercase tracking-[1.6px] text-accent">
            Today&apos;s jackpot
          </span>
          <div className="mb-5 font-mono text-[56px] font-bold leading-[0.9] tracking-[-3px] text-txt sm:text-[86px] sm:tracking-[-4px]">
            {jackpotUsd(jackpotPrize)}
          </div>
          <div className="flex items-baseline gap-[10px]">
            <span className="font-mono text-[12px] uppercase tracking-[1px] text-txt-muted">Drawing in</span>
            <span className="font-mono text-[18px] tracking-[1px] text-accent">{hms(drawingTime, now)}</span>
          </div>
        </div>

        <Link
          href="/create"
          className="flex flex-col justify-between rounded-[22px] bg-accent p-[30px] text-bg"
        >
          <div>
            <div className="mb-[14px] text-[23px] font-bold tracking-[-0.4px]">Host your own pool</div>
            <div className="text-[14px] font-medium leading-[1.5] text-[rgba(10,9,8,0.72)]">
              Buy the tickets, reserve your stake, and get repaid as friends buy in. Keep the 10% referral fee if it
              doesn&apos;t sell out, plus 10% of any win on top of your share.
            </div>
          </div>
        </Link>
      </div>

      {/* Tabs */}
      <div className="mb-[18px] flex items-center justify-between">
        <span className="text-[19px] font-bold tracking-[-0.3px] text-txt">Live pools</span>
        <div className="flex gap-2">
          {(["selling", "soldout"] as Tab[]).map((t) => {
            const active = tab === t;
            return (
              <button
                key={t}
                onClick={() => setTab(t)}
                className="rounded-pill border px-4 py-2 text-[13px] font-semibold"
                style={{
                  background: active ? "#2a2622" : "#161412",
                  color: active ? "#f4f1ea" : "#9b958a",
                  borderColor: active ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)",
                }}
              >
                {t === "selling" ? "Live" : "Sold out"}
              </button>
            );
          })}
        </div>
      </div>

      {/* Grid */}
      {isLoading && pools.length === 0 ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[150px] animate-pulse rounded-card border border-white/[0.06] bg-surface" />
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="rounded-card border border-white/[0.06] bg-surface p-8 text-center font-mono text-[12px] text-txt-faint">
          {tab === "selling" ? "No live pools this round yet. " : "No sold-out pools yet. "}
          <Link href="/create" className="text-accent hover:underline">
            Host one →
          </Link>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
          {filtered.map((p) => (
            <PoolCard key={`${p.organizer}-${p.drawingId}`} pool={p} />
          ))}
        </div>
      )}
    </div>
  );
}
