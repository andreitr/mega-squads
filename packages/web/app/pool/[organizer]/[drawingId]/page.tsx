"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type Address, isAddress } from "viem";
import { ConnectKitButton } from "connectkit";
import { toast } from "sonner";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { useQueryClient } from "@tanstack/react-query";
import { TopBar } from "@/components/TopBar";
import { FeeUnlockBar } from "@/components/FeeUnlockBar";
import { squadsAbi, erc20Abi } from "@/lib/abis";
import { SQUADS_ADDRESS, USDC_ADDRESS } from "@/lib/addresses";
import { usePool, useDrawingState, useUsdc } from "@/lib/hooks";
import { parsePool, visualState, soldPct, STATE_META } from "@/lib/derive";
import { formatUsdc, shortAddr } from "@/lib/format";

const CHIPS = [10, 25, 50, 100];

export default function PoolDetailPage() {
  const params = useParams<{ organizer: string; drawingId: string }>();
  const organizer = (params.organizer ?? "") as Address;
  const drawingId = useMemo(() => {
    try {
      return BigInt(params.drawingId);
    } catch {
      return undefined;
    }
  }, [params.drawingId]);
  const valid = isAddress(organizer) && drawingId !== undefined;

  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const { writeContractAsync } = useWriteContract();
  const queryClient = useQueryClient();

  const poolQ = usePool(valid ? organizer : undefined, drawingId);
  const drawingQ = useDrawingState(drawingId);
  const { allowance, refetch: refetchUsdc } = useUsdc(address);

  const claimableQ = useReadContract({
    chainId: base.id,
    address: SQUADS_ADDRESS,
    abi: squadsAbi,
    functionName: "claimableOf",
    args: address && drawingId !== undefined ? [organizer, drawingId, address] : undefined,
    query: { enabled: Boolean(address) && valid, refetchInterval: 15_000 },
  });

  const [qty, setQty] = useState(25);
  const [gift, setGift] = useState(false);
  const [recipient, setRecipient] = useState("");
  const [busy, setBusy] = useState(false);

  if (!valid) return <Shell>Invalid pool.</Shell>;
  if (!poolQ.data) return <Shell>Loading pool…</Shell>;

  const p = parsePool(organizer, drawingId, poolQ.data as never);
  const ds = drawingQ.data;
  const nowSec = Math.floor(Date.now() / 1000);
  const vis = visualState(p, { drawingTime: ds?.drawingTime, winningTicket: ds?.winningTicket }, nowSec);
  const meta = STATE_META[vis];
  const sold = soldPct(p);
  const remaining = p.sharesForSale - p.sharesSold;
  const cappedQty = Math.max(1, Math.min(qty, Number(remaining) || 1));
  const cost = p.pricePerShare * BigInt(cappedQty);
  const claimable = (claimableQ.data as bigint | undefined) ?? 0n;
  const onBase = chainId === base.id;
  const canBuy = vis === "live" && remaining > 0n && onBase;
  const drawn = ds?.winningTicket !== undefined && ds.winningTicket !== 0n;

  async function buy() {
    if (!address || !publicClient) return;
    const toastId = "buy";
    try {
      setBusy(true);
      if ((allowance ?? 0n) < cost) {
        toast.loading("Approve USDC…", { id: toastId });
        const h = await writeContractAsync({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [SQUADS_ADDRESS, cost],
        });
        await publicClient.waitForTransactionReceipt({ hash: h });
        await refetchUsdc();
      }
      const giftTo = gift && isAddress(recipient) ? (recipient as Address) : null;
      toast.loading(`Buying ${cappedQty} share${cappedQty === 1 ? "" : "s"}…`, { id: toastId });
      const h = giftTo
        ? await writeContractAsync({
            address: SQUADS_ADDRESS,
            abi: squadsAbi,
            functionName: "buySharesFor",
            args: [organizer, drawingId!, BigInt(cappedQty), giftTo],
          })
        : await writeContractAsync({
            address: SQUADS_ADDRESS,
            abi: squadsAbi,
            functionName: "buyShares",
            args: [organizer, drawingId!, BigInt(cappedQty)],
          });
      await publicClient.waitForTransactionReceipt({ hash: h });
      toast.success(`Bought ${cappedQty} share${cappedQty === 1 ? "" : "s"} for ${formatUsdc(cost)}`, { id: toastId });
      queryClient.invalidateQueries();
    } catch (e) {
      toast.error(txError(e), { id: toastId });
    } finally {
      setBusy(false);
    }
  }

  async function action(fn: "claimAndDistribute" | "withdraw", label: string) {
    if (!address || !publicClient) return;
    const toastId = fn;
    try {
      setBusy(true);
      toast.loading(`${label}…`, { id: toastId });
      const h = await writeContractAsync({
        address: SQUADS_ADDRESS,
        abi: squadsAbi,
        functionName: fn,
        args: [organizer, drawingId!],
      });
      await publicClient.waitForTransactionReceipt({ hash: h });
      toast.success(`${label} confirmed`, { id: toastId });
      queryClient.invalidateQueries();
    } catch (e) {
      toast.error(txError(e), { id: toastId });
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="relative">
      <TopBar />
      <div className="mx-auto w-full max-w-[720px] px-4 py-6">
        <Link href="/" className="font-mono text-[12px] text-txt-faint hover:text-txt">
          ← Feed
        </Link>

        <div className="mt-3 flex items-center gap-2">
          <span
            className="rounded-pill px-3 py-1 font-mono text-[10px] uppercase tracking-[0.5px]"
            style={{ color: meta.color, background: meta.tint }}
          >
            {meta.label}
          </span>
        </div>
        <h1 className="mt-2 text-[30px] font-bold tracking-[-0.6px] text-txt">Pool</h1>
        <div className="font-mono text-[13px] text-txt-muted">by {shortAddr(organizer)}</div>

        <div className="mt-6 grid grid-cols-3 gap-3">
          <Stat label="Tickets" value={p.ticketCount.toString()} />
          <Stat label="Share price" value={formatUsdc(p.pricePerShare, { dp: 4 })} />
          <Stat label="Reserve" value={`${Number(p.reserveShares)} / ${Number(p.totalShares)}`} />
        </div>

        <div className="mt-4 rounded-card border border-white/[0.06] bg-surface p-5">
          <FeeUnlockBar feesUsdc={formatUsdc(p.feesCollected)} pct={p.soldOut ? 100 : sold} />
        </div>

        {/* Buy / settle / withdraw */}
        <div className="mt-4 rounded-card border border-white/[0.06] bg-surface p-5">
          {claimable > 0n && (
            <button
              disabled={busy}
              onClick={() => action("withdraw", "Withdraw")}
              className="mb-4 w-full rounded-btn bg-accent py-3 font-semibold text-bg disabled:opacity-60"
            >
              Withdraw {formatUsdc(claimable)}
            </button>
          )}

          {vis === "live" ? (
            <>
              <div className="mb-3 flex items-center justify-between">
                <span className="text-[13px] text-txt-muted">Buy shares</span>
                <span className="font-mono text-[12px] text-txt-faint">{Number(remaining)} left</span>
              </div>
              <div className="flex items-center gap-2">
                <Stepper value={cappedQty} onChange={setQty} max={Number(remaining)} />
                <div className="flex gap-1">
                  {CHIPS.map((c) => (
                    <button
                      key={c}
                      onClick={() => setQty(c)}
                      className="rounded-chip bg-inset px-3 py-2 font-mono text-[12px] text-txt-muted hover:text-txt"
                    >
                      {c}
                    </button>
                  ))}
                </div>
              </div>

              <label className="mt-3 flex items-center gap-2 text-[12px] text-txt-muted">
                <input type="checkbox" checked={gift} onChange={(e) => setGift(e.target.checked)} /> Gift to someone
              </label>
              {gift && (
                <input
                  value={recipient}
                  onChange={(e) => setRecipient(e.target.value)}
                  placeholder="0x recipient address"
                  className="mt-2 w-full rounded-box border border-white/[0.08] bg-inset px-3 py-2 font-mono text-[12px] text-txt outline-none focus:border-accent/40"
                />
              )}

              {!address ? (
                <ConnectKitButton.Custom>
                  {({ show }) => (
                    <button onClick={show} className="mt-4 w-full rounded-btn bg-accent py-3 font-semibold text-bg">
                      Connect wallet
                    </button>
                  )}
                </ConnectKitButton.Custom>
              ) : (
                <button
                  disabled={!canBuy || busy || (gift && !isAddress(recipient))}
                  onClick={buy}
                  className="mt-4 w-full rounded-btn bg-accent py-3 font-semibold text-bg disabled:bg-inset disabled:text-txt-faint disabled:opacity-60"
                >
                  {busy ? "…" : `Buy ${cappedQty} — ${formatUsdc(cost)}`}
                </button>
              )}
            </>
          ) : vis === "locked" && drawn ? (
            <button
              disabled={busy}
              onClick={() => action("claimAndDistribute", "Settle & distribute")}
              className="w-full rounded-btn bg-warn py-3 font-semibold text-bg disabled:opacity-60"
            >
              Settle & distribute
            </button>
          ) : (
            <div className="py-2 text-center font-mono text-[12px] text-txt-faint">
              {vis === "building" ? "Not open for shares yet." : vis === "locked" ? "Drawing in progress…" : "Settled."}
            </div>
          )}
        </div>
      </div>
    </main>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-box border border-white/[0.06] bg-inset p-3">
      <div className="font-mono text-[10px] uppercase tracking-[0.4px] text-txt-faint">{label}</div>
      <div className="mt-1 font-mono text-[16px] font-semibold text-txt">{value}</div>
    </div>
  );
}

function Stepper({ value, onChange, max }: { value: number; onChange: (v: number) => void; max: number }) {
  return (
    <div className="flex items-center gap-2 rounded-box border border-white/[0.08] bg-inset px-2 py-1">
      <button onClick={() => onChange(Math.max(1, value - 1))} className="px-2 text-txt-muted hover:text-txt">
        −
      </button>
      <span className="w-10 text-center font-mono text-[15px] text-txt">{value}</span>
      <button onClick={() => onChange(Math.min(max || value + 1, value + 1))} className="px-2 text-txt-muted hover:text-txt">
        +
      </button>
    </div>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative">
      <TopBar />
      <div className="mx-auto w-full max-w-[720px] px-4 py-10 text-center font-mono text-[13px] text-txt-faint">
        {children}
      </div>
    </main>
  );
}

function txError(e: unknown): string {
  const msg = (e as Error)?.message?.split("\n")[0] ?? "Transaction failed";
  if (/reject|denied|user/i.test(msg)) return "Wallet rejected";
  return msg.slice(0, 140);
}
