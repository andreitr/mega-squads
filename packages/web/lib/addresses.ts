import type { Address } from "viem";

const env = process.env;

// The Squads (Mega Pools) contract on Base — the redeploy that adds createPoolWithTicketsAndLock
// (one-step create+activate) and fixes settlement (drops the jackpotLock gate). Override via
// NEXT_PUBLIC_SQUADS_ADDRESS.
export const SQUADS_ADDRESS = (env.NEXT_PUBLIC_SQUADS_ADDRESS ??
  "0x5508e71708dbe8a65a8b283a644e00ef0fabe4d3") as Address;

export const USDC_ADDRESS = (env.NEXT_PUBLIC_USDC_ADDRESS ??
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as Address;

// Megapot Jackpot — read for the live drawing (ticketPrice, drawingTime, winningTicket, ball ranges).
export const JACKPOT_ADDRESS = (env.NEXT_PUBLIC_JACKPOT_ADDRESS ??
  "0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2") as Address;

// Megapot GuaranteedMinimumPayoutCalculator — computes the per-tier payouts for a drawing. The
// headline "jackpot" is the top tier (index 11 = 5 normals + bonusball) of getExpectedDrawingTierPayouts.
export const PAYOUT_CALC_ADDRESS = (env.NEXT_PUBLIC_PAYOUT_CALC_ADDRESS ??
  "0x97a22361b6208aC8cd9afaea09D20feC47046CBD") as Address;

// Floor block for PoolCreated log queries (the contract's deploy block — keeps getLogs fast and
// within RPC range limits). 0x5508…e4d3 was created at block 48042909 on Base.
export const SQUADS_DEPLOY_BLOCK = BigInt(env.NEXT_PUBLIC_SQUADS_DEPLOY_BLOCK ?? "48042909");

export const BASE_CHAIN_ID = 8453;
