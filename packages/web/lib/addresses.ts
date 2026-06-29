import type { Address } from "viem";

const env = process.env;

// The Squads (Mega Pools) contract on Base. The currently-deployed instance is
// 0xb0a4…6dec, but the Create flow uses createPoolWithTickets (the custom-picks entrypoint added
// after that deploy), so set NEXT_PUBLIC_SQUADS_ADDRESS + NEXT_PUBLIC_SQUADS_DEPLOY_BLOCK to the
// REDEPLOYED contract once it's live.
export const SQUADS_ADDRESS = (env.NEXT_PUBLIC_SQUADS_ADDRESS ??
  "0xb0a41d0fff97d4b12c13e4d329813bb3e0c86dec") as Address;

export const USDC_ADDRESS = (env.NEXT_PUBLIC_USDC_ADDRESS ??
  "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913") as Address;

// Megapot Jackpot — read for the live drawing (ticketPrice, drawingTime, winningTicket, ball ranges).
export const JACKPOT_ADDRESS = (env.NEXT_PUBLIC_JACKPOT_ADDRESS ??
  "0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2") as Address;

// Floor block for PoolCreated log queries (must be the contract's deploy block to keep getLogs
// fast and within RPC range limits). Update after redeploy.
export const SQUADS_DEPLOY_BLOCK = BigInt(env.NEXT_PUBLIC_SQUADS_DEPLOY_BLOCK ?? "0");

export const BASE_CHAIN_ID = 8453;
