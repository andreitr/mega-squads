"use client";

import { useEffect, useState } from "react";
import type { Address } from "viem";
import { zeroAddress } from "viem";
import { usePublicClient, useReadContract, useReadContracts } from "wagmi";
import { base } from "wagmi/chains";
import { useQuery } from "@tanstack/react-query";
import { squadsAbi, jackpotAbi, erc20Abi, payoutCalcAbi } from "./abis";
import { SQUADS_ADDRESS, JACKPOT_ADDRESS, USDC_ADDRESS, SQUADS_DEPLOY_BLOCK, PAYOUT_CALC_ADDRESS } from "./addresses";
import { parsePool, visualState, type Pool, type PoolRaw, type VisualState } from "./derive";

/** The current open Megapot drawing: id + ticket price + close time + ball ranges. */
export function useCurrentDrawing() {
  const id = useReadContract({
    chainId: base.id,
    address: JACKPOT_ADDRESS,
    abi: jackpotAbi,
    functionName: "currentDrawingId",
    query: { refetchInterval: 30_000 },
  });

  const state = useReadContract({
    chainId: base.id,
    address: JACKPOT_ADDRESS,
    abi: jackpotAbi,
    functionName: "getDrawingState",
    args: id.data !== undefined ? [id.data] : undefined,
    query: { enabled: id.data !== undefined, refetchInterval: 30_000 },
  });

  const ds = state.data;
  return {
    drawingId: id.data,
    prizePool: ds?.prizePool,
    ticketPrice: ds?.ticketPrice,
    drawingTime: ds?.drawingTime,
    winningTicket: ds?.winningTicket,
    ballMax: ds?.ballMax,
    bonusballMax: ds?.bonusballMax,
    jackpotLock: ds?.jackpotLock,
    isLoading: id.isLoading || state.isLoading,
  };
}

/**
 * The headline jackpot — the top prize tier (index 11: 5 normals + bonusball) of the current
 * drawing, computed on-chain by the PayoutCalculator from the live prize pool + ball ranges.
 * This is the grand prize a single winner takes, not the total prize pool.
 */
export function useJackpotPrize() {
  const { drawingId, prizePool, ballMax, bonusballMax } = useCurrentDrawing();
  const ready = drawingId !== undefined && prizePool !== undefined && ballMax !== undefined && bonusballMax !== undefined;
  const q = useReadContract({
    chainId: base.id,
    address: PAYOUT_CALC_ADDRESS,
    abi: payoutCalcAbi,
    functionName: "getExpectedDrawingTierPayouts",
    args: ready ? [drawingId, prizePool, ballMax, bonusballMax] : undefined,
    query: { enabled: ready, refetchInterval: 30_000 },
  });
  const tiers = q.data as readonly bigint[] | undefined;
  return tiers?.[11];
}

