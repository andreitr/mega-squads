// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IJackpot} from "./interfaces/IJackpot.sol";
import {IRandomTicketBuyer} from "./interfaces/IRandomTicketBuyer.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {Ownable2Step} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/**
 * @title  Squads
 * @notice On-chain lottery pools layered on the Megapot protocol (Base, chain ID 8453).
 *
 *         An organizer creates a pool, buys Megapot tickets and adds them to it, then
 *         locks it. Once locked the pool goes live and players buy fractional shares;
 *         after the drawing settles, winnings split pro rata across all shares. Squads
 *         takes no fee — the goal is Megapot ticket volume.
 *
 *         LIFECYCLE  (Building -> Live -> Settled)
 *           Building : organizer-only. createPool, then addTickets / addRandomTickets
 *                      (repeatable). The organizer fronts the USDC for every ticket;
 *                      Squads buys them from Megapot as both holder and referrer, and
 *                      sweeps each purchase's referral fee immediately, locking it in
 *                      the pool. No shares are sold yet.
 *           Live     : organizer calls lock() when done. The ticket set is frozen,
 *                      pricePerShare is fixed at ticketFunding / totalShares, the
 *                      organizer is granted its autoStake shares, and players may buy
 *                      shares until salesCloseTime. Share proceeds reimburse the
 *                      organizer immediately (pull-based).
 *           Settled  : after the drawing settles, anyone calls claimAndDistribute().
 *                      Unsold shares are assigned to the organizer (its risk-reward for
 *                      fronting cost), each winning ticket is claimed and measured by
 *                      USDC delta, winnings are split pro rata by totalShares, and the
 *                      pool's locked referral fees are released — to the organizer if
 *                      the pool did NOT sell out, otherwise pro rata to holders by %
 *                      held. Terminal.
 *
 *         WHY ONE CONTRACT. A pool lives for a single drawing but every pool shares
 *         identical logic, so pools are rows in a mapping keyed by (organizer,
 *         drawingId) rather than separate deployments. The trade-off is that every
 *         pool shares this contract's USDC balance, so accounting must be airtight.
 *         Two running counters — `totalClaimable` (USDC owed to holders) and
 *         `totalFeesLocked` (referral fees swept but not yet released) — make the
 *         cross-pool solvency invariant a single check:
 *
 *             totalClaimable + totalFeesLocked <= USDC.balanceOf(this)
 *
 *         RELATION TO PENNYPOT. The Megapot-facing pieces are copied from PennyPot
 *         (`andreitr/pennypot`): the IJackpot / IRandomTicketBuyer interfaces, the
 *         claim-and-measure body (claim each winner, measure the USDC balance delta
 *         rather than trusting a tier read), and the referral-fee sweep. Re-keyed from
 *         per-ticket to per-pool. Unlike PennyPot, Squads keeps NO operator reserve
 *         (organizers front their own capital) and DOES use reentrancy guards, because
 *         it moves funds across many pools sharing one balance.
 *
 *         DESIGN NOTES (deviations from the original written spec, by design):
 *           - Squads is BOTH the ticket recipient and the referrer. Megapot does not
 *             enforce recipient != referrer (verified on-chain via PennyPot), and this
 *             is what lets the contract collect and store its own referral fees.
 *           - Referral fees are swept per-purchase (immediate) and released by the
 *             sold-out rule, instead of PennyPot's per-round snapshot triad.
 *           - Win-share referral (accrued at settlement) is swept into the settling
 *             pool in claimAndDistribute. Because Megapot keeps ONE aggregate referral
 *             balance, a settled pool's win-share could in principle be swept by a
 *             concurrent addTickets on another pool before its own claimAndDistribute.
 *             This never affects solvency (USDC is conserved; the invariant always
 *             holds) — only, rarely, the attribution of a secondary win-share amount.
 *
 *         Ownership and pause use OpenZeppelin's Ownable2Step + Pausable.
 */
