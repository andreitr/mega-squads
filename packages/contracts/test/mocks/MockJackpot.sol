// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IJackpot} from "../../src/interfaces/IJackpot.sol";

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
    function balanceOf(address) external view returns (uint256);
}

/**
 * @notice Minimal Megapot stand-in for unit tests. Adapted from PennyPot's MockJackpot.
 *
 *         PennyPot only ever bought quick-pick tickets through the random buyer, so its
 *         mock modeled mintTicket + claim/settle only. Squads buys explicit-pick tickets
 *         directly via `buyTickets`, so this mock adds that entrypoint and, like real
 *         Megapot, AUTO-ACCRUES the per-purchase referral fee to the referrer at buy time
 *         (rate = `referralFeeRate`, 1e18 scale). That is what makes Squads' immediate
 *         per-purchase `_sweepReferralFees` actually have something to sweep in tests.
 *
 *         Per-ticket payouts are set by the test via `setTicketTier()` + `setTierPayout()`
 *         before calling `settleDrawing()`. Win-share referral (accrued at settlement on
 *         real Megapot) is simulated by the test calling `accrueReferral()` directly.
 */
contract MockJackpot {
    uint256 public ticketPrice;
    uint256 public drawingDuration;
    uint256 public currentDrawingId;
    IERC20 public usdc;

    /// @notice Per-purchase referral fee rate, 1e18 scale (e.g. 0.1e18 = 10%). Settable.
    uint256 public referralFeeRate;

    struct DrawingData {
        uint256 drawingTime;
        uint256 winningTicket; // 0 until settled
        uint256[12] tierPayouts;
        mapping(uint256 => uint256) ticketTier; // megaTicketId => tier (0-11)
        mapping(uint256 => address) ticketOwner;
        mapping(uint256 => bool) claimed;
    }

    mapping(uint256 => DrawingData) internal drawingsData;
    uint256 internal nextTicketId = 1;

    // Track referral fees accrued per address (mirrors Megapot's public `referralFees`).
    mapping(address => uint256) public referralFees;

    // Global ticket owner across drawings — backs ownerOf(), so this mock can double as the
    // JackpotTicketNFT for Squads' batch ticket ownership checks.
    mapping(uint256 => address) internal _ticketOwners;

    constructor(address _usdc, uint256 _ticketPrice, uint256 _drawingDuration) {
        usdc = IERC20(_usdc);
        ticketPrice = _ticketPrice;
        drawingDuration = _drawingDuration;
        currentDrawingId = 1;
        drawingsData[1].drawingTime = block.timestamp + _drawingDuration;
        referralFeeRate = 0.1e18; // 10% default, matching Megapot's primary-sales referral fee
    }

    // ---- IJackpot surface --------------------------------------------------

    /// @notice Buy 1..10 explicit-pick tickets, minting NFTs to `_recipient` under the current
    ///         drawing. Pulls `ticketPrice * count` USDC from the caller (Squads) and accrues the
    ///         per-purchase referral fee to `_referrers` per `_referralSplit` (1e18 scale).
    function buyTickets(
        IJackpot.Ticket[] calldata _tickets,
        address _recipient,
        address[] calldata _referrers,
        uint256[] calldata _referralSplit,
        bytes32 /* _source */
    ) external returns (uint256[] memory ids) {
        require(_recipient != address(0), "bad recipient");
        uint256 count = _tickets.length;
        require(count > 0 && count <= 10, "InvalidTicketCount");

        uint256 total = ticketPrice * count;
        require(usdc.transferFrom(msg.sender, address(this), total), "USDC pull failed");

        _accrueReferral(_referrers, _referralSplit, total);

        ids = new uint256[](count);
        for (uint256 i = 0; i < count; i++) {
            ids[i] = _mint(_recipient);
        }
    }

    /// @notice Mint a ticket to `recipient` under the current drawing. Called by the
    ///         MockRandomTicketBuyer, mirroring Megapot minting a quick-pick ticket NFT.
    function mintTicket(address recipient) external returns (uint256 id) {
        id = _mint(recipient);
    }

    /// @notice Accrue the per-purchase referral fee for a quick-pick buy of `count` tickets.
    ///         Called by the MockRandomTicketBuyer so the random-buy path accrues fees too.
    function accrueReferralForCount(address[] calldata _referrers, uint256[] calldata _referralSplit, uint256 count)
        external
    {
        _accrueReferral(_referrers, _referralSplit, ticketPrice * count);
    }

    function _mint(address recipient) internal returns (uint256 id) {
        id = nextTicketId++;
        drawingsData[currentDrawingId].ticketOwner[id] = recipient;
        _ticketOwners[id] = recipient;
    }

    /// @notice ERC-721-style owner lookup, so this mock can stand in for the JackpotTicketNFT.
    function ownerOf(uint256 ticketId) external view returns (address) {
        return _ticketOwners[ticketId];
    }

    /// @notice Test helper: the id the next minted ticket will take (lets a test capture the
    ///         id range a batch execution mints).
    function peekNextTicketId() external view returns (uint256) {
        return nextTicketId;
    }

    function _accrueReferral(address[] calldata referrers, uint256[] calldata split, uint256 total) internal {
        if (referrers.length == 0 || referralFeeRate == 0) return;
        uint256 fee = (total * referralFeeRate) / 1e18;
        for (uint256 i = 0; i < referrers.length; i++) {
            referralFees[referrers[i]] += (fee * split[i]) / 1e18;
        }
    }

    function claimWinnings(uint256[] calldata _userTicketIds) external {
        // Mock claims from the most recently settled drawing.
        uint256 did = currentDrawingId - 1;
        DrawingData storage dd = drawingsData[did];
        require(dd.winningTicket != 0, "not settled");

        uint256 total;
        for (uint256 i = 0; i < _userTicketIds.length; i++) {
            uint256 id = _userTicketIds[i];
            require(dd.ticketOwner[id] == msg.sender, "not owner");
            require(!dd.claimed[id], "already claimed");
            // Megapot reverts when asked to claim a non-winning ticket (tier 0 = no
            // match, tier 2 = 1 normal/no bonusball). Models NoTicketsToClaim().
            uint256 tier = dd.ticketTier[id];
            require(tier != 0 && tier != 2, "NoTicketsToClaim");
            dd.claimed[id] = true;
            total += dd.tierPayouts[tier];
        }
        if (total > 0) {
            require(usdc.transfer(msg.sender, total), "USDC send failed");
        }
    }

    function claimReferralFees() external {
        // Megapot reverts (NoReferralFeesToClaim) on a zero balance; mirror that so the
        // sweepReferralFees zero-guard is actually exercised.
        uint256 amount = referralFees[msg.sender];
        require(amount > 0, "NoReferralFeesToClaim");
        referralFees[msg.sender] = 0;
        require(usdc.transfer(msg.sender, amount), "USDC send failed");
    }

    /// @notice Test helper: simulate Megapot accruing referral fees (purchase fee +/or
    ///         win share) to `referrer`. The contract must be funded with USDC to cover
    ///         what `claimReferralFees` will later pay out (as tests already do for wins).
    function accrueReferral(address referrer, uint256 amount) external {
        referralFees[referrer] += amount;
    }

    function getDrawingState(uint256 _drawingId) external view returns (IJackpot.DrawingState memory) {
        DrawingData storage dd = drawingsData[_drawingId];
        return IJackpot.DrawingState({
            prizePool: 0,
            ticketPrice: ticketPrice,
            edgePerTicket: 0,
            referralWinShare: 0,
            referralFee: referralFeeRate,
            globalTicketsBought: 0,
            lpEarnings: 0,
            drawingTime: dd.drawingTime,
            winningTicket: dd.winningTicket,
            ballMax: 49,
            bonusballMax: 26,
            payoutCalculator: address(0),
            jackpotLock: false
        });
    }

    function getTicketTierIds(uint256[] calldata _ticketIds) external view returns (uint256[] memory tierIds) {
        // Look up by checking previous drawing (claim phase).
        uint256 did = currentDrawingId - 1;
        DrawingData storage dd = drawingsData[did];
        tierIds = new uint256[](_ticketIds.length);
        for (uint256 i = 0; i < _ticketIds.length; i++) {
            tierIds[i] = dd.ticketTier[_ticketIds[i]];
        }
    }

    function getDrawingTierPayouts(uint256 _drawingId) external view returns (uint256[12] memory) {
        return drawingsData[_drawingId].tierPayouts;
    }

    // ---- Test helpers ------------------------------------------------------

    /// @notice Override the per-purchase referral fee rate (1e18 scale).
    function setReferralFeeRate(uint256 rate) external {
        referralFeeRate = rate;
    }

    /// @notice Mark a ticket as landing in a specific prize tier (0-11) BEFORE settlement.
    function setTicketTier(uint256 drawingId, uint256 ticketId, uint256 tier) external {
        drawingsData[drawingId].ticketTier[ticketId] = tier;
    }

    /// @notice Set the per-ticket USDC payout for a tier in a given drawing.
    function setTierPayout(uint256 drawingId, uint256 tier, uint256 payout) external {
        drawingsData[drawingId].tierPayouts[tier] = payout;
    }

    /// @notice Settle the current drawing, advance to the next one. Caller must have
    ///         transferred enough USDC into this contract beforehand to fund any
    ///         winnings that will be claimed.
    function settleDrawing() external {
        DrawingData storage dd = drawingsData[currentDrawingId];
        require(block.timestamp >= dd.drawingTime, "too early");
        dd.winningTicket = 12345; // sentinel non-zero
        // Advance.
        currentDrawingId += 1;
        drawingsData[currentDrawingId].drawingTime = block.timestamp + drawingDuration;
    }
}
