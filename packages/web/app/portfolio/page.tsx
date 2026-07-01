"use client";

import Link from "next/link";
import { useState } from "react";
import { ConnectKitButton } from "connectkit";
import { toast } from "sonner";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { useQueryClient } from "@tanstack/react-query";
import { TopBar } from "@/components/TopBar";
import { squadsAbi } from "@/lib/abis";
import { SQUADS_ADDRESS } from "@/lib/addresses";
import { usePortfolio, type LivePool, type PortfolioPosition } from "@/lib/hooks";
import { soldPct, STATE_META, type VisualState } from "@/lib/derive";
import { formatUsdc, jackpotUsd } from "@/lib/format";

const AVATAR_COLORS = ["#ff7a3c", "#5ad1ff", "#b388ff", "#ffd23f", "#ff5247", "#c6ff3a"];

function avatar(addr: string) {
  const init = addr.slice(2, 4).toUpperCase();
  const idx = parseInt(addr.slice(2, 4), 16) % AVATAR_COLORS.length;
  return { init, color: AVATAR_COLORS[idx] };
}

export default function PortfolioPage() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const { joined, organized, claimable, isLoading } = usePortfolio(address);
  const [busy, setBusy] = useState(false);

  const joinedActive = joined.filter((j) => j.vis === "live" || j.vis === "locked").length;
  const claimablePositions = joined.filter((j) => j.claimable > 0n);

  async function claimAll() {
    if (!address || !publicClient || claimablePositions.length === 0) return;
    setBusy(true);
    const toastId = "claim-all";
    try {
      for (const pos of claimablePositions) {
        toast.loading(`Claiming ${formatUsdc(pos.claimable)}…`, { id: toastId });
        const h = await writeContractAsync({
          address: SQUADS_ADDRESS,
          abi: squadsAbi,
          functionName: "withdraw",
          args: [pos.organizer, pos.drawingId],
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
      }
      toast.success("Claimed all winnings", { id: toastId });
      queryClient.invalidateQueries();
    } catch (e) {
      const msg = (e as Error)?.message?.split("\n")[0] ?? "Transaction failed";
      toast.error(/reject|denied|user/i.test(msg) ? "Wallet rejected" : msg.slice(0, 140), { id: toastId });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative">
      <TopBar />
      <div className="mx-auto w-full max-w-[1200px] px-4 py-[30px] sm:px-7">
        {!address ? (
          <ConnectPrompt />
        ) : (
          <>
            {/* Claimable banner */}
            <div className="mb-[26px] animate-pulseGlow rounded-[20px] bg-[linear-gradient(110deg,#c6ff3a,#a8e02e)] px-[26px] py-6">
              <div className="mb-[6px] font-mono text-[11px] uppercase tracking-[1px] text-[rgba(10,9,8,0.65)]">Claimable now</div>
              <div className="flex items-end justify-between gap-4">
                <span className="font-mono text-[40px] font-bold leading-none tracking-[-2px] text-bg sm:text-[48px]">
                  {formatUsdc(claimable)}
                </span>
                <button
                  disabled={busy || claimable <= 0n}
                  onClick={claimAll}
                  className="rounded-box bg-bg px-[22px] py-3 text-[14px] font-bold text-accent disabled:opacity-50"
                >
                  {busy ? "Claiming…" : "Claim all"}
                </button>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-[26px] md:grid-cols-2">
              {/* Joined */}
              <div>
                <div className="mb-[13px] flex items-center justify-between">
                  <span className="text-[15px] font-semibold text-txt">Pools I&apos;ve joined</span>
                  <span className="font-mono text-[11px] text-txt-faint">{joinedActive} active</span>
                </div>
                <div className="flex flex-col gap-[11px]">
                  {isLoading && joined.length === 0 ? (
                    <Skeleton />
                  ) : joined.length === 0 ? (
                    <Empty>You haven&apos;t joined any pools yet.</Empty>
                  ) : (
                    joined.map((j) => <JoinedCard key={`${j.organizer}-${j.drawingId}`} pool={j} />)
                  )}
                </div>
              </div>

              {/* Organized */}
              <div>
                <div className="mb-[13px] flex items-center justify-between">
                  <span className="text-[15px] font-semibold text-txt">My Pools</span>
                </div>
                <div className="flex flex-col gap-[11px]">
                  {isLoading && organized.length === 0 ? (
                    <Skeleton />
                  ) : organized.length === 0 ? (
                    <Empty>
                      You haven&apos;t hosted a pool yet.{" "}
                      <Link href="/create" className="text-accent hover:underline">
                        Create one →
                      </Link>
                    </Empty>
                  ) : (
                    organized.map((o) => <OrganizedCard key={`${o.organizer}-${o.drawingId}`} pool={o} />)
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </main>
  );
}

function stateBadge(vis: VisualState) {
  return { label: STATE_META[vis].label, color: STATE_META[vis].color, bg: STATE_META[vis].tint };
}

function JoinedCard({ pool }: { pool: PortfolioPosition }) {
  const av = avatar(pool.organizer);
  const badge = stateBadge(pool.vis);
  const pctOfPool = pool.totalShares > 0n ? (Number(pool.shares) / Number(pool.totalShares)) * 100 : 0;
  const hasClaim = pool.claimable > 0n;
  return (
    <Link
      href={`/pool/${pool.organizer}/${pool.drawingId}`}
      className="block rounded-[16px] border border-white/[0.07] bg-surface p-4"
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-[9px]">
          <span
            className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-full font-mono text-[9px] font-bold text-bg"
            style={{ background: av.color }}
          >
            {av.init}
          </span>
          <span className="truncate text-[14px] font-semibold text-txt">{pool.name?.trim() || "Unnamed pool"}</span>
        </div>
        <Badge label={badge.label} color={badge.color} bg={badge.bg} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[12px] text-txt-muted">
          {pool.shares.toString()} shares · {pctOfPool.toFixed(1)}%
        </span>
        <span className="font-mono text-[13px] font-bold" style={{ color: hasClaim ? "#c6ff3a" : "#f4f1ea" }}>
          {hasClaim ? `${formatUsdc(pool.claimable)} claimable` : `${pool.shares.toString()} sh`}
        </span>
      </div>
    </Link>
  );
}

function OrganizedCard({ pool }: { pool: LivePool }) {
  const badge = stateBadge(pool.vis);
  const pct = soldPct(pool);
  const fillColor = pool.soldOut ? "#c6ff3a" : "#8f8a80";
  const out =
    pool.vis === "live"
      ? `${jackpotUsd(pool.totalWinnings || 0n)} pot`
      : pool.totalWinnings > 0n
        ? `+${formatUsdc(pool.totalWinnings)}`
        : "No win";
  const outColor = pool.totalWinnings > 0n ? "#c6ff3a" : "#9b958a";
  return (
    <Link
      href={`/pool/${pool.organizer}/${pool.drawingId}`}
      className="block rounded-[16px] bg-surface p-4"
      style={{ border: `1px solid ${pool.totalWinnings > 0n ? "rgba(198,255,58,0.3)" : "rgba(255,255,255,0.07)"}` }}
    >
      <div className="mb-[11px] flex items-center justify-between gap-2">
        <span className="truncate text-[14px] font-semibold text-txt">{pool.name?.trim() || "Unnamed pool"}</span>
        <Badge label={badge.label} color={badge.color} bg={badge.bg} />
      </div>
      <div className="mb-[10px] h-[6px] overflow-hidden rounded-[3px] bg-bg">
        <div className="h-full rounded-[3px]" style={{ width: `${pct}%`, background: fillColor }} />
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-[11px] text-txt-muted">
          {pool.soldOut ? "Sold out · " : ""}
          {pool.sharesSold.toString()}/{pool.sharesForSale.toString()} shares
        </span>
        <span className="font-mono text-[13px] font-bold" style={{ color: outColor }}>
          {out}
        </span>
      </div>
    </Link>
  );
}

function Badge({ label, color, bg }: { label: string; color: string; bg: string }) {
  return (
    <span
      className="shrink-0 rounded-[6px] px-[9px] py-1 font-mono text-[9px] font-bold uppercase tracking-[0.5px]"
      style={{ color, background: bg }}
    >
      {label}
    </span>
  );
}

function Skeleton() {
  return (
    <>
      <div className="h-[88px] animate-pulse rounded-[16px] border border-white/[0.06] bg-surface" />
      <div className="h-[88px] animate-pulse rounded-[16px] border border-white/[0.06] bg-surface" />
    </>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-[16px] border border-white/[0.06] bg-surface p-6 text-center font-mono text-[12px] text-txt-faint">
      {children}
    </div>
  );
}

function ConnectPrompt() {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-card border border-white/[0.07] bg-surface p-8 text-center">
      <div className="text-[18px] font-bold text-txt">Connect your wallet</div>
      <div className="mt-2 text-[13px] text-txt-muted">See the pools you&apos;ve joined and hosted, and claim your winnings.</div>
      <div className="mt-5 flex justify-center">
        <ConnectKitButton.Custom>
          {({ show }) => (
            <button onClick={show} className="rounded-btn bg-accent px-6 py-3 text-[14px] font-bold text-bg">
              Connect wallet
            </button>
          )}
        </ConnectKitButton.Custom>
      </div>
    </div>
  );
}