/** A 1s-ticking `Date.now()` for live countdowns. Returns 0 until mounted (SSR-safe). */
export function useNow(intervalMs = 1000) {
  const [now, setNow] = useState(0);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

/** Drawing state for an ARBITRARY drawing id (a pool's drawing), to derive its live state. */
export function useDrawingState(drawingId?: bigint) {
  return useReadContract({
    chainId: base.id,
    address: JACKPOT_ADDRESS,
    abi: jackpotAbi,
    functionName: "getDrawingState",
    args: drawingId !== undefined ? [drawingId] : undefined,
    query: { enabled: drawingId !== undefined, refetchInterval: 30_000 },
  });
}

export type LivePool = Pool & { name?: string; reserveBps?: number; vis: VisualState };

/**
 * Every pool created for the current Megapot drawing, parsed with its visual state — discovered
 * purely from on-chain reads: PoolCreated logs filtered by the current drawingId, then a multicall
 * of getPool() per organizer. The Discover feed filters these into Live / Sold-out tabs.
 */
export function useCurrentRoundPools() {
  const publicClient = usePublicClient({ chainId: base.id });
  const { drawingId, drawingTime, winningTicket, prizePool, isLoading: drawingLoading } = useCurrentDrawing();

  // 1. PoolCreated events for this drawing (drawingId is an indexed topic, so the node filters).
  const logsQ = useQuery({
    queryKey: ["pool-created", drawingId?.toString() ?? "none"],
    enabled: Boolean(publicClient) && drawingId !== undefined,
    refetchInterval: 30_000,
    queryFn: async () => {
      const logs = await publicClient!.getContractEvents({
        address: SQUADS_ADDRESS,
        abi: squadsAbi,
        eventName: "PoolCreated",
        args: { drawingId },
        fromBlock: SQUADS_DEPLOY_BLOCK,
        toBlock: "latest",
      });
      // One pool per (organizer, drawingId); dedup by organizer, keeping the latest name/reserve.
      const byOrg = new Map<Address, { organizer: Address; name?: string; reserveBps?: number }>();
      for (const l of logs) {
        const o = l.args.organizer as Address;
        byOrg.set(o, { organizer: o, name: l.args.name, reserveBps: Number(l.args.reserveBps ?? 0) });
      }
      return [...byOrg.values()];
    },
  });

  const creates = logsQ.data ?? [];

  // 2. Read each pool's current state (batched into a single multicall).
  const poolsQ = useReadContracts({
    contracts: creates.map((c) => ({
      chainId: base.id,
      address: SQUADS_ADDRESS,
      abi: squadsAbi,
      functionName: "getPool",
      args: [c.organizer, drawingId!],
    })),
    query: { enabled: creates.length > 0 && drawingId !== undefined, refetchInterval: 15_000 },
  });

  // 3. Parse each pool + tag its visual state for this drawing. Keep pools that are open for
  //    shares (live) or sold out (still live, just full) — i.e. exclude building/settled here is
  //    left to the consumer, which filters into the Live / Sold-out tabs.
  const nowSec = Math.floor(Date.now() / 1000);
  const pools: LivePool[] = creates
    .map((c, i): LivePool | null => {
      const raw = poolsQ.data?.[i]?.result as PoolRaw | undefined;
      if (!raw) return null;
      const p = parsePool(c.organizer, drawingId!, raw);
      return { ...p, name: c.name, reserveBps: c.reserveBps, vis: visualState(p, { drawingTime, winningTicket }, nowSec) };
    })
    .filter((p): p is LivePool => p !== null && (p.vis === "live" || p.vis === "building"));

  return {
    pools,
    drawingId,
    drawingTime,
    prizePool,
    isLoading: drawingLoading || logsQ.isLoading || (creates.length > 0 && poolsQ.isLoading),
  };
}

/** USDC balance + allowance to the Squads contract for `user`. */
export function useUsdc(user?: Address) {
  const q = useReadContracts({
    contracts: [
      { chainId: base.id, address: USDC_ADDRESS, abi: erc20Abi, functionName: "balanceOf", args: [user ?? zeroAddress] },
      {
        chainId: base.id,
        address: USDC_ADDRESS,
        abi: erc20Abi,
        functionName: "allowance",
        args: [user ?? zeroAddress, SQUADS_ADDRESS],
      },
    ],
    query: { enabled: Boolean(user), refetchInterval: 15_000 },
  });
  return {
    balance: q.data?.[0]?.result as bigint | undefined,
    allowance: q.data?.[1]?.result as bigint | undefined,
    refetch: q.refetch,
  };
}

/** Full pool snapshot for (organizer, drawingId). */
export function usePool(organizer?: Address, drawingId?: bigint) {
  return useReadContract({
    chainId: base.id,
    address: SQUADS_ADDRESS,
    abi: squadsAbi,
    functionName: "getPool",
    args: organizer && drawingId !== undefined ? [organizer, drawingId] : undefined,
    query: { enabled: Boolean(organizer) && drawingId !== undefined, refetchInterval: 15_000 },
  });
}

/** Pool name + reserveBps for one pool, read from its PoolCreated event (getPool omits them). */
export function usePoolMeta(organizer?: Address, drawingId?: bigint) {
  const publicClient = usePublicClient({ chainId: base.id });
  const q = useQuery({
    queryKey: ["pool-meta", organizer ?? "none", drawingId?.toString() ?? "none"],
    enabled: Boolean(publicClient) && Boolean(organizer) && drawingId !== undefined,
    queryFn: async () => {
      const logs = await publicClient!.getContractEvents({
        address: SQUADS_ADDRESS,
        abi: squadsAbi,
        eventName: "PoolCreated",
        args: { organizer, drawingId },
        fromBlock: SQUADS_DEPLOY_BLOCK,
        toBlock: "latest",
      });
      const last = logs[logs.length - 1];
      return { name: last?.args.name as string | undefined, reserveBps: Number(last?.args.reserveBps ?? 0) };
    },
  });
  return { name: q.data?.name, reserveBps: q.data?.reserveBps };
}

export type Holder = { address: Address; shares: bigint };

/** Holder list for a pool (getHolders → addresses + share counts), sorted by shares desc. */
export function usePoolHolders(organizer?: Address, drawingId?: bigint) {
  const q = useReadContract({
    chainId: base.id,
    address: SQUADS_ADDRESS,
    abi: squadsAbi,
    functionName: "getHolders",
    args: organizer && drawingId !== undefined ? [organizer, drawingId] : undefined,
    query: { enabled: Boolean(organizer) && drawingId !== undefined, refetchInterval: 15_000 },
  });
  const [addrs, counts] = (q.data as readonly [readonly Address[], readonly bigint[]] | undefined) ?? [[], []];
  const holders: Holder[] = addrs
    .map((address, i) => ({ address, shares: counts[i] ?? 0n }))
    .sort((a, b) => (b.shares > a.shares ? 1 : b.shares < a.shares ? -1 : 0));
  return { holders, isLoading: q.isLoading };
}

export type PortfolioPosition = LivePool & { shares: bigint; claimable: bigint };
export type OrganizedPool = LivePool & { claimable: bigint };
export type ClaimablePosition = { organizer: Address; drawingId: bigint; claimable: bigint };

/**
 * The connected user's portfolio, read on-chain:
 *  - organized: pools the user created (getHistory) → getPool multicall.
 *  - joined: pools the user bought into (SharesPurchased logs where holder = user) →
 *    getPool + sharesOf + claimableOf multicall.
 * `claimable` is the sum of claimableOf across joined positions.
 */
export function usePortfolio(user?: Address) {
  const publicClient = usePublicClient({ chainId: base.id });
  const nowSec = Math.floor(Date.now() / 1000);

  // Pools the user hosts.
  const historyQ = useReadContract({
    chainId: base.id,
    address: SQUADS_ADDRESS,
    abi: squadsAbi,
    functionName: "getHistory",
    args: user ? [user] : undefined,
    query: { enabled: Boolean(user), refetchInterval: 30_000 },
  });
  const hostedIds = (historyQ.data as readonly bigint[] | undefined) ?? [];

  const organizedQ = useReadContracts({
    contracts: hostedIds.flatMap((id) => [
      { chainId: base.id, address: SQUADS_ADDRESS, abi: squadsAbi, functionName: "getPool", args: [user!, id] },
      { chainId: base.id, address: SQUADS_ADDRESS, abi: squadsAbi, functionName: "claimableOf", args: [user!, id, user!] },
    ]),
    query: { enabled: Boolean(user) && hostedIds.length > 0, refetchInterval: 15_000 },
  });

  // Pools the user has bought into (discover via SharesPurchased logs; holder is indexed).
  const joinedLogsQ = useQuery({
    queryKey: ["shares-purchased", user ?? "none"],
    enabled: Boolean(publicClient) && Boolean(user),
    refetchInterval: 30_000,
    queryFn: async () => {
      const logs = await publicClient!.getContractEvents({
        address: SQUADS_ADDRESS,
        abi: squadsAbi,
        eventName: "SharesPurchased",
        args: { holder: user },
        fromBlock: SQUADS_DEPLOY_BLOCK,
        toBlock: "latest",
      });
      const seen = new Map<string, { organizer: Address; drawingId: bigint }>();
      for (const l of logs) {
        const organizer = l.args.organizer as Address;
        const dId = l.args.drawingId as bigint;
        seen.set(`${organizer}-${dId}`, { organizer, drawingId: dId });
      }
      return [...seen.values()];
    },
  });
  const joinedRefs = joinedLogsQ.data ?? [];

  const joinedQ = useReadContracts({
    contracts: joinedRefs.flatMap((r) => [
      { chainId: base.id, address: SQUADS_ADDRESS, abi: squadsAbi, functionName: "getPool", args: [r.organizer, r.drawingId] },
      { chainId: base.id, address: SQUADS_ADDRESS, abi: squadsAbi, functionName: "sharesOf", args: [r.organizer, r.drawingId, user!] },
      { chainId: base.id, address: SQUADS_ADDRESS, abi: squadsAbi, functionName: "claimableOf", args: [r.organizer, r.drawingId, user!] },
    ]),
    query: { enabled: Boolean(user) && joinedRefs.length > 0, refetchInterval: 15_000 },
  });

  // Names live on PoolCreated events; fetch all in one pass and look up by (organizer, drawingId).
  const namesQ = useQuery({
    queryKey: ["pool-names-all"],
    enabled: Boolean(publicClient) && Boolean(user),
    refetchInterval: 60_000,
    queryFn: async () => {
      const logs = await publicClient!.getContractEvents({
        address: SQUADS_ADDRESS,
        abi: squadsAbi,
        eventName: "PoolCreated",
        fromBlock: SQUADS_DEPLOY_BLOCK,
        toBlock: "latest",
      });
      const map: Record<string, string> = {};
      for (const l of logs) {
        const key = `${(l.args.organizer as Address).toLowerCase()}-${l.args.drawingId as bigint}`;
        map[key] = (l.args.name as string) ?? "";
      }
      return map;
    },
  });
  const nameOf = (organizer: Address, dId: bigint) => namesQ.data?.[`${organizer.toLowerCase()}-${dId}`];

  // A portfolio spans many drawings, so each pool's Live/Locked/Settled must be judged against ITS
  // OWN drawing's time + winning ticket (not the current drawing). Read each distinct drawing once.
  const drawingIds = [...new Set([...joinedRefs.map((r) => r.drawingId.toString()), ...hostedIds.map((id) => id.toString())])];
  const drawingStatesQ = useReadContracts({
    contracts: drawingIds.map((id) => ({
      chainId: base.id,
      address: JACKPOT_ADDRESS,
      abi: jackpotAbi,
      functionName: "getDrawingState",
      args: [BigInt(id)],
    })),
    query: { enabled: drawingIds.length > 0, refetchInterval: 30_000 },
  });
  const drawingStateOf = (dId: bigint) => {
    const idx = drawingIds.indexOf(dId.toString());
    const ds = idx >= 0 ? (drawingStatesQ.data?.[idx]?.result as { drawingTime?: bigint; winningTicket?: bigint } | undefined) : undefined;
    return { drawingTime: ds?.drawingTime, winningTicket: ds?.winningTicket };
  };

  const organized: OrganizedPool[] = hostedIds
    .map((id, i): OrganizedPool | null => {
      const raw = organizedQ.data?.[i * 2]?.result as PoolRaw | undefined;
      if (!raw || !user) return null;
      const claimable = (organizedQ.data?.[i * 2 + 1]?.result as bigint | undefined) ?? 0n;
      const p = parsePool(user, id, raw);
      return { ...p, name: nameOf(user, id), vis: visualState(p, drawingStateOf(id), nowSec), claimable };
    })
    .filter((p): p is OrganizedPool => p !== null && p.state !== 0)
    // Newest round first.
    .sort((a, b) => (b.drawingId > a.drawingId ? 1 : b.drawingId < a.drawingId ? -1 : 0));

  const joined: PortfolioPosition[] = joinedRefs
    .map((r, i): PortfolioPosition | null => {
      const raw = joinedQ.data?.[i * 3]?.result as PoolRaw | undefined;
      if (!raw) return null;
      const shares = (joinedQ.data?.[i * 3 + 1]?.result as bigint | undefined) ?? 0n;
      const claimable = (joinedQ.data?.[i * 3 + 2]?.result as bigint | undefined) ?? 0n;
      const p = parsePool(r.organizer, r.drawingId, raw);
      return { ...p, name: nameOf(r.organizer, r.drawingId), vis: visualState(p, drawingStateOf(r.drawingId), nowSec), shares, claimable };
    })
    .filter((p): p is PortfolioPosition => p !== null && p.state !== 0);

  // Claimable across BOTH joined positions and hosted pools, deduped by (organizer, drawingId) so a
  // pool the user both hosted and bought into isn't counted twice (claimableOf is the same value).
  const claimableByPool = new Map<string, ClaimablePosition>();
  for (const j of joined) {
    if (j.claimable > 0n) claimableByPool.set(`${j.organizer.toLowerCase()}-${j.drawingId}`, { organizer: j.organizer, drawingId: j.drawingId, claimable: j.claimable });
  }
  for (const o of organized) {
    if (o.claimable > 0n) claimableByPool.set(`${o.organizer.toLowerCase()}-${o.drawingId}`, { organizer: o.organizer, drawingId: o.drawingId, claimable: o.claimable });
  }
  const claimablePositions = [...claimableByPool.values()];
  const claimable = claimablePositions.reduce((sum, p) => sum + p.claimable, 0n);

  return {
    organized,
    joined,
    claimable,
    claimablePositions,
    isLoading:
      historyQ.isLoading ||
      joinedLogsQ.isLoading ||
      (hostedIds.length > 0 && organizedQ.isLoading) ||
      (joinedRefs.length > 0 && joinedQ.isLoading),
  };
}
