"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { type Address, isAddress } from "viem";
import { ConnectKitButton } from "connectkit";
import { toast } from "sonner";
import { useAccount, useEnsAvatar, useEnsName, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { base, mainnet } from "wagmi/chains";
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
  const { data: organizerEns } = useEnsName({ address: valid ? organizer : undefined, chainId: mainnet.id });

  const claimableQ = useReadContract({
    chainId: base.id,
    address: SQUADS_ADDRESS,
    abi: squadsAbi,
    functionName: "claimableOf",
    args: address && drawingId !== undefined ? [organizer, drawingId, address] : undefined,
    query: { enabled: Boolean(address) && valid, refetchInterval: 15_000 },
  });

  // The drawing's winning numbers (Data API, via /api/round) — for the settled card.
  const roundQ = useQuery({
    queryKey: ["round-info", drawingId?.toString() ?? "none"],
    enabled: valid,
    queryFn: async (): Promise<{ status: string | null; settledAt: string | null; winningNumbers: { normals: number[]; bonusball: number } | null }> => {
      const res = await fetch(`/api/round?drawingId=${drawingId}`);
      if (!res.ok) throw new Error(`round ${res.status}`);
      return res.json();
    },
  });
  const settledDate = roundQ.data?.settledAt
    ? new Date(roundQ.data.settledAt).toLocaleDateString("en-US", { month: "long", day: "numeric" })
    : null;

  const [qty, setQty] = useState(25);
  const [detailTab, setDetailTab] = useState<"tickets" | "owners">("tickets");
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

  // Settled-card state: whether the pool won, and how the claim splits into pro-rata winnings vs
  // the referral-fee rebate (claimable also bundles the rebate, so winnings is the share-based part).
  const won = p.totalWinnings > 0n;
  const myShares = holders.find((h) => h.address.toLowerCase() === address?.toLowerCase())?.shares ?? 0n;
  const myWinnings = p.totalShares > 0n ? (p.totalWinnings * myShares) / p.totalShares : 0n;
  const rebate = claimable > myWinnings ? claimable - myWinnings : 0n;
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
            <div className="font-mono text-[13px] text-txt-muted">by {organizerEns ?? dotAddr(organizer)}</div>
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
                {vis !== "settled" && (
                  <span
                    className="inline-flex items-center gap-[7px] rounded-[8px] px-[11px] py-[6px] font-mono text-[11px] font-bold uppercase tracking-[0.5px]"
                    style={{ background: meta.tint, color: meta.color }}
                  >
                    <span className="h-[6px] w-[6px] rounded-full" style={{ background: meta.color }} />
                    {vis === "live"
                      ? `Drawing in ${hms(ds?.drawingTime, now)}`
                      : vis === "locked"
                        ? "Sales closed"
                        : "Funding"}
                  </span>
                )}
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
                        <HolderAvatar
                          key={h.address}
                          address={h.address}
                          index={i}
                          isMe={h.address.toLowerCase() === address?.toLowerCase()}
                        />
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
                <TicketsTab organizer={organizer} drawingId={drawingId} />
              )}
            </div>
          </div>

          {/* RIGHT (sticky) */}
          <div className="flex flex-col gap-4 lg:sticky lg:top-[90px]">
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

            {vis === "settled" && (
              <div
                className="flex min-h-[299px] flex-col items-center rounded-[22px] px-[26px] py-7 text-center"
                style={
                  won
                    ? {
                        background: "radial-gradient(120% 90% at 50% 0%, rgba(198,255,58,0.16), #12100e 58%)",
                        border: "1px solid rgba(198,255,58,0.4)",
                      }
                    : { background: "#12100e", border: "1px solid rgba(255,255,255,0.08)" }
                }
              >
                {/* Header pinned top, button pinned bottom, amount + caption centered between. */}
                <a
                  href={`https://megapot.io/results/${drawingId}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-[6px] font-mono text-[11px] uppercase tracking-[2px] text-[#7d7669] hover:text-txt"
                >
                  Round settled{settledDate ? ` on ${settledDate}` : ""}
                  <svg width="10" height="10" viewBox="0 0 16 16" aria-hidden>
                    <path d="M6 3 H13 V10 M13 3 L3 13" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                </a>

                <div className="flex flex-1 flex-col items-center justify-center">
                  <div
                    className="font-mono text-[53px] font-bold leading-[0.85] tracking-[-2.5px]"
                    style={won ? { color: "#c6ff3a", textShadow: "0 0 30px rgba(198,255,58,0.35)" } : { color: "#f4f1ea" }}
                  >
                    {formatUsdc(claimable)}
                  </div>
                  <div className="mt-3 font-mono text-[11px] uppercase tracking-[1.6px] text-[#7d7669]">
                    {claimable > 0n
                      ? won
                        ? `${formatUsdc(myWinnings)} winnings + ${formatUsdc(rebate)} rebate`
                        : `Referral rebate${p.soldOut ? " · pool sold out" : ""}`
                      : "Nothing to claim"}
                  </div>
                </div>

                <button
                  disabled={busy || claimable <= 0n}
                  onClick={() => action("withdraw", "Withdraw")}
                  className="w-full rounded-[16px] bg-accent p-[17px] text-[17px] font-bold text-bg hover:brightness-105 disabled:opacity-60"
                >
                  {claimable > 0n ? `Claim ${formatUsdc(claimable)}` : "Nothing to claim"}
                </button>
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

// Holder avatar: an ENS avatar when the address has one, otherwise the "YOU"/initials badge.
// ENS resolves on mainnet (configured in the wagmi client for exactly this).
function HolderAvatar({ address, index, isMe }: { address: Address; index: number; isMe: boolean }) {
  const { data: ensName } = useEnsName({ address, chainId: mainnet.id });
  const { data: ensAvatar } = useEnsAvatar({
    name: ensName ?? undefined,
    chainId: mainnet.id,
    query: { enabled: Boolean(ensName) },
  });
  const ring = "h-[30px] w-[30px] shrink-0 rounded-full border-2 border-surface";
  const marginLeft = index === 0 ? 0 : -9;

  if (ensAvatar) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img src={ensAvatar} alt={ensName ?? address} title={ensName ?? undefined} className={`${ring} object-cover`} style={{ marginLeft }} />
    );
  }
  return (
    <span
      className={`${ring} flex items-center justify-center font-mono text-[9px] font-bold text-bg`}
      style={{ marginLeft, background: isMe ? "#c6ff3a" : AVATAR_COLORS[index % AVATAR_COLORS.length] }}
      title={ensName ?? address}
    >
      {isMe ? "YOU" : address.slice(2, 4).toUpperCase()}
    </span>
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

type TicketNumbers = { normals: number[]; bonusball: number; txHash?: string; winnings?: string };

// Ticket numbers aren't exposed by any on-chain read, so the picked normals/bonusball (and any
// winnings) come from the Megapot Data API (proxied through /api/pool-tickets to keep the key
// server-side). The ticket IDs themselves are read on-chain (getTicketIds). Shared by the Tickets
// tab and the settled card — the identical query keys dedupe into one fetch.
function usePoolTicketNumbers(organizer?: Address, drawingId?: bigint) {
  const idsQ = useReadContract({
    chainId: base.id,
    address: SQUADS_ADDRESS,
    abi: squadsAbi,
    functionName: "getTicketIds",
    args: organizer && drawingId !== undefined ? [organizer, drawingId] : undefined,
    query: { enabled: Boolean(organizer) && drawingId !== undefined, refetchInterval: 30_000 },
  });
  const ids = useMemo(() => ((idsQ.data as readonly bigint[] | undefined) ?? []).map((id) => id.toString()), [idsQ.data]);

  const numbersQ = useQuery({
    queryKey: ["pool-ticket-numbers", drawingId?.toString() ?? "none", ids],
    enabled: ids.length > 0 && drawingId !== undefined,
    queryFn: async (): Promise<Record<string, TicketNumbers>> => {
      const res = await fetch("/api/pool-tickets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ drawingId: drawingId!.toString(), ids }),
      });
      if (!res.ok) throw new Error(`tickets ${res.status}`);
      return (await res.json()).tickets ?? {};
    },
  });
  return { ids, numbers: numbersQ.data ?? ({} as Record<string, TicketNumbers>), isLoading: numbersQ.isLoading };
}

function TicketsTab({ organizer, drawingId }: { organizer: Address; drawingId: bigint }) {
  const { ids, numbers, isLoading } = usePoolTicketNumbers(organizer, drawingId);

  return (
    <div className="px-4">
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
                  <span className="text-[14px] font-semibold text-[#5c574e]">–</span>
                  <Ball bonus>{pad2(n.bonusball)}</Ball>
                </>
              ) : (
                <span className="flex-1 font-mono text-[12px] text-txt-faint">
                  {isLoading ? "Loading numbers…" : "Numbers indexing…"}
                </span>
              )}
              {n?.winnings && (
                <span className="rounded-[6px] bg-accent/[0.14] px-2 py-1 font-mono text-[11px] font-bold text-accent">
                  Won {formatUsdc(BigInt(n.winnings))}
                </span>
              )}
              <a
                href={verifyHref}
                target="_blank"
                rel="noopener noreferrer"
                title="Verify on Basescan"
                aria-label="Verify on Basescan"
                className="ml-auto inline-flex items-center text-txt-muted hover:text-accent"
              >
                <svg width="12" height="12" viewBox="0 0 16 16" aria-hidden>
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

// Detail-page number ball (~10% smaller than the design's 34px) — used in the ticket rows.
function Ball({ children, bonus }: { children: React.ReactNode; bonus?: boolean }) {
  return (
    <span
      className={`flex h-[31px] w-[31px] shrink-0 items-center justify-center rounded-full font-mono text-[12px] ${
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
