"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type Address, isAddress } from "viem";
import { ConnectKitButton } from "connectkit";
import { toast } from "sonner";
import { useAccount, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { TopBar } from "@/components/TopBar";
import { FeeUnlockBar } from "@/components/FeeUnlockBar";
import { squadsAbi, erc20Abi } from "@/lib/abis";
import { SQUADS_ADDRESS, JACKPOT_ADDRESS, USDC_ADDRESS } from "@/lib/addresses";
import { usePool, useDrawingState, useUsdc, usePoolHolders, usePoolMeta, useNow } from "@/lib/hooks";
import { parsePool, visualState, STATE_META } from "@/lib/derive";
import { formatUsdc, dotAddr, hms } from "@/lib/format";
import { pad2 } from "@/lib/tickets";

const AVATAR_COLORS = ["#ff7a3c", "#5ad1ff", "#b388ff", "#ffd23f", "#ff5247"];

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
  const now = useNow();

  const poolQ = usePool(valid ? organizer : undefined, drawingId);
  const drawingQ = useDrawingState(drawingId);
  const { allowance, refetch: refetchUsdc } = useUsdc(address);
  const { name } = usePoolMeta(valid ? organizer : undefined, drawingId);
  const { holders } = usePoolHolders(valid ? organizer : undefined, drawingId);

  const claimableQ = useReadContract({
    chainId: base.id,
    address: SQUADS_ADDRESS,
    abi: squadsAbi,
    functionName: "claimableOf",
    args: address && drawingId !== undefined ? [organizer, drawingId, address] : undefined,
    query: { enabled: Boolean(address) && valid, refetchInterval: 15_000 },
  });

  const [qty, setQty] = useState(25);
  const [detailTab, setDetailTab] = useState<"tickets" | "owners">("owners");
  const [busy, setBusy] = useState(false);

  if (!valid) return <Shell>Invalid pool.</Shell>;
  if (!poolQ.data) return <Shell>Loading pool…</Shell>;

  const p = parsePool(organizer, drawingId, poolQ.data as never);
  const ds = drawingQ.data;
  const nowSec = Math.floor((now || Date.now()) / 1000);
  const vis = visualState(p, { drawingTime: ds?.drawingTime, winningTicket: ds?.winningTicket }, nowSec);
  const meta = STATE_META[vis];

  const forSale = Number(p.sharesForSale);
  const sold = Number(p.sharesSold);
  const soldPctNum = forSale > 0 ? Math.min(100, (sold / forSale) * 100) : 0;
  const remaining = p.sharesForSale - p.sharesSold;
  const buyMax = Math.max(1, Number(remaining) || 1);
  const cappedQty = Math.max(1, Math.min(qty, buyMax));
  const cost = p.pricePerShare * BigInt(cappedQty);
  const claimable = (claimableQ.data as bigint | undefined) ?? 0n;
  const onBase = chainId === base.id;
  const drawn = ds?.winningTicket !== undefined && ds.winningTicket !== 0n;
  const reservePctNum = p.totalShares > 0n ? (Number(p.reserveShares) / Number(p.totalShares)) * 100 : 0;
  const sliderFill = `${((cappedQty - 1) / Math.max(1, buyMax - 1)) * 100}%`;

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
      toast.loading(`Buying ${cappedQty} share${cappedQty === 1 ? "" : "s"}…`, { id: toastId });
      const h = await writeContractAsync({
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

  function share() {
    if (typeof window === "undefined") return;
    navigator.clipboard?.writeText(window.location.href);
    toast.success("Invite link copied");
  }

  // 100-cell fill grid (over the for-sale universe): mine (preview) → others-sold → open.
  const previewQty = vis === "live" ? cappedQty : 0;
  const mineN = forSale > 0 ? Math.round((Math.min(previewQty, forSale) / forSale) * 100) : 0;
  const soldN = forSale > 0 ? Math.round((Math.min(sold + previewQty, forSale) / forSale) * 100) : 0;

  return (
    <main className="relative">
      <TopBar />
      <div className="mx-auto w-full max-w-[1200px] px-4 py-[30px] sm:px-7">
        {/* Heading + share */}
        <div className="mb-[22px] flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 className="m-0 mb-[6px] text-[30px] font-bold tracking-[-0.6px] text-txt">{name?.trim() || "Pool"}</h1>
            <div className="font-mono text-[13px] text-txt-muted">by {dotAddr(organizer)}</div>
          </div>
          <button
            onClick={share}
            title="Copy invite link"
            className="flex h-[38px] w-[38px] shrink-0 items-center justify-center rounded-full border border-white/[0.08] bg-raised"
          >
            <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden>
              <circle cx="4" cy="8" r="2" stroke="#c6ff3a" strokeWidth="1.5" fill="none" />
              <circle cx="12" cy="4" r="2" stroke="#c6ff3a" strokeWidth="1.5" fill="none" />
              <circle cx="12" cy="12" r="2" stroke="#c6ff3a" strokeWidth="1.5" fill="none" />
              <path d="M5.7 7 L10.3 4.8 M5.7 9 L10.3 11.2" stroke="#c6ff3a" strokeWidth="1.5" />
            </svg>
          </button>
        </div>

        <div className="grid grid-cols-1 items-start gap-5 lg:grid-cols-[1.6fr_1fr]">
          {/* LEFT */}
          <div className="flex flex-col gap-4">
            <div
              className="rounded-[20px] bg-[linear-gradient(180deg,#1b1916,#141210)] p-6"
              style={{ border: `1px solid ${vis === "settled" ? "rgba(198,255,58,0.4)" : "rgba(255,255,255,0.07)"}` }}
            >
              <div className="mb-[18px] flex items-center justify-between gap-3">
                <div className="flex items-end gap-[10px]">
                  <span className="font-mono text-[64px] font-bold leading-[0.85] tracking-[-3px] text-txt">
                    {Math.round(soldPctNum)}%
                  </span>
                  <span className="pb-[6px] font-mono text-[15px] text-txt-muted">sold</span>
                </div>
                <span
                  className="inline-flex items-center gap-[7px] rounded-[8px] px-[11px] py-[6px] font-mono text-[11px] font-bold uppercase tracking-[0.5px]"
                  style={{ background: meta.tint, color: meta.color }}
                >
                  <span className="h-[6px] w-[6px] rounded-full" style={{ background: meta.color }} />
                  {vis === "live"
                    ? `Drawing in ${hms(ds?.drawingTime, now)}`
                    : vis === "locked"
                      ? "Sales closed"
                      : vis === "building"
                        ? "Funding"
                        : "Drawn"}
                </span>
              </div>
              <div className="mb-[18px] font-mono text-[12px] text-txt-faint">
                {p.ticketCount.toString()} tickets · {forSale} shares
              </div>
              <div className="mb-[18px] flex flex-wrap gap-[3px]">
                {Array.from({ length: 100 }).map((_, i) => (
                  <span
                    key={i}
                    className="h-[13px] w-[13px] rounded-[2px]"
                    style={{ background: i < mineN ? "#c6ff3a" : i < soldN ? "rgba(198,255,58,0.32)" : "#2a2723" }}
                  />
                ))}
              </div>
              <div className="mb-[18px] flex flex-wrap items-center gap-[18px]">
                <Legend color="#c6ff3a" label="You" />
                <Legend color="rgba(198,255,58,0.34)" label="Others" />
                <Legend color="#2a2723" label="Open" border />
              </div>
              <div className="flex items-center gap-3 border-t border-white/[0.06] pt-4">
                {holders.length > 0 ? (
                  <>
                    <div className="flex">
                      {holders.slice(0, 5).map((h, i) => (
                        <span
                          key={h.address}
                          className="flex h-[30px] w-[30px] items-center justify-center rounded-full border-2 border-surface font-mono text-[9px] font-bold text-bg"
                          style={{
                            marginLeft: i === 0 ? 0 : -9,
                            background: h.address.toLowerCase() === address?.toLowerCase() ? "#c6ff3a" : AVATAR_COLORS[i % AVATAR_COLORS.length],
                          }}
                        >
                          {h.address.toLowerCase() === address?.toLowerCase() ? "YOU" : h.address.slice(2, 4).toUpperCase()}
                        </span>
                      ))}
                    </div>
                    <span className="font-mono text-[13px] text-txt-muted">
                      {holders.length} holder{holders.length === 1 ? " owns" : "s own"} this pool
                    </span>
                  </>
                ) : (
                  <span className="font-mono text-[13px] text-txt-faint">No holders yet — be the first to buy in.</span>
                )}
              </div>
            </div>

            {/* Tabs */}
            <div className="flex gap-2">
              <TabBtn active={detailTab === "tickets"} onClick={() => setDetailTab("tickets")}>
                Tickets
              </TabBtn>
              <TabBtn active={detailTab === "owners"} onClick={() => setDetailTab("owners")}>
                Owners
              </TabBtn>
            </div>

            <div className="rounded-[20px] border border-white/[0.07] bg-surface p-[18px]">
              {detailTab === "owners" ? (
                <div className="flex flex-col gap-[14px]">
                  {holders.length === 0 ? (
                    <div className="py-2 text-center font-mono text-[12px] text-txt-faint">No owners yet.</div>
                  ) : (
                    holders.map((h) => {
                      const me = h.address.toLowerCase() === address?.toLowerCase();
                      const pctOfTotal = p.totalShares > 0n ? (Number(h.shares) / Number(p.totalShares)) * 100 : 0;
                      const barPct = Number(holders[0].shares) > 0 ? (Number(h.shares) / Number(holders[0].shares)) * 100 : 0;
                      return (
                        <div key={h.address}>
                          <div className="mb-[7px] flex items-center justify-between gap-3">
                            <div className="flex min-w-0 items-center gap-[9px]">
                              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: me ? "#c6ff3a" : "#5c574e" }} />
                              <span className="truncate font-mono text-[13px] font-medium" style={{ color: me ? "#c6ff3a" : "#f4f1ea" }}>
                                {me ? "You" : dotAddr(h.address)}
                              </span>
                            </div>
                            <div className="flex shrink-0 items-baseline gap-2">
                              <span className="font-mono text-[12px] text-txt-faint">{h.shares.toString()}</span>
                              <span className="font-mono text-[13px] font-semibold text-txt">{pctOfTotal.toFixed(1)}%</span>
                            </div>
                          </div>
                          <div className="h-[5px] overflow-hidden rounded-[3px] bg-bg">
                            <div className="h-full rounded-[3px]" style={{ width: `${barPct}%`, background: me ? "#c6ff3a" : "rgba(255,255,255,0.18)" }} />
                          </div>
                        </div>
                      );
                    })
                  )}
                </div>
              ) : (
                <TicketsTab organizer={organizer} drawingId={drawingId} ticketCount={p.ticketCount} />
              )}
            </div>
          </div>

          {/* RIGHT (sticky) */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-[90px]">
            {claimable > 0n && (
              <button
                disabled={busy}
                onClick={() => action("withdraw", "Withdraw")}
                className="rounded-[15px] bg-accent py-4 text-[15px] font-bold text-bg disabled:opacity-60"
              >
                Claim {formatUsdc(claimable)}
              </button>
            )}

            {vis === "live" && (
              <div className="flex min-h-[299px] flex-col justify-center gap-[22px] rounded-[20px] border border-white/[0.07] bg-surface px-5 py-6">
                <div className="text-center">
                  <div className="flex items-end justify-center gap-2">
                    <span className="pb-[5px] font-mono text-[14px] text-txt-muted">Buy</span>
                    <span className="font-mono text-[54px] font-bold leading-[0.9] tracking-[-1.5px] text-txt">{cappedQty}</span>
                    <span className="pb-[5px] font-mono text-[14px] text-txt-muted">share{cappedQty === 1 ? "" : "s"}</span>
                  </div>
                </div>
                <input
                  type="range"
                  min={1}
                  max={buyMax}
                  value={cappedQty}
                  onChange={(e) => setQty(Number(e.target.value))}
                  className="mp-range"
                  style={{ ["--fill" as string]: sliderFill }}
                  aria-label="Shares to buy"
                />
                {!address ? (
                  <ConnectKitButton.Custom>
                    {({ show }) => (
                      <button onClick={show} className="rounded-[15px] bg-accent py-4 text-[15px] font-bold text-bg">
                        Connect wallet
                      </button>
                    )}
                  </ConnectKitButton.Custom>
                ) : (
                  <button
                    disabled={busy || !onBase || remaining <= 0n}
                    onClick={buy}
                    className="rounded-[15px] bg-accent py-4 text-[15px] font-bold text-bg disabled:bg-inset disabled:text-txt-faint disabled:opacity-60"
                  >
                    {!onBase ? "Switch to Base" : busy ? "…" : `Buy for ${formatUsdc(cost)}`}
                  </button>
                )}
              </div>
            )}

            {vis === "building" && (
              <div className="flex min-h-[299px] flex-col items-center justify-center rounded-[20px] border border-white/[0.07] bg-surface p-6 text-center">
                <div className="text-[16px] font-semibold text-txt">Pool opens soon</div>
                <div className="mt-2 font-mono text-[12px] text-txt-faint">The host hasn&apos;t opened shares yet.</div>
              </div>
            )}

            {vis === "locked" && (
              <div className="flex min-h-[299px] flex-col items-center justify-center rounded-[20px] border border-white/[0.07] bg-surface px-5 py-6 text-center">
                {drawn ? (
                  <>
                    <div className="mb-5 text-[22px] font-bold text-txt">Drawing complete</div>
                    <button
                      disabled={busy}
                      onClick={() => action("claimAndDistribute", "Settle & distribute")}
                      className="w-full rounded-[14px] bg-warn py-4 text-[15px] font-bold text-bg disabled:opacity-60"
                    >
                      Settle &amp; distribute
                    </button>
                  </>
                ) : (
                  <>
                    <div className="mb-5 text-[40px] font-bold leading-[1.05] tracking-[-1px] text-txt">Sales closed</div>
                    <div className="mb-[6px] font-mono text-[10px] uppercase tracking-[1.2px] text-txt-muted">Drawing in</div>
                    <div className="font-mono text-[46px] font-bold leading-none tracking-[-2px] text-accent">{hms(ds?.drawingTime, now)}</div>
                  </>
                )}
              </div>
            )}

            {vis === "settled" && claimable <= 0n && (
              <div className="flex min-h-[299px] flex-col items-center justify-center rounded-[20px] border border-white/[0.07] bg-surface p-6 text-center">
                <div className="mb-2 text-[30px]">🎲</div>
                <div className="mb-[6px] text-[17px] font-bold text-txt">This pool is settled</div>
                <div className="mb-4 text-[13px] leading-[1.5] text-txt-muted">Winnings (if any) have been distributed to shareholders.</div>
                <Link href="/" className="w-full rounded-[13px] bg-accent py-[14px] text-[14px] font-bold text-bg">
                  Find your next pool
                </Link>
              </div>
            )}

            {/* Verify */}
            <div className="mt-2 rounded-[20px] border border-white/[0.07] bg-surface p-5">
              <div className="mb-[14px] font-mono text-[11px] uppercase tracking-[1.2px] text-txt-muted">Verify</div>
              <div className="flex flex-col">
                <VerifyLink label="Pool creator" value={dotAddr(organizer)} href={`https://basescan.org/address/${organizer}`} />
                <div className="border-b border-white/[0.06] py-[14px]">
                  <FeeUnlockBar feesUsdc={`${formatUsdc(p.feesCollected)}`} pct={soldPctNum} />
                </div>
                <VerifyRow label="Owner reserve" value={`${reservePctNum % 1 === 0 ? reservePctNum : reservePctNum.toFixed(1)}%`} />
                <VerifyLink label="Pool contract" value={dotAddr(SQUADS_ADDRESS)} href={`https://basescan.org/address/${SQUADS_ADDRESS}`} />
                <VerifyLink label="Megapot contract" value={dotAddr(JACKPOT_ADDRESS)} href={`https://basescan.org/address/${JACKPOT_ADDRESS}`} last />
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

function Legend({ color, label, border }: { color: string; label: string; border?: boolean }) {
  return (
    <div className="flex items-center gap-[6px]">
      <span
        className="h-[9px] w-[9px] shrink-0 rounded-[2px]"
        style={{ background: color, border: border ? "1px solid rgba(255,255,255,0.1)" : undefined }}
      />
      <span className="font-mono text-[12px] text-txt-muted">{label}</span>
    </div>
  );
}

function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-pill border px-4 py-2 text-[13px] font-semibold"
      style={{
        background: active ? "#2a2622" : "#161412",
        color: active ? "#f4f1ea" : "#9b958a",
        borderColor: active ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)",
      }}
    >
      {children}
    </button>
  );
}

