// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IJackpot} from "./IJackpot.sol";

/**
 * @notice Minimal interface to Megapot's BatchPurchaseFacilitator on Base — the path for
 *         buying more than 10 tickets in one order (the Jackpot's buyTickets caps at 10).
 * @dev    Signatures confirmed against the on-chain ABI.
 *         Deployed at 0x01774B531591b286b9f02C6Bc02ab3fD9526Aa76 (Base mainnet).
 *
 *         The facilitator is ASYNCHRONOUS and keeper-executed:
 *           1. `createBatchOrder` is funded up front — it pulls `count * ticketPrice` USDC
 *              from the caller (the payer) and records an order keyed by `_recipient`. USDC
 *              approval must be granted to the FACILITATOR, not the Jackpot.
 *           2. An off-chain keeper calls `executeBatchOrder` one or more times, minting the
 *              ticket NFTs to `_recipient` in batches. Any unspent USDC is refunded.
 *           3. Only ONE active order may exist per `_recipient` at a time (the order map is
 *              keyed by recipient); a second `createBatchOrder` reverts ActiveBatchOrderExists.
 *
 *         An order can mix `_dynamicTicketCount` random (quick-pick) tickets with explicit
 *         `_userStaticTickets` picks in a single order.
 */
interface IBatchPurchaseFacilitator {
    /// @notice Create a batch order for `_recipient`, funded up front from msg.sender.
    /// @param _recipient        Address the minted ticket NFTs are sent to.
    /// @param _dynamicTicketCount Number of random (quick-pick) tickets in the order.
    /// @param _userStaticTickets  Explicit picks; the order's total is dynamic + static.
    /// @param _referrers        Addresses earning the referral fee.
    /// @param _referralSplit    Weights matching `_referrers`, 1e18 scale, summing to 1e18.
    function createBatchOrder(
        address _recipient,
        uint64 _dynamicTicketCount,
        IJackpot.Ticket[] calldata _userStaticTickets,
        address[] calldata _referrers,
        uint256[] calldata _referralSplit
    ) external;

    /// @notice Keeper entrypoint: execute up to `_maxTicketsPerBatch` of `_recipient`'s order,
    ///         minting tickets to the recipient. Called off-chain; not used by Squads itself.
    function executeBatchOrder(address _recipient, uint256 _maxTicketsPerBatch) external;

    /// @notice Cancel the caller's (recipient's) active order and refund the unspent USDC.
    function cancelBatchOrder() external;

    /// @notice Whether `_recipient` currently has an active (incomplete) batch order.
    function hasActiveBatchOrder(address _recipient) external view returns (bool);

    /// @notice The minimum ticket count an order must have. Read dynamically (currently 10).
    function minimumTicketCount() external view returns (uint256);
}
