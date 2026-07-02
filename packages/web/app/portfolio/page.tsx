"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ConnectKitButton } from "connectkit";
import { toast } from "sonner";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { useQueryClient } from "@tanstack/react-query";
import { TopBar } from "@/components/TopBar";
import { PoolCard } from "@/components/PoolCard";
import { squadsAbi } from "@/lib/abis";
import { SQUADS_ADDRESS } from "@/lib/addresses";
import { usePortfolio, type LivePool } from "@/lib/hooks";
import { formatUsdc } from "@/lib/format";

export default function PortfolioPage() {
  const { address } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();
  const { joined, organized, claimable, claimablePositions, isLoading } = usePortfolio(address);
  const [busy, setBusy] = useState(false);

  // A single "My Pools" list — every pool the user is in (hosted or joined), deduped, newest first.
  const myPools = useMemo(() => {
    const byKey = new Map<string, LivePool>();
    for (const p of joined) byKey.set(`${p.organizer.toLowerCase()}-${p.drawingId}`, p);
    for (const p of organized) byKey.set(`${p.organizer.toLowerCase()}-${p.drawingId}`, p);
    return [...byKey.values()].sort((a, b) => (b.drawingId > a.drawingId ? 1 : b.drawingId < a.drawingId ? -1 : 0));
  }, [joined, organized]);

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
              <div className="flex items-center justify-between gap-4">
                <span className="font-mono text-[40px] font-bold leading-none tracking-[-2px] text-bg sm:text-[48px]">
                  {formatUsdc(claimable)}
                </span>
                <button
                  disabled={busy || claimable <= 0n}
                  onClick={claimAll}
                  className="rounded-box bg-bg px-[22px] py-3 text-[14px] font-bold text-accent disabled:opacity-50"
                >
                  {busy ? "Claiming…" : "Claim"}
                </button>
              </div>
            </div>

            {/* My pools */}
            <div className="mb-[18px] flex items-center justify-between">
              <span className="text-[19px] font-bold tracking-[-0.3px] text-txt">My Pools</span>
              {myPools.length > 0 && <span className="font-mono text-[12px] text-txt-faint">{myPools.length}</span>}
            </div>

            {isLoading && myPools.length === 0 ? (
              <div className="grid grid-cols-1 gap-4 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
                {[0, 1, 2].map((i) => (
                  <div key={i} className="h-[150px] animate-pulse rounded-card border border-white/[0.06] bg-surface" />
                ))}
              </div>
            ) : myPools.length === 0 ? (
              <div className="rounded-card border border-white/[0.06] bg-surface p-8 text-center font-mono text-[12px] text-txt-faint">
                You&apos;re not in any pools yet.{" "}
                <Link href="/create" className="text-accent hover:underline">
                  Host one →
                </Link>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-4 [grid-template-columns:repeat(auto-fill,minmax(250px,1fr))]">
                {myPools.map((p) => (
                  <PoolCard key={`${p.organizer}-${p.drawingId}`} pool={p} />
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </main>
  );
}

function ConnectPrompt() {
  return (
    <div className="mx-auto mt-10 max-w-md rounded-card border border-white/[0.07] bg-surface p-8 text-center">
      <div className="text-[18px] font-bold text-txt">Connect your wallet</div>
      <div className="mt-2 text-[13px] text-txt-muted">See your pools and claim your winnings.</div>
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