contract Squads is Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // -----------------------------------------------------------------------
    // Constants
    // -----------------------------------------------------------------------

    /// @notice Minimum gap required between a pool's salesCloseTime and the drawing's
    ///         drawingTime. Kills last-second front-running of a near-certain outcome.
    uint256 public constant MIN_SELLING_WINDOW = 1 hours;

    uint256 internal constant BPS_DENOMINATOR = 10_000;

    /// @notice Megapot's per-call ticket cap (buyTickets reverts with InvalidTicketCount
    ///         for arrays > 10). Each add buys at most this many; organizers call repeatedly.
    uint256 public constant MEGAPOT_MAX_BATCH = 10;

    /// @notice Upper bound on tickets in one pool. Bounds the claim loop in claimAndDistribute.
    uint256 public constant MAX_POOL_TICKETS = 100;

    /// @notice Upper bound on totalShares. Bounds the distribution loop (holders <= shares).
    uint256 public constant MAX_TOTAL_SHARES = 1_000;

    /// @notice Single-referrer weight passed to Megapot. The split is 1e18-scale and must
    ///         sum to exactly 1e18, so one 100% referrer uses the full weight.
    uint256 internal constant REFERRAL_SPLIT_FULL = 1e18;

    /// @notice Integration source tag for Megapot analytics (keccak256 of the app name).
    bytes32 public constant SOURCE = keccak256("squads");

    // -----------------------------------------------------------------------
    // Immutables
    // -----------------------------------------------------------------------

    IERC20 public immutable USDC;
    IJackpot public immutable JACKPOT;

    /// @notice Megapot's quick-pick buyer, used by addRandomTickets (the Jackpot has no
    ///         working quick-pick of its own).
    IRandomTicketBuyer public immutable RANDOM_BUYER;

    // -----------------------------------------------------------------------
    // State
    // -----------------------------------------------------------------------

    enum State {
        None,
        Building,
        Live,
        Settled
    }

    struct Pool {
        address organizer;
        State state;
        bool soldOut;
        uint256 drawingId;
        uint256 totalShares;
        uint256 reserveBps; // organizer-chosen reserve, in basis points of totalShares; set at creation
        uint256 sharesForSale; // totalShares - reserveShares; set at lock
        uint256 sharesSold; // shares bought by players during Live
        uint256 reserveShares; // shares the organizer keeps off the market (carved out); set at lock
        uint256 ticketCount;
        uint64 salesCloseTime;
        uint256 ticketFunding; // USDC the organizer fronted for tickets
        uint256 pricePerShare; // fixed at lock = ticketFunding / totalShares
        uint256 totalWinnings; // set at distribution
        uint256 feesCollected; // referral fees swept, locked until release
        uint256[] ticketIds; // Megapot NFTs held for this pool
        address[] holders; // distinct share holders, in first-acquire order
        mapping(address => bool) isHolder;
        mapping(address => uint256) shares;
        mapping(address => uint256) claimable; // pull-based: reimbursement + winnings + released fees
    }

    /// @notice Every pool, keyed by keccak256(organizer, drawingId).
    mapping(bytes32 => Pool) internal pools;

    /// @notice organizer => drawingIds they have created a pool for (leaderboard source).
    mapping(address => uint256[]) internal history;

    /// @notice Sum of every pool's outstanding `claimable`. Half of the solvency invariant.
    uint256 public totalClaimable;

    /// @notice Sum of every pool's swept-but-unreleased referral fees. Other half of the invariant.
    uint256 public totalFeesLocked;

    // -----------------------------------------------------------------------
    // Events
    // -----------------------------------------------------------------------

    event PoolCreated(
        address indexed organizer,
        uint256 indexed drawingId,
        uint256 totalShares,
        uint256 reserveBps,
        uint64 salesCloseTime,
        string name
    );
    event TicketsAdded(
        address indexed organizer, uint256 indexed drawingId, uint256 count, uint256 newTicketCount, uint256 feeSwept
    );
    event PoolLocked(
        address indexed organizer,
        uint256 indexed drawingId,
        uint256 ticketFunding,
        uint256 pricePerShare,
        uint256 sharesForSale,
        uint256 reserveShares
    );
    event SharesPurchased(
        address indexed organizer,
        uint256 indexed drawingId,
        address indexed holder,
        address payer,
        uint256 amount,
        uint256 newSharesSold
    );
    event Distributed(
        address indexed organizer, uint256 indexed drawingId, uint256 totalWinnings, bool soldOut, uint256 feesReleased
    );
    event Withdrawn(address indexed organizer, uint256 indexed drawingId, address indexed account, uint256 amount);
    event PoolCancelled(address indexed organizer, uint256 indexed drawingId);

    // -----------------------------------------------------------------------
    // Errors
    // -----------------------------------------------------------------------

    error ZeroAddress();
    error InvalidShares();
    error InvalidReserve();
    error InvalidTicketCount();
    error TooManyTickets();
    error PoolExists();
    error PoolNotFound();
    error WrongState();
    error DrawingNotOpen();
    error DrawingNotSettled();
    error SettlementInProgress();
    error SalesClosed();
    error SellingWindowTooTight();
    error ExceedsForSale();
    error NoTickets();
    error TicketsAlreadyBought();
    error ZeroAmount();
    error NothingToWithdraw();

    // -----------------------------------------------------------------------
    // Constructor
    // -----------------------------------------------------------------------

    /// @param _usdc        Base mainnet USDC address.
    /// @param _jackpot     Megapot Jackpot contract (buy + claim + reads).
    /// @param _randomBuyer Megapot JackpotRandomTicketBuyer (quick-pick purchases).
    /// @param _owner       Admin address (pause only). Zero reverts via OZ Ownable.
    constructor(address _usdc, address _jackpot, address _randomBuyer, address _owner) Ownable(_owner) {
        if (_usdc == address(0) || _jackpot == address(0) || _randomBuyer == address(0)) {
            revert ZeroAddress();
        }
        USDC = IERC20(_usdc);
        JACKPOT = IJackpot(_jackpot);
        RANDOM_BUYER = IRandomTicketBuyer(_randomBuyer);

        // Both the Jackpot (explicit-pick buyTickets) and the random buyer pull USDC on
        // each purchase; claims push to us, so they need no approval.
        IERC20(_usdc).forceApprove(_jackpot, type(uint256).max);
        IERC20(_usdc).forceApprove(_randomBuyer, type(uint256).max);
    }

    // -----------------------------------------------------------------------
    // Building: create + add tickets
    // -----------------------------------------------------------------------

    /// @notice Create a pool for the current open drawing. The organizer is msg.sender;
    ///         one pool per (organizer, drawingId). No funds move here — tickets are
    ///         bought via {addTickets} / {addRandomTickets}.
    /// @param drawingId      Must equal Megapot's current (open) drawing id.
    /// @param totalShares    Fixed share supply (e.g. 100 = one share per 1%). 1..MAX_TOTAL_SHARES.
    /// @param reserveBps     The percentage of the pool (in basis points) the organizer keeps for
    ///                       themselves and does not sell. 0 is valid (sell the whole pool); must
    ///                       be < 100% so at least one share is left for players to buy. The
    ///                       organizer pays for the reserve via foregone reimbursement (carve-out).
    /// @param salesCloseTime When share sales close. Must leave >= MIN_SELLING_WINDOW before drawingTime.
    /// @param name           Display name; emitted only.
    function createPool(
        uint256 drawingId,
        uint256 totalShares,
        uint256 reserveBps,
        uint64 salesCloseTime,
        string calldata name
    ) external whenNotPaused {
        if (totalShares == 0 || totalShares > MAX_TOTAL_SHARES) revert InvalidShares();
        // Reserve must leave at least one share to sell; 100%+ is not a pool. (reserveBps strictly
        // below 100% guarantees sharesForSale >= 1, since floor(totalShares*reserveBps/BPS) < totalShares.)
        if (reserveBps >= BPS_DENOMINATOR) revert InvalidReserve();

        Pool storage p = pools[_key(msg.sender, drawingId)];
        if (p.state != State.None) revert PoolExists();
        if (drawingId != JACKPOT.currentDrawingId()) revert DrawingNotOpen();

        IJackpot.DrawingState memory ds = JACKPOT.getDrawingState(drawingId);
        if (salesCloseTime <= block.timestamp) revert SalesClosed();
        if (uint256(salesCloseTime) + MIN_SELLING_WINDOW > ds.drawingTime) revert SellingWindowTooTight();

        p.organizer = msg.sender;
        p.drawingId = drawingId;
        p.totalShares = totalShares;
        p.reserveBps = reserveBps;
        p.salesCloseTime = salesCloseTime;
        p.state = State.Building;

        history[msg.sender].push(drawingId);
        emit PoolCreated(msg.sender, drawingId, totalShares, reserveBps, salesCloseTime, name);
    }

    /// @notice Buy `tickets` explicit-pick Megapot tickets (1..10) and add them to the pool.
    ///         Pulls `ticketPrice * count` USDC from the organizer, buys with Squads as both
    ///         holder and referrer, and sweeps the purchase's referral fee into the pool.
    ///         Repeatable while Building, up to MAX_POOL_TICKETS total.
    function addTickets(uint256 drawingId, IJackpot.Ticket[] calldata tickets) external nonReentrant whenNotPaused {
        uint256 count = tickets.length;
        if (count == 0 || count > MEGAPOT_MAX_BATCH) revert InvalidTicketCount();

        Pool storage p = _buildingPool(drawingId, count);
        uint256 cost = _pullTicketFunding(p, drawingId, count);

        (address[] memory referrers, uint256[] memory split) = _selfReferral();
        uint256[] memory ids = JACKPOT.buyTickets(tickets, address(this), referrers, split, SOURCE);
        for (uint256 i = 0; i < ids.length; i++) {
            p.ticketIds.push(ids[i]);
        }

        _afterTicketBuy(p, drawingId, count, cost);
    }

    /// @notice Buy `count` quick-pick Megapot tickets (1..10) via the random buyer and add
    ///         them to the pool. Same funding + referral-sweep flow as {addTickets}.
    function addRandomTickets(uint256 drawingId, uint256 count) external nonReentrant whenNotPaused {
        if (count == 0 || count > MEGAPOT_MAX_BATCH) revert InvalidTicketCount();

        Pool storage p = _buildingPool(drawingId, count);
        uint256 cost = _pullTicketFunding(p, drawingId, count);

        (address[] memory referrers, uint256[] memory split) = _selfReferral();
        uint256[] memory ids = RANDOM_BUYER.buyTickets(count, address(this), referrers, split, SOURCE);
        for (uint256 i = 0; i < ids.length; i++) {
            p.ticketIds.push(ids[i]);
        }

        _afterTicketBuy(p, drawingId, count, cost);
    }

    /// @dev Load a Building pool owned by msg.sender and check the ticket cap + open drawing.
    function _buildingPool(uint256 drawingId, uint256 count) internal view returns (Pool storage p) {
        p = _pool(msg.sender, drawingId);
        if (p.state != State.Building) revert WrongState();
        if (p.ticketCount + count > MAX_POOL_TICKETS) revert TooManyTickets();
        // Tickets must land in this pool's drawing, so it must still be the open one.
        if (JACKPOT.currentDrawingId() != drawingId) revert DrawingNotOpen();
    }

    /// @dev Pull `ticketPrice * count` USDC from the organizer into the contract.
    function _pullTicketFunding(Pool storage, uint256 drawingId, uint256 count) internal returns (uint256 cost) {
        uint256 price = JACKPOT.getDrawingState(drawingId).ticketPrice;
        cost = price * count;
        USDC.safeTransferFrom(msg.sender, address(this), cost);
    }

    /// @dev Update pool ticket accounting and sweep the just-accrued referral fee.
    function _afterTicketBuy(Pool storage p, uint256 drawingId, uint256 count, uint256 cost) internal {
        p.ticketCount += count;
        p.ticketFunding += cost;
        uint256 swept = _sweepReferralFees(p);
        emit TicketsAdded(p.organizer, drawingId, count, p.ticketCount, swept);
    }

    // -----------------------------------------------------------------------
    // Lock: freeze the ticket set, fix the price, go live
    // -----------------------------------------------------------------------

    /// @notice Organizer locks the pool: ticket set frozen, pricePerShare fixed, the chosen
    ///         reserve carved out, and the pool goes Live so players can buy. Requires >= 1 ticket.
    function lock(uint256 drawingId) external whenNotPaused {
        Pool storage p = _pool(msg.sender, drawingId);
        if (p.state != State.Building) revert WrongState();
        if (p.ticketCount == 0) revert NoTickets();
        _goLive(p);
        emit PoolLocked(msg.sender, drawingId, p.ticketFunding, p.pricePerShare, p.sharesForSale, p.reserveShares);
    }

    /// @dev Building -> Live: carve the organizer's chosen reserve out of totalShares and put the
    ///      rest up for sale. Price still divides by totalShares, so the organizer is reimbursed
    ///      only on the shares that sell — the foregone reimbursement on the reserved shares is the
    ///      (intended) cost of the stake they chose to keep off the market.
    function _goLive(Pool storage p) internal {
        uint256 reserveShares = (p.totalShares * p.reserveBps) / BPS_DENOMINATOR;
        p.reserveShares = reserveShares;
        p.sharesForSale = p.totalShares - reserveShares;
        if (p.sharesForSale == 0) revert InvalidReserve(); // nothing left to sell (defensive)
        p.pricePerShare = p.ticketFunding / p.totalShares;
        if (reserveShares > 0) _addShares(p, p.organizer, reserveShares);
        p.state = State.Live;
    }

    // -----------------------------------------------------------------------
    // Live: buy shares
    // -----------------------------------------------------------------------

    /// @notice Buy `amount` shares of a live pool for yourself. Cost = amount * pricePerShare,
    ///         pulled in USDC and credited to the organizer as reimbursement.
    function buyShares(address organizer, uint256 drawingId, uint256 amount) external nonReentrant whenNotPaused {
        _buyShares(organizer, drawingId, amount, msg.sender);
    }

    /// @notice Gift `amount` shares of a live pool to `recipient` while paying from your own
    ///         wallet. Identical to {buyShares} except the shares are credited to `recipient`.
    function buySharesFor(address organizer, uint256 drawingId, uint256 amount, address recipient)
        external
        nonReentrant
        whenNotPaused
    {
        if (recipient == address(0)) revert ZeroAddress();
        _buyShares(organizer, drawingId, amount, recipient);
    }

    /// @dev Shared share-purchase logic. `holder` is credited the shares; USDC is always
    ///      pulled from msg.sender. The explicit (organizer, drawingId) key plus the Live +
    ///      salesClose checks are the stale-pointer guard: a buy can only ever land on the
    ///      intended, immutable-after-lock pool, and reverts on any state/time transition
    ///      rather than misapplying.
    function _buyShares(address organizer, uint256 drawingId, uint256 amount, address holder) internal {
        if (amount == 0) revert ZeroAmount();

        Pool storage p = _pool(organizer, drawingId);
        if (p.state != State.Live) revert WrongState();
        if (block.timestamp >= p.salesCloseTime) revert SalesClosed();
        if (p.sharesSold + amount > p.sharesForSale) revert ExceedsForSale();

        uint256 cost = amount * p.pricePerShare;
        USDC.safeTransferFrom(msg.sender, address(this), cost);

        p.sharesSold += amount;
        _addShares(p, holder, amount);
        // Proceeds reimburse the organizer, who fronted the ticket cost.
        _credit(p, organizer, cost);

        emit SharesPurchased(organizer, drawingId, holder, msg.sender, amount, p.sharesSold);
    }

    // -----------------------------------------------------------------------
    // Settle: claim winnings + distribute (permissionless)
    // -----------------------------------------------------------------------

    /// @notice Settle a pool once its drawing has been drawn. Permissionless. Claims each
    ///         winning ticket (measuring the USDC delta, never trusting a tier read), splits
    ///         winnings pro rata by totalShares (organizer absorbs unsold + autoStake), and
    ///         releases the pool's locked referral fees — to the organizer if it did NOT sell
    ///         out, otherwise to holders pro rata by % held. Dust rounds to the organizer.
    function claimAndDistribute(address organizer, uint256 drawingId) external nonReentrant {
        Pool storage p = _pool(organizer, drawingId);

        // A pool the organizer never locked still owns its tickets; finalize it to the
        // organizer (sole holder) so funds are never stranded.
        if (p.state == State.Building) {
            if (p.ticketCount == 0) revert NoTickets();
            _goLive(p);
        }
        if (p.state != State.Live) revert WrongState();

        IJackpot.DrawingState memory ds = JACKPOT.getDrawingState(drawingId);
        if (ds.winningTicket == 0) revert DrawingNotSettled();
        if (ds.jackpotLock) revert SettlementInProgress();

        // 1. Sold-out determination + assign unsold shares to the organizer, so the full
        //    totalShares is owned and the pro-rata split below is exact.
        p.soldOut = (p.sharesSold == p.sharesForSale);
        uint256 unsold = p.sharesForSale - p.sharesSold;
        if (unsold > 0) _addShares(p, organizer, unsold);

        // 2. Claim each winner; losers (tier 0 / tier 2) revert on claim, so skip them.
        uint256 totalWin = _claimWinningTickets(p);
        p.totalWinnings = totalWin;

        // 3. Winnings pro rata by totalShares; rounding dust to the organizer.
        if (totalWin > 0) _distributePro(p, organizer, totalWin);

        // 4. Sweep any win-share referral, then release ALL locked fees by the sold-out rule.
        _sweepReferralFees(p);
        uint256 fees = p.feesCollected;
        if (fees > 0) {
            p.feesCollected = 0;
            totalFeesLocked -= fees;
            if (p.soldOut) {
                _distributePro(p, organizer, fees); // holders by % held, dust to organizer
            } else {
                _credit(p, organizer, fees); // undersold -> organizer keeps the fees
            }
        }

        p.state = State.Settled;
        emit Distributed(organizer, drawingId, totalWin, p.soldOut, fees);
    }

    /// @dev Claim each of the pool's winning tickets one at a time, summing the measured
    ///      USDC balance delta. Copied from PennyPot: tier 0 (no match) and tier 2 (1 normal,
    ///      no bonusball) pay nothing and Megapot reverts on claiming them, so they're skipped.
    function _claimWinningTickets(Pool storage p) internal returns (uint256 totalWin) {
        uint256[] memory single = new uint256[](1);
        uint256 n = p.ticketIds.length;
        for (uint256 i = 0; i < n; i++) {
            single[0] = p.ticketIds[i];
            uint256 tier = JACKPOT.getTicketTierIds(single)[0];
            if (tier == 0 || tier == 2) continue;
            uint256 before = USDC.balanceOf(address(this));
            JACKPOT.claimWinnings(single);
            totalWin += USDC.balanceOf(address(this)) - before;
        }
    }

    /// @dev Credit `amount` to holders pro rata by share, rounding down, with the remainder
    ///      (dust) credited to `organizer`. Total credited equals `amount` exactly.
    function _distributePro(Pool storage p, address organizer, uint256 amount) internal {
        uint256 distributed;
        address[] storage hs = p.holders;
        uint256 n = hs.length;
        for (uint256 i = 0; i < n; i++) {
            address h = hs[i];
            uint256 part = (amount * p.shares[h]) / p.totalShares;
            _credit(p, h, part);
            distributed += part;
        }
        if (distributed < amount) _credit(p, organizer, amount - distributed);
    }

    // -----------------------------------------------------------------------
    // Withdraw (pull-based)
    // -----------------------------------------------------------------------

    /// @notice Withdraw all USDC the caller is owed from a pool: reimbursement (organizer),
    ///         winnings, and any released referral rebate. Checks-effects-interactions:
    ///         the balance is zeroed before the transfer.
    function withdraw(address organizer, uint256 drawingId) external nonReentrant {
        Pool storage p = _pool(organizer, drawingId);
        uint256 amount = p.claimable[msg.sender];
        if (amount == 0) revert NothingToWithdraw();

        p.claimable[msg.sender] = 0;
        totalClaimable -= amount;
        USDC.safeTransfer(msg.sender, amount);

        emit Withdrawn(organizer, drawingId, msg.sender, amount);
    }

    // -----------------------------------------------------------------------
    // Cancel
    // -----------------------------------------------------------------------

    /// @notice Cancel a pool that has not bought any tickets yet, freeing the
    ///         (organizer, drawingId) slot. Once tickets are bought the USDC is committed to
    ///         Megapot and cannot be refunded, so the organizer must lock and play instead.
    function cancel(uint256 drawingId) external nonReentrant {
        Pool storage p = _pool(msg.sender, drawingId);
        if (p.state != State.Building) revert WrongState();
        if (p.ticketCount != 0) revert TicketsAlreadyBought();
        delete pools[_key(msg.sender, drawingId)];
        emit PoolCancelled(msg.sender, drawingId);
    }

    // -----------------------------------------------------------------------
    // Owner functions
    // -----------------------------------------------------------------------

    /// @notice Emergency stop: blocks createPool, addTickets, addRandomTickets, lock, and
    ///         share buys. claimAndDistribute, withdraw, and cancel stay open so funds are
    ///         never trapped.
    function pause() external onlyOwner {
        _pause();
    }

    /// @notice Resume after a pause.
    function unpause() external onlyOwner {
        _unpause();
    }

    // -----------------------------------------------------------------------
    // Internal helpers
    // -----------------------------------------------------------------------

    function _key(address organizer, uint256 drawingId) internal pure returns (bytes32) {
        return keccak256(abi.encode(organizer, drawingId));
    }

    function _pool(address organizer, uint256 drawingId) internal view returns (Pool storage p) {
        p = pools[_key(organizer, drawingId)];
        if (p.state == State.None) revert PoolNotFound();
    }

    function _selfReferral() internal view returns (address[] memory referrers, uint256[] memory split) {
        referrers = new address[](1);
        referrers[0] = address(this);
        split = new uint256[](1);
        split[0] = REFERRAL_SPLIT_FULL;
    }

    /// @dev Record `amount` shares for `holder`, tracking distinct holders for distribution.
    function _addShares(Pool storage p, address holder, uint256 amount) internal {
        if (!p.isHolder[holder]) {
            p.isHolder[holder] = true;
            p.holders.push(holder);
        }
        p.shares[holder] += amount;
    }

    /// @dev Credit pull-based USDC to `account`, keeping the global solvency counter in sync.
    function _credit(Pool storage p, address account, uint256 amount) internal {
        if (amount == 0) return;
        p.claimable[account] += amount;
        totalClaimable += amount;
    }

    /// @dev Claim Squads' accrued Megapot referral fees into this pool's locked fee balance.
    ///      Guards the zero case (Megapot's claimReferralFees reverts on a zero balance) and
    ///      measures the real USDC delta, so the locked amount can never exceed what was paid.
    function _sweepReferralFees(Pool storage p) internal returns (uint256 swept) {
        if (JACKPOT.referralFees(address(this)) == 0) return 0;
        uint256 before = USDC.balanceOf(address(this));
        JACKPOT.claimReferralFees();
        swept = USDC.balanceOf(address(this)) - before;
        p.feesCollected += swept;
        totalFeesLocked += swept;
    }

    // -----------------------------------------------------------------------
    // Views
    // -----------------------------------------------------------------------

    /// @notice Scalar snapshot of a pool. Reverts if no pool exists at (organizer, drawingId).
    function getPool(address organizer, uint256 drawingId)
        external
        view
        returns (
            State state,
            bool soldOut,
            uint256 totalShares,
            uint256 sharesForSale,
            uint256 sharesSold,
            uint256 reserveShares,
            uint256 ticketCount,
            uint64 salesCloseTime,
            uint256 pricePerShare,
            uint256 ticketFunding,
            uint256 totalWinnings,
            uint256 feesCollected
        )
    {
        Pool storage p = _pool(organizer, drawingId);
        return (
            p.state,
            p.soldOut,
            p.totalShares,
            p.sharesForSale,
            p.sharesSold,
            p.reserveShares,
            p.ticketCount,
            p.salesCloseTime,
            p.pricePerShare,
            p.ticketFunding,
            p.totalWinnings,
            p.feesCollected
        );
    }

    /// @notice Whether a pool exists at (organizer, drawingId).
    function poolExists(address organizer, uint256 drawingId) external view returns (bool) {
        return pools[_key(organizer, drawingId)].state != State.None;
    }

    function sharesOf(address organizer, uint256 drawingId, address account) external view returns (uint256) {
        return pools[_key(organizer, drawingId)].shares[account];
    }

    function claimableOf(address organizer, uint256 drawingId, address account) external view returns (uint256) {
        return pools[_key(organizer, drawingId)].claimable[account];
    }

    /// @notice The per-pool cap table: holder addresses and their share counts.
    function getHolders(address organizer, uint256 drawingId)
        external
        view
        returns (address[] memory holders, uint256[] memory shareCounts)
    {
        Pool storage p = _pool(organizer, drawingId);
        holders = p.holders;
        shareCounts = new uint256[](holders.length);
        for (uint256 i = 0; i < holders.length; i++) {
            shareCounts[i] = p.shares[holders[i]];
        }
    }

    /// @notice Megapot ticket ids held for a pool.
    function getTicketIds(address organizer, uint256 drawingId) external view returns (uint256[] memory) {
        return _pool(organizer, drawingId).ticketIds;
    }

    /// @notice Price to buy `amount` shares of a live pool, in USDC.
    function quoteShares(address organizer, uint256 drawingId, uint256 amount) external view returns (uint256) {
        return amount * pools[_key(organizer, drawingId)].pricePerShare;
    }

    /// @notice Drawing ids the organizer has run pools for (leaderboard source).
    function getHistory(address organizer) external view returns (uint256[] memory) {
        return history[organizer];
    }

    function historyLength(address organizer) external view returns (uint256) {
        return history[organizer].length;
    }

    /// @notice The cross-pool solvency check: true iff outstanding liabilities are fully
    ///         backed by the contract's USDC balance. Should always hold.
    function isSolvent() external view returns (bool) {
        return totalClaimable + totalFeesLocked <= USDC.balanceOf(address(this));
    }
}
