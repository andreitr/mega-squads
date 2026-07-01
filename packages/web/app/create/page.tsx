"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ConnectKitButton } from "connectkit";
import { toast } from "sonner";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { base } from "wagmi/chains";
import { TopBar } from "@/components/TopBar";
import { TicketsEditor } from "@/components/TicketsEditor";
import { ReserveSlider } from "@/components/ReserveSlider";
import { squadsAbi, erc20Abi } from "@/lib/abis";
import { SQUADS_ADDRESS, USDC_ADDRESS } from "@/lib/addresses";
import { useCurrentDrawing, useUsdc } from "@/lib/hooks";
import { randomTicket, toContractTickets, isCompleteTicket, type Ticket, DEFAULT_BALL_MAX, DEFAULT_BONUSBALL_MAX } from "@/lib/tickets";
import { formatUsdc } from "@/lib/format";

const NAME_MAX = 30;
type Step = "idle" | "approving" | "creating" | "live";

export default function CreatePage() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const { writeContractAsync } = useWriteContract();

  const { drawingId, ticketPrice, ballMax, bonusballMax } = useCurrentDrawing();
  const { allowance, refetch: refetchUsdc } = useUsdc(address);

  const [tickets, setTickets] = useState<Ticket[]>([]);
  const [name, setName] = useState("");

  // Seed the first ticket once the live ball ranges have loaded from the contract,
  // so the auto-generated pick respects the drawing's ballMax/bonusballMax.
  useEffect(() => {
    if (tickets.length === 0 && ballMax !== undefined && bonusballMax !== undefined) {
      setTickets([randomTicket(ballMax, bonusballMax)]);
    }
  }, [tickets.length, ballMax, bonusballMax]);
  const [reserve, setReserve] = useState(2.5);
  const [step, setStep] = useState<Step>("idle");
  const [copied, setCopied] = useState(false);

  const price = ticketPrice ?? 1_000_000n; // $1 fallback for display before the read lands
  const cost = price * BigInt(tickets.length);
  const reserveBps = Math.round(reserve * 100);
  const onBase = chainId === base.id;
  const resolvedBallMax = ballMax ?? DEFAULT_BALL_MAX;
  const resolvedBonusballMax = bonusballMax ?? DEFAULT_BONUSBALL_MAX;
  const allTicketsValid =
    tickets.length > 0 && tickets.every((t) => isCompleteTicket(t, resolvedBallMax, resolvedBonusballMax));
  const canCreate = name.trim().length > 0 && allTicketsValid && onBase && drawingId !== undefined;

  const poolHref = address && drawingId !== undefined ? `/pool/${address}/${drawingId}` : "/portfolio";
  const inviteLink = useMemo(() => {
    if (typeof window === "undefined" || !address || drawingId === undefined) return "";
    return `${window.location.origin}${poolHref}`;
  }, [address, drawingId, poolHref]);

  async function handleCreate() {
    if (!address || !publicClient || drawingId === undefined) return;
    const toastId = "create";
    try {
      if ((allowance ?? 0n) < cost) {
        setStep("approving");
        toast.loading("Approve USDC…", { id: toastId });
        const hash = await writeContractAsync({
          address: USDC_ADDRESS,
          abi: erc20Abi,
          functionName: "approve",
          args: [SQUADS_ADDRESS, cost],
        });
        await publicClient.waitForTransactionReceipt({ hash });
        await refetchUsdc();
      }

      setStep("creating");
      toast.loading(`Funding & activating — ${formatUsdc(cost)}…`, { id: toastId });
      // One transaction: create the pool, buy its tickets, and open it for shares.
      const createHash = await writeContractAsync({
        address: SQUADS_ADDRESS,
        abi: squadsAbi,
        functionName: "createPoolWithTicketsAndLock",
        args: [drawingId, toContractTickets(tickets), BigInt(reserveBps), name.trim()],
      });
      await publicClient.waitForTransactionReceipt({ hash: createHash });

      toast.success(`${name.trim()} is live!`, { id: toastId, duration: 5000 });
      setStep("live");
    } catch (e) {
      toast.error(txError(e), { id: toastId });
      setStep("idle");
    }
  }

  return (
    <main className="relative">
      <TopBar />
      <div className="mx-auto w-full max-w-[980px] px-4 py-[30px] sm:px-7">
        <div className="mb-[22px] flex items-center gap-[13px]">
          <Link
            href="/"
            className="flex h-[38px] w-[38px] items-center justify-center rounded-full border border-white/[0.08] bg-raised text-txt"
            aria-label="Back"
          >
            <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
              <path d="M10 3 L5 8 L10 13" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </Link>
          <h1 className="text-[24px] font-bold tracking-[-0.4px] text-txt">Create a pool</h1>
        </div>

        {step === "live" ? (
          <PostCreate
            name={name}
            summary={`${tickets.length} ticket${tickets.length === 1 ? "" : "s"} · ${formatUsdc(cost)} · you keep ${reserve % 1 === 0 ? reserve : reserve.toFixed(1)}%`}
            inviteLink={inviteLink}
            poolHref={poolHref}
            copied={copied}
            onCopy={() => {
              navigator.clipboard?.writeText(inviteLink);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
          />
        ) : (
          <div className="grid grid-cols-1 items-start gap-[18px] md:grid-cols-[1.05fr_0.95fr]">
            <TicketsEditor
              tickets={tickets}
              setTickets={setTickets}
              ballMax={resolvedBallMax}
              bonusballMax={resolvedBonusballMax}
            />

            <div className="flex flex-col gap-[14px]">
              <div className="rounded-card border border-white/[0.07] bg-surface p-[18px]">
                <div className="mb-3 flex items-center justify-between">
                  <span className="text-[14px] font-semibold text-txt">Pool name</span>
                  <span className={`font-mono text-[12px] ${name.length >= NAME_MAX ? "text-warn" : "text-txt-faint"}`}>
                    {name.length}/{NAME_MAX}
                  </span>
                </div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value.slice(0, NAME_MAX))}
                  placeholder="Friday Degens"
                  className="w-full rounded-box border border-white/[0.08] bg-inset px-[15px] py-[14px] text-[17px] font-semibold text-txt outline-none placeholder:text-txt-faint focus:border-accent/40"
                />

                <div className="my-[18px] h-px bg-white/[0.07]" />

                <ReserveSlider value={reserve} onChange={setReserve} />
              </div>

              {!address ? (
                <ConnectKitButton.Custom>
                  {({ show }) => (
                    <button onClick={show} className="w-full rounded-btn bg-accent py-4 font-semibold text-bg">
                      Connect wallet
                    </button>
                  )}
                </ConnectKitButton.Custom>
              ) : !onBase ? (
                <div className="rounded-btn bg-inset py-4 text-center text-[13px] text-warn">Switch to Base</div>
              ) : (
                <button
                  disabled={!canCreate || step !== "idle"}
                  onClick={handleCreate}
                  className="w-full rounded-btn bg-accent py-4 font-semibold text-bg disabled:bg-inset disabled:text-txt-faint disabled:opacity-60"
                >
                  {step === "approving"
                    ? "Approving…"
                    : step === "creating"
                      ? "Activating…"
                      : `Create & activate — ${formatUsdc(cost)}`}
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}

function PostCreate({
  name,
  summary,
  inviteLink,
  poolHref,
  copied,
  onCopy,
}: {
  name: string;
  summary: string;
  inviteLink: string;
  poolHref: string;
  copied: boolean;
  onCopy: () => void;
}) {
  const displayName = name.trim() || "Your pool";
  return (
    <div className="mx-auto max-w-[520px] pt-[6px]">
      <div className="mb-[22px] flex flex-col items-center text-center">
        <div className="mb-[18px] flex h-[72px] w-[72px] animate-pop items-center justify-center rounded-full border border-accent/40 bg-accent/[0.12]">
          <svg width="34" height="34" viewBox="0 0 24 24" aria-hidden>
            <path d="M5 12.5 L10 17.5 L19 7" stroke="#c6ff3a" strokeWidth="2.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="mb-2 text-[27px] font-bold tracking-[-0.5px] text-accent">{displayName} is live!</div>
        <div className="max-w-[380px] text-[14px] leading-[1.5] text-txt-muted">
          Friends can buy shares now. Share the link to fill it fast.
        </div>
      </div>

      <div className="mb-[14px] flex items-center gap-[14px] rounded-card border border-white/[0.07] bg-surface px-[18px] py-4">
        <div className="flex h-[46px] w-[46px] shrink-0 items-center justify-center rounded-box bg-accent/[0.12] font-mono text-[12px] font-bold text-accent">
          YOU
        </div>
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold text-txt">{displayName}</div>
          <div className="mt-[2px] font-mono text-[12px] text-txt-muted">{summary}</div>
        </div>
      </div>

      <div className="mb-4 rounded-card border border-white/[0.07] bg-surface px-[18px] py-4">
        <div className="mb-[11px] font-mono text-[11px] uppercase tracking-[1px] text-txt-faint">Invite link</div>
        <div className="flex items-center gap-[10px]">
          <div className="min-w-0 flex-1 truncate rounded-box border border-white/[0.08] bg-inset px-[13px] py-3 font-mono text-[13px] text-txt">
            {inviteLink || `${poolHref}`}
          </div>
          <button
            onClick={onCopy}
            className="shrink-0 rounded-box border border-accent/40 bg-accent/[0.12] px-4 py-3 text-[13px] font-bold text-accent"
          >
            {copied ? "Copied ✓" : "Copy"}
          </button>
        </div>
      </div>

      <Link href={poolHref} className="block w-full rounded-btn bg-accent py-4 text-center text-[15px] font-bold text-bg">
        View pool
      </Link>
      <Link href="/portfolio" className="mt-[14px] block text-center text-[13px] font-semibold text-txt-muted hover:text-txt">
        Go to my pools
      </Link>
    </div>
  );
}

function txError(e: unknown): string {
  const msg = (e as Error)?.message?.split("\n")[0] ?? "Transaction failed";
  if (/reject|denied|user/i.test(msg)) return "Wallet rejected";
  return msg.slice(0, 140);
}