type TicketNumbers = { normals: number[]; bonusball: number; txHash?: string };

// Ticket numbers aren't exposed by any on-chain read, so the picked normals/bonusball come from the
// Megapot Data API (proxied through /api/pool-tickets to keep the key server-side). The ticket IDs
// themselves are read on-chain (getTicketIds) and used to look up each ticket's numbers.
function TicketsTab({ organizer, drawingId, ticketCount }: { organizer: Address; drawingId: bigint; ticketCount: bigint }) {
  const idsQ = useReadContract({
    chainId: base.id,
    address: SQUADS_ADDRESS,
    abi: squadsAbi,
    functionName: "getTicketIds",
    args: [organizer, drawingId],
    query: { refetchInterval: 30_000 },
  });
  const ids = useMemo(() => ((idsQ.data as readonly bigint[] | undefined) ?? []).map((id) => id.toString()), [idsQ.data]);

  const numbersQ = useQuery({
    queryKey: ["pool-ticket-numbers", drawingId.toString(), ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<Record<string, TicketNumbers>> => {
      const res = await fetch("/api/pool-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drawingId: drawingId.toString(), ids }),
      });
      if (!res.ok) throw new Error(`tickets ${res.status}`);
      return (await res.json()).tickets ?? {};
    },
  });
  const numbers = numbersQ.data ?? {};

  return (
    <div className="px-4">
      <div className="mb-2 font-mono text-[12px] text-txt-faint">
        {ticketCount.toString()} ticket{ticketCount === 1n ? "" : "s"} entered in drawing #{drawingId.toString()}
      </div>
      {ids.length === 0 ? (
        <div className="py-3 text-center font-mono text-[12px] text-txt-faint">Loading tickets…</div>
      ) : (
        ids.map((id) => {
          const n = numbers[id];
          const verifyHref = n?.txHash ? `https://basescan.org/tx/${n.txHash}` : `https://basescan.org/address/${SQUADS_ADDRESS}`;
          return (
            <div key={id} className="flex items-center gap-[9px] border-b border-white/[0.06] py-[14px] last:border-0">
              {n ? (
                <>
                  {n.normals.map((num, k) => (
                    <Ball key={k}>{pad2(num)}</Ball>
                  ))}
                  <span className="text-[16px] font-semibold text-[#5c574e]">–</span>
                  <Ball bonus>{pad2(n.bonusball)}</Ball>
                </>
              ) : (
                <span className="flex-1 font-mono text-[12px] text-txt-faint">
                  {numbersQ.isLoading ? "Loading numbers…" : "Numbers indexing…"}
                </span>
              )}
              <a
                href={verifyHref}
                target="_blank"
                rel="noopener noreferrer"
                className="ml-auto inline-flex items-center gap-1 font-mono text-[12px] font-semibold text-txt-muted hover:text-accent"
              >
                Verify
                <svg width="11" height="11" viewBox="0 0 16 16" aria-hidden>
                  <path d="M6 3 H13 V10 M13 3 L3 13" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </a>
            </div>
          );
        })
      )}
    </div>
  );
}

