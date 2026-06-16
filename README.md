# Squads

On-chain lottery pools layered on the [Megapot](https://llms.megapot.io/) protocol
(Base, chain ID 8453). An organizer funds a pool of Megapot tickets, players buy
fractional shares, and each 24-hour drawing's winnings split pro rata across the shares.
Squads captures **no fee** — the goal is Megapot ticket volume.

```
Organizer ──creates──▶ buys tickets ──locks──▶ Players buy shares ──drawing settles──▶ winnings split pro rata
```

## Monorepo

A pnpm workspace mirroring the [PennyPot](https://github.com/andreitr/pennypot) layout:

| Package | What |
|---|---|
| [`packages/contracts`](packages/contracts) | The `Squads` Solidity contract (Foundry), tests, and deploy script. **This is the project today.** |
| [`packages/web`](packages/web) | Reserved for the frontend. Empty stub until the webapp build starts. |

## Quick start

```bash
pnpm build   # forge build in packages/contracts
pnpm test    # forge test (unit + invariant)
```

Requires [Foundry](https://book.getfoundry.sh/) and pnpm. Clone with submodules
(`forge-std`, `openzeppelin-contracts`):

```bash
git submodule update --init --recursive
```

## How it works

One singleton contract holds every pool as a row in a mapping keyed by
`(organizer, drawingId)` — no factory, no per-pool deployments. It holds the pooled USDC
and ticket NFTs, tracks share balances, and runs claim-and-distribute after each drawing
settles. Because all pools share one USDC balance, the contract maintains a strict
solvency invariant (`totalClaimable + totalFeesLocked <= balance`) that is fuzz-tested
continuously.

See [`packages/contracts/README.md`](packages/contracts/README.md) for the full lifecycle,
interface, security model, and Megapot integration details.
