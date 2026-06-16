# @squads/contracts

The `Squads` contract — on-chain lottery pools layered on [Megapot](https://llms.megapot.io/)
(Base, chain ID 8453). An organizer funds a pool of Megapot tickets, players buy
fractional shares, and winnings split pro rata when the 24-hour drawing settles. Squads
captures **no fee**; the goal is Megapot ticket volume.

Built with [Foundry](https://book.getfoundry.sh/). The Megapot-facing pieces are ported
from [PennyPot](https://github.com/andreitr/pennypot).

## Lifecycle

A pool is keyed by `(organizer, drawingId)` and moves one-way through three states:

```
Building ──lock()──▶ Live ──claimAndDistribute()──▶ Settled
```

| State | What happens |
|---|---|
| **Building** | `createPool`, then `addTickets` / `addRandomTickets` (repeatable, organizer-only). The organizer fronts the USDC for every ticket; Squads buys from Megapot as **both holder and referrer** and sweeps each purchase's referral fee immediately, locking it in the pool. No shares sold yet. |
| **Live** | The organizer calls `lock()` when done. The ticket set is frozen, `pricePerShare = ticketFunding / totalShares` is fixed, the organizer is granted its `autoStake` shares (2.5%), and players buy shares until `salesCloseTime`. Share proceeds reimburse the organizer (pull-based). |
| **Settled** | After the drawing is drawn, **anyone** calls `claimAndDistribute()`. Unsold shares are assigned to the organizer, each winning ticket is claimed and measured by USDC delta, winnings split pro rata by `totalShares`, and the locked referral fees are released — **to the organizer if the pool did NOT sell out, otherwise pro rata to holders by % held**. Terminal. |

Holders pull their winnings/rebate/reimbursement with `withdraw(organizer, drawingId)`.

## Interface

```solidity
// Building (organizer-only)
function createPool(uint256 drawingId, uint256 totalShares, uint64 salesCloseTime, string name);
function addTickets(uint256 drawingId, IJackpot.Ticket[] tickets);   // explicit picks, 1..10 per call
function addRandomTickets(uint256 drawingId, uint256 count);         // quick-pick, 1..10 per call
function lock(uint256 drawingId);                                    // freeze + go Live
function cancel(uint256 drawingId);                                  // only before any ticket is bought

// Live (anyone)
function buyShares(address organizer, uint256 drawingId, uint256 amount);
function buySharesFor(address organizer, uint256 drawingId, uint256 amount, address recipient); // gift

// Settle + withdraw (permissionless / holder)
function claimAndDistribute(address organizer, uint256 drawingId);
function withdraw(address organizer, uint256 drawingId);

// Admin (owner)
function pause();   // blocks build + buy; settle/withdraw/cancel stay open
function unpause();
```

Reads: `getPool`, `sharesOf`, `claimableOf`, `getHolders`, `getTicketIds`, `quoteShares`,
`getHistory`, `poolExists`, `isSolvent`.

## Cross-pool solvency

Every pool shares this one contract's USDC balance, so accounting is the headline risk.
Two running counters make the invariant a single check:

```
totalClaimable + totalFeesLocked  <=  USDC.balanceOf(Squads)
```

`isSolvent()` returns this on-chain. It is asserted after every state-changing path in the
unit tests and continuously in a stateful invariant run (`SquadsInvariant.t.sol`).

Other guards: `ReentrancyGuard` on every fund-mover, `SafeERC20` throughout,
checks-effects-interactions (`claimable` zeroed before transfer), integer division rounds
down with **dust swept to the organizer** and a guarantee that distributed winnings never
exceed `totalWinnings`, and a `MIN_SELLING_WINDOW` (1h) gap enforced between
`salesCloseTime` and `drawingTime` to kill last-second front-running.

## How this differs from the original written spec

The build follows the spec's section 0 reuse map but adopts a simpler lifecycle than the
spec text, per the project owner's direction:

- **No deferred `lock` that buys tickets.** The organizer buys tickets up front during
  Building and `lock()` just freezes the set and opens share sales. State machine is
  `Building → Live → Settled` (not `Funding → Locked → Settled`).
- **Referral fees are swept per-purchase** (immediate) and stored in the pool, rather than
  via PennyPot's per-round `snapshot` triad. They are released by the sold-out rule above.
- **Squads is both recipient and referrer.** Megapot does not enforce `recipient != referrer`
  (verified on-chain via PennyPot), which is what lets the contract collect and store its own
  fees. This deviates from spec §2's "organizer is the referrer."
- **No operator reserve, no `reserveShares`.** Organizers front their own capital; pricing is
  not known until `lock`, so there is no creation-time reserve purchase.
- **Organizer self-purchase is uncapped** (it still drives real Megapot volume).

### Known limitation — win-share referral attribution

Megapot keeps **one aggregate referral balance** per referrer. Purchase fees are swept
atomically inside the buy that generated them, so they attribute exactly. The *win-share*
referral accrues at Megapot settlement (outside any Squads call), so in the rare case where a
settled pool's win-share is swept by a concurrent `addTickets` on another pool before that
pool's own `claimAndDistribute`, a small win-share amount can be attributed to the wrong
pool. This **never** affects solvency — USDC is conserved and the invariant always holds — only,
rarely, the attribution of a secondary fee. Pools ≤10 tickets and prompt settlement avoid it.

## Megapot integration (confirmed signatures)

Resolved against the on-chain ABI + `https://llms.megapot.io/` (the spec's section 8):

- **Buy (explicit picks):** `Jackpot.buyTickets((uint8[] normals, uint8 bonusball)[] tickets, address recipient, address[] referrers, uint256[] referralSplit /*1e18*/, bytes32 source)` — caps at 10 per call; approve USDC to the Jackpot.
- **Buy (quick-pick):** `JackpotRandomTicketBuyer.buyTickets(uint256 count, address recipient, address[] referrers, uint256[] split, bytes32 source)` — the Jackpot has no native quick-pick.
- **Referral fees:** one aggregate `referralFees(address)` balance (purchase + win-share combined), claimed together via `claimReferralFees()` (no args, pays the full balance). Accrued balance is readable on-chain — no Data API needed for rebate math.
- **Claim winnings:** `claimWinnings(uint256[] ticketIds)` burns the NFTs and pays the caller; losing tiers (0 and 2) revert, so they are skipped and winners are claimed one at a time with USDC-delta measurement.

Canonical Base addresses: Jackpot `0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2`, USDC
`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, RandomTicketBuyer
`0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd`.

## Develop

```bash
forge build        # compile
forge test         # unit + invariant tests
forge test -vvv    # with traces
forge fmt          # format

# deploy (Base mainnet defaults; override via env)
OWNER_ADDRESS=0x... forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast --verify
```

Layout: `src/Squads.sol`, `src/interfaces/` (IJackpot, IRandomTicketBuyer — ported from
PennyPot), `test/` (unit + invariant + mocks), `script/Deploy.s.sol`.
