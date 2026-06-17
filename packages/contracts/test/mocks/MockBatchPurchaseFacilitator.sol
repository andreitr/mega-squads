// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IJackpot} from "../../src/interfaces/IJackpot.sol";
import {MockJackpot} from "./MockJackpot.sol";

interface IERC20 {
    function transfer(address, uint256) external returns (bool);
    function transferFrom(address, address, uint256) external returns (bool);
}

/**
 * @notice Minimal stand-in for Megapot's BatchPurchaseFacilitator. Models the async,
 *         keeper-executed flow Squads relies on:
 *           - createBatchOrder: pulls the full order cost from the payer (Squads) and records
 *             an order keyed by recipient (one active order per recipient at a time).
 *           - executeBatchOrder: the keeper mints up to maxPerBatch tickets to the recipient
 *             via MockJackpot, paying the Jackpot and accruing the referral fee. The order
 *             goes inactive once fully minted.
 *           - cancelBatchOrder: refunds the unspent USDC for the remaining tickets to the
 *             recipient and deactivates the order.
 */
contract MockBatchPurchaseFacilitator {
    IERC20 public usdc;
    MockJackpot public jackpot;
    uint256 public minimumTicketCount = 10;

    struct Order {
        bool active;
        uint256 drawingId;
        uint256 remaining; // tickets left to mint
        address payer;
        address[] referrers;
        uint256[] split;
    }

    mapping(address => Order) internal orders; // by recipient

    constructor(address _usdc, address _jackpot) {
        usdc = IERC20(_usdc);
        jackpot = MockJackpot(_jackpot);
    }

    function createBatchOrder(
        address _recipient,
        uint64 _dynamicTicketCount,
        IJackpot.Ticket[] calldata _userStaticTickets,
        address[] calldata _referrers,
        uint256[] calldata _referralSplit
    ) external {
        require(!orders[_recipient].active, "ActiveBatchOrderExists");
        uint256 count = uint256(_dynamicTicketCount) + _userStaticTickets.length;
        require(count >= minimumTicketCount, "InvalidTicketCount");

        uint256 cost = jackpot.ticketPrice() * count;
        require(usdc.transferFrom(msg.sender, address(this), cost), "USDC pull failed");

        Order storage o = orders[_recipient];
        o.active = true;
        o.drawingId = jackpot.currentDrawingId();
        o.remaining = count;
        o.payer = msg.sender;
        o.referrers = _referrers;
        o.split = _referralSplit;
    }

    /// @notice Keeper: mint up to `_maxTicketsPerBatch` of the recipient's order.
    function executeBatchOrder(address _recipient, uint256 _maxTicketsPerBatch) external {
        Order storage o = orders[_recipient];
        require(o.active, "NoActiveBatchOrder");

        uint256 toMint = o.remaining;
        if (toMint > _maxTicketsPerBatch) toMint = _maxTicketsPerBatch;
        require(toMint > 0, "nothing to execute");

        uint256 cost = jackpot.ticketPrice() * toMint;
        require(usdc.transfer(address(jackpot), cost), "USDC pay failed");

        for (uint256 i = 0; i < toMint; i++) {
            jackpot.mintTicket(_recipient);
        }
        jackpot.accrueReferralForCount(o.referrers, o.split, toMint);

        o.remaining -= toMint;
        if (o.remaining == 0) o.active = false;
    }

    function cancelBatchOrder() external {
        Order storage o = orders[msg.sender];
        require(o.active, "NoActiveBatchOrder");
        uint256 refund = jackpot.ticketPrice() * o.remaining;
        o.active = false;
        o.remaining = 0;
        if (refund > 0) require(usdc.transfer(msg.sender, refund), "refund failed");
    }

    function hasActiveBatchOrder(address _recipient) external view returns (bool) {
        return orders[_recipient].active;
    }

    function getRemaining(address _recipient) external view returns (uint256) {
        return orders[_recipient].remaining;
    }
}
