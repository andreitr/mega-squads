"use client";

import { useMemo, useState } from "react";
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
import { randomTicket, toContractTickets, type Ticket, DEFAULT_BALL_MAX, DEFAULT_BONUSBALL_MAX } from "@/lib/tickets";
import { formatUsdc } from "@/lib/format";

const NAME_MAX = 30;
type Step = "idle" | "approving" | "creating" | "funded" | "opening" | "opened";

export default function CreatePage() {
  const { address, chainId } = useAccount();
  const publicClient = usePublicClient({ chainId: base.id });
  const { writeContractAsync } = useWriteContract();

  const { drawingId, ticketPrice, ballMax, bonusballMax } = useCurrentDrawing();
  const { allowance, refetch: refetchUsdc } = useUsdc(address);

  const [tickets, setTickets] = useState<Ticket[]>([randomTicket()]);
  const [name, setName] = useState("");
  const [reserve, setReserve] = useState(2.5);
  const [step, setStep] = useState<Step>("idle");
  const [copied, setCopied] = useState(false);

  const price = ticketPrice ?? 1_000_000n; // $1 fallback for display before the read lands
  const cost = price * BigInt(tickets.length);
  const reserveBps = Math.round(reserve * 100);
  const onBase = chainId === base.id;
  const canCreate = name.trim().length > 0 && tickets.length > 0 && onBase && drawingId !== undefined;

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
      toast.loading(`Funding your pool — ${formatUsdc(cost)}…`, { id: toastId });
      const createHash = await writeContractAsync({
        address: SQUADS_ADDRESS,
        abi: squadsAbi,
        functionName: "createPoolWithTickets",
        args: [drawingId, toContractTickets(tickets), BigInt(reserveBps), name.trim()],
      });
      await publicClient.waitForTransactionReceipt({ hash: createHash });

      toast.success("Your pool is funded", { id: toastId, duration: 5000 });
      setStep("funded");
    } catch (e) {
      toast.error(txError(e), { id: toastId });
      setStep("idle");
    }
  }

  async function handleOpen() {
    if (!address || !publicClient || drawingId === undefined) return;
    const toastId = "open";
    try {
      setStep("opening");
      toast.loading("Opening for shares…", { id: toastId });
      const hash = await writeContractAsync({
        address: SQUADS_ADDRESS,
        abi: squadsAbi,
        functionName: "lock",
        args: [drawingId],
      });
      await publicClient.waitForTransactionReceipt({ hash });
      toast.success(`${name.trim()} is live!`, { id: toastId, duration: 5000 });
      setStep("opened");
    } catch (e) {
      toast.error(txError(e), { id: toastId });
      setStep("funded");
    }
  }

  return (
    <main className="relative">
      <TopBar />
      <div className="mx-auto w-full max-w-[980px] px-4 py-6">
        <div className="mb-5 flex items-center gap-3">
          <Link href="/" className="flex h-9 w-9 items-center justify-center rounded-full border border-white/[0.08] text-txt-muted hover:text-txt">
            ←
          </Link>
          <h1 className="text-[24px] font-bold text-txt">Create a pool</h1>
        </div>

        {step === "funded" || step === "opened" || step === "opening" ? (
          <PostCreate
            opened={step === "opened"}
            name={name}
            inviteLink={inviteLink}
            poolHref={poolHref}
            copied={copied}
            onCopy={() => {
              navigator.clipboard?.writeText(inviteLink);
              setCopied(true);
              setTimeout(() => setCopied(false), 1600);
            }}
            onOpen={handleOpen}
            opening={step === "opening"}
          />
        ) : (
          <div className="grid grid-cols-1 gap-[18px] md:grid-cols-[1.05fr_0.95fr]">
            <TicketsEditor
              tickets={tickets}
              setTickets={setTickets}
              ballMax={ballMax ?? DEFAULT_BALL_MAX}
              bonusballMax={bonusballMax ?? DEFAULT_BONUSBALL_MAX}
            />

            <div className="space-y-4">
              <div className="rounded-card border border-white/[0.06] bg-surface p-5">
                <div className="mb-2 flex items-baseline justify-between">
                  <label className="text-[13px] text-txt-muted">Pool name</label>
                  <span className={`font-mono text-[11px] ${name.length >= NAME_MAX ? "text-warn" : "text-txt-faint"}`}>
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

                <ReserveSlider value={reserve} onChange={setReserve} ticketCount={tickets.length} />
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
                      ? "Funding…"
                      : `Create & fund — ${formatUsdc(cost)}`}
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
  opened,
  name,
  inviteLink,
  poolHref,
  copied,
  onCopy,
  onOpen,
  opening,
}: {
  opened: boolean;
  name: string;
  inviteLink: string;
  poolHref: string;
  copied: boolean;
  onCopy: () => void;
  onOpen: () => void;
  opening: boolean;
}) {
  return (
    <div className="mx-auto max-w-md rounded-card border border-white/[0.06] bg-surface p-8 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 animate-pop items-center justify-center rounded-full bg-accent text-bg">
        ✓
      </div>
      {opened ? (
        <h2 className="text-[24px] font-bold text-accent">{name} is live!</h2>
      ) : (
        <h2 className="text-[24px] font-bold text-txt">Your pool is funded</h2>
      )}

      <div className="mt-5 flex items-center gap-2 rounded-box border border-white/[0.08] bg-inset p-3">
        <span className="flex-1 truncate font-mono text-[12px] text-txt-muted">{inviteLink}</span>
        <button onClick={onCopy} className="rounded-chip bg-raised px-3 py-1 text-[12px] text-txt">
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>

      {opened ? (
        <Link href="/portfolio" className="mt-5 block rounded-btn bg-accent py-3 font-semibold text-bg">
          Go to my pools
        </Link>
      ) : (
        <button
          disabled={opening}
          onClick={onOpen}
          className="mt-5 w-full rounded-btn bg-accent py-3 font-semibold text-bg disabled:opacity-60"
        >
          {opening ? "Opening…" : "Open pool for shares"}
        </button>
      )}
      <Link href={poolHref} className="mt-3 block font-mono text-[12px] text-txt-faint hover:text-txt">
        View pool →
      </Link>
    </div>
  );
}

function txError(e: unknown): string {
  const msg = (e as Error)?.message?.split("\n")[0] ?? "Transaction failed";
  if (/reject|denied|user/i.test(msg)) return "Wallet rejected";
  return msg.slice(0, 140);
}
