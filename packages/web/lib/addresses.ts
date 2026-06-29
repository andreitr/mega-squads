import type { Address } from "viem";

const env = process.env;

// The Squads (Mega Pools) contract on Base — the redeploy that includes createPoolWithTickets
// (the custom-picks entrypoint the Create flow uses). Override via NEXT_PUBLIC_SQUADS_ADDRESS.
export const SQUADS_ADDRESS = (env.NEXT_PUBLIC_SQUADS_ADDRESS ??
  "0x76803dc823f11c3fe5b571ad675a563290922f2d") as Address;

export const USDC_ADDRESS = (env.NEXT_PUBLIC_USDC_ADDRESS ??
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as Address;

// Megapot Jackpot — read for the live drawing (ticketPrice, drawingTime, winningTicket, ball ranges).
export const JACKPOT_ADDRESS = (env.NEXT_PUBLIC_JACKPOT_ADDRESS ??
  "0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2") as Address;

// Floor block for PoolCreated log queries (the contract's deploy block — keeps getLogs fast and
// within RPC range limits). 0x76803d…2f2d was created at block 47975349 on Base.
export const SQUADS_DEPLOY_BLOCK = BigInt(env.NEXT_PUBLIC_SQUADS_DEPLOY_BLOCK ?? "47975349");

export const BASE_CHAIN_ID = 8453;