// Detail-page number ball (34px) — matches the design's ticket rows.
function Ball({ children, bonus }: { children: React.ReactNode; bonus?: boolean }) {
  return (
    <span
      className={`flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full font-mono text-[13px] ${
        bonus ? "bg-accent font-bold text-bg shadow-[0_0_16px_rgba(198,255,58,0.45)]" : "border-[1.5px] border-white/[0.28] font-semibold text-txt"
      }`}
    >
      {children}
    </span>
  );
}

function VerifyRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-[10px] border-b border-white/[0.06] py-[13px]">
      <span className="text-[13px] text-txt-muted">{label}</span>
      <span className="font-mono text-[13px] font-semibold text-txt">{value}</span>
    </div>
  );
}

function VerifyLink({ label, value, href, last }: { label: string; value: string; href: string; last?: boolean }) {
  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      className={`flex items-center justify-between gap-[10px] py-[13px] ${last ? "" : "border-b border-white/[0.06]"}`}
    >
      <span className="text-[13px] text-txt-muted">{label}</span>
      <span className="inline-flex items-center gap-[5px] font-mono text-[13px] font-semibold text-txt">
        {value}
        <svg width="11" height="11" viewBox="0 0 16 16" className="text-txt-muted" aria-hidden>
          <path d="M6 3 H13 V10 M13 3 L3 13" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    </a>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative">
      <TopBar />
      <div className="mx-auto w-full max-w-[720px] px-4 py-10 text-center font-mono text-[13px] text-txt-faint">{children}</div>
    </main>
  );
}

function txError(e: unknown): string {
  const msg = (e as Error)?.message?.split("\n")[0] ?? "Transaction failed";
  if (/reject|denied|user/i.test(msg)) return "Wallet rejected";
  return msg.slice(0, 140);
}
