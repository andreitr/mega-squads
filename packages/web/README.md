# @squads/web — Mega Pools

The frontend for **Mega Pools** (the `Squads` contract) — social/group lottery pools on Base.
A host funds a batch of Megapot tickets, keeps a configurable reserve, and sells the rest as
fractional shares; if the pool wins, the prize splits by share.

Next.js (app router) · wagmi + viem · ConnectKit · TanStack Query · Tailwind. Plumbing mirrors
[PennyPot](https://github.com/andreitr/pennypot); visuals follow the Mega Pools design handoff
(warm-dark, lime accent `#c6ff3a`, Space Grotesk + JetBrains Mono).

## Develop

```bash
pnpm install            # from the repo root (workspace)
cp packages/web/.env.example packages/web/.env.local   # then fill in values
pnpm --filter @squads/web dev
```

## Surfaces

- `/` — Discover feed (open pools)
- `/pool/[organizer]/[drawingId]` — pool detail + buy shares
- `/create` — host a pool (pick tickets, set reserve, fund)
- `/portfolio` — your hosted pools + positions
- `/leaderboard` — organizer ranking

## Notes

- Binds to the `Squads` contract via `NEXT_PUBLIC_SQUADS_ADDRESS`. The **Create** flow uses
  `createPoolWithTickets` (custom picks), added after the initial deploy — point the env at the
  **redeployed** contract + set `NEXT_PUBLIC_SQUADS_DEPLOY_BLOCK`.
- Pools have no on-chain registry; the feed/portfolio index `PoolCreated` events
  (`getLogs` from the deploy block) — see `lib/pools.ts`.
- Settlement: a permissionless "Settle & distribute" button (`claimAndDistribute`) plus a Vercel
  cron keeper (`lib/keeper.ts` + `app/api/cron/settle`).
