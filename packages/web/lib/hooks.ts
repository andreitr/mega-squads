"use client";

import type { Address } from "viem";
import { zeroAddress } from "viem";
import { useReadContract, useReadContracts } from "wagmi";
import { base } from "wagmi/chains";
import { squadsAbi, jackpotAbi, erc20Abi } from "./abis";
import { SQUADS_ADDRESS, JACKPOT_ADDRESS, USDC_ADDRESS } from "./addresses";

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
    ticketPrice: ds?.ticketPrice,
    drawingTime: ds?.drawingTime,
    winningTicket: ds?.winningTicket,
    ballMax: ds?.ballMax,
    bonusballMax: ds?.bonusballMax,
    jackpotLock: ds?.jackpotLock,
    isLoading: id.isLoading || state.isLoading,
  };
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
