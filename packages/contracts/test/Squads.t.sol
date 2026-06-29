// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Squads} from "../src/Squads.sol";
import {IJackpot} from "../src/interfaces/IJackpot.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockJackpot} from "./mocks/MockJackpot.sol";
import {MockRandomTicketBuyer} from "./mocks/MockRandomTicketBuyer.sol";

contract SquadsTest is Test {
    uint256 internal constant TICKET_PRICE = 1_000_000; // 1 USDC, 6 decimals
    uint256 internal constant DRAW_DURATION = 1 days;
    uint256 internal constant FEE_RATE = 0.1e18; // 10% referral fee (mock default)
    uint256 internal constant DEFAULT_RESERVE_BPS = 250; // UI default reserve (2.5%)

    // Mirror of the contract's fixed share supply (Squads.TOTAL_SHARES).
    uint256 internal constant TOTAL_SHARES = 1000;
    // For the default reserve: reserveShares = 1000 * 250 / 10000 = 25, so 975 are for sale.
    uint256 internal constant DEFAULT_FOR_SALE = 975;

    Squads internal squads;
    MockUSDC internal usdc;
    MockJackpot internal jackpot;
    MockRandomTicketBuyer internal randomBuyer;

    address internal admin = address(0xA11CE);
    address internal organizer = address(0x0123);
    address internal alice = address(0xA11);
    address internal bob = address(0xB0B);
    address internal carol = address(0xCAFE);
    address internal stranger = address(0x5);

    uint256 internal drawingId; // the open drawing pools are created for (1)

    // Mirror of Squads.PoolCreated for vm.expectEmit.
    event PoolCreated(address indexed organizer, uint256 indexed drawingId, uint256 reserveBps, string name);

    function setUp() public {
        vm.warp(1_700_000_000); // realistic timestamp so drawingTime math never underflows

        usdc = new MockUSDC();
        jackpot = new MockJackpot(address(usdc), TICKET_PRICE, DRAW_DURATION);
        randomBuyer = new MockRandomTicketBuyer(address(usdc), address(jackpot));
        squads = new Squads(address(usdc), address(jackpot), address(randomBuyer), admin);

        drawingId = jackpot.currentDrawingId(); // 1

        _fund(organizer, 1_000 * TICKET_PRICE);
        _fund(alice, 1_000 * TICKET_PRICE);
        _fund(bob, 1_000 * TICKET_PRICE);
        _fund(carol, 1_000 * TICKET_PRICE);
    }

    // ---------------------------------------------------------------------
    // Helpers
    // ---------------------------------------------------------------------

    function _fund(address who, uint256 amount) internal {
        usdc.mint(who, amount);
        vm.prank(who);
        usdc.approve(address(squads), type(uint256).max);
    }

    function _ticket(uint8 bonus) internal pure returns (IJackpot.Ticket memory t) {
        t.normals = new uint8[](5);
        t.normals[0] = 1;
        t.normals[1] = 2;
        t.normals[2] = 3;
        t.normals[3] = 4;
        t.normals[4] = 5;
        t.bonusball = bonus;
    }

    function _picks(uint256 n) internal pure returns (IJackpot.Ticket[] memory arr) {
        arr = new IJackpot.Ticket[](n);
        for (uint256 i = 0; i < n; i++) {
            arr[i] = _ticket(uint8(i + 1));
        }
    }

    /// @dev Create a pool buying `ticketCount` initial tickets (default reserve).
    function _createPool(address org, uint256 ticketCount) internal {
        _createPool(org, ticketCount, DEFAULT_RESERVE_BPS);
    }

    function _createPool(address org, uint256 ticketCount, uint256 reserveBps) internal {
        vm.prank(org);
        squads.createPool(drawingId, ticketCount, reserveBps, "My Squad");
    }

    /// @dev Create a pool from `n` explicit-pick tickets (the custom-numbers entrypoint).
    function _createPoolPicks(address org, uint256 n, uint256 reserveBps) internal {
        vm.prank(org);
        squads.createPoolWithTickets(drawingId, _picks(n), reserveBps, "My Squad");
    }

    function _addTickets(address org, uint256 n) internal {
        vm.prank(org);
        squads.addTickets(drawingId, _picks(n));
    }

    function _lock(address org) internal {
        vm.prank(org);
        squads.lock(drawingId);
    }

    function _buy(address buyer, address org, uint256 amount) internal {
        vm.prank(buyer);
        squads.buyShares(org, drawingId, amount);
    }

    /// @dev Warp past drawingTime and settle the drawing in Megapot.
    function _settle() internal {
        vm.warp(block.timestamp + DRAW_DURATION + 1);
        jackpot.settleDrawing();
    }

    /// @dev Mark a held ticket as a winner of `payout` and fund the Jackpot to pay it.
    function _setWinner(uint256 ticketId, uint256 tier, uint256 payout) internal {
        jackpot.setTicketTier(drawingId, ticketId, tier);
        jackpot.setTierPayout(drawingId, tier, payout);
        usdc.mint(address(jackpot), payout); // fund the prize
    }

    function _assertSolvent() internal view {
        assertTrue(squads.isSolvent(), "INSOLVENT: liabilities exceed USDC balance");
    }

    function _tryWithdraw(address who, address org) internal {
        if (squads.claimableOf(org, drawingId, who) > 0) {
            vm.prank(who);
            squads.withdraw(org, drawingId);
        }
    }

    /// @dev Simulate Megapot accruing `amount` of referral win-share to Squads' aggregate
    ///      balance (funding the Jackpot to cover the later claim).
    function _accrueWinShare(uint256 amount) internal {
        usdc.mint(address(jackpot), amount);
        jackpot.accrueReferral(address(squads), amount);
    }

    /// @dev A name of exactly `n` bytes (single-byte 'a' chars).
    function _nameOfBytes(uint256 n) internal pure returns (string memory) {
        bytes memory b = new bytes(n);
        for (uint256 i; i < n; i++) {
            b[i] = "a";
        }
        return string(b);
    }

    // ---- getPool field accessors (one destructure per field, drawingId-scoped) ----

    function _state(address org) internal view returns (Squads.State v) {
        (v,,,,,,,,,,) = squads.getPool(org, drawingId);
    }

    function _soldOut(address org) internal view returns (bool v) {
        (, v,,,,,,,,,) = squads.getPool(org, drawingId);
    }

    function _totalShares(address org) internal view returns (uint256 v) {
        (,, v,,,,,,,,) = squads.getPool(org, drawingId);
    }

    function _sharesForSale(address org) internal view returns (uint256 v) {
        (,,, v,,,,,,,) = squads.getPool(org, drawingId);
    }

    function _reserveShares(address org) internal view returns (uint256 v) {
        (,,,,, v,,,,,) = squads.getPool(org, drawingId);
    }

    function _ticketCount(address org) internal view returns (uint256 v) {
        (,,,,,, v,,,,) = squads.getPool(org, drawingId);
    }

    function _pricePerShare(address org) internal view returns (uint256 v) {
        (,,,,,,, v,,,) = squads.getPool(org, drawingId);
    }

    function _ticketFunding(address org) internal view returns (uint256 v) {
        (,,,,,,,, v,,) = squads.getPool(org, drawingId);
    }

    function _totalWinnings(address org) internal view returns (uint256 v) {
        (,,,,,,,,, v,) = squads.getPool(org, drawingId);
    }

    function _feesCollected(address org, uint256 draw) internal view returns (uint256 v) {
        (,,,,,,,,,, v) = squads.getPool(org, draw);
    }

    function _feesCollected(address org) internal view returns (uint256) {
        return _feesCollected(org, drawingId);
    }

    // ---------------------------------------------------------------------
    // createPool (atomic create + buy)
    // ---------------------------------------------------------------------

    function test_CreatePool() public {
        _createPool(organizer, 5);
        assertEq(uint256(_state(organizer)), uint256(Squads.State.Building));
        assertTrue(squads.poolExists(organizer, drawingId));

        uint256[] memory h = squads.getHistory(organizer);
        assertEq(h.length, 1);
        assertEq(h[0], drawingId);
        _assertSolvent();
    }

    function test_CreatePoolBuysTicketsAtomically() public {
        _createPool(organizer, 5); // no separate addTickets needed
        assertEq(uint256(_state(organizer)), uint256(Squads.State.Building));
        assertEq(_ticketCount(organizer), 5);
        assertEq(_ticketFunding(organizer), 5 * TICKET_PRICE);
        assertEq(squads.getTicketIds(organizer, drawingId).length, 5);
        // Sales fee collected atomically with the buy.
        assertEq(_feesCollected(organizer), (5 * TICKET_PRICE * FEE_RATE) / 1e18);
        _assertSolvent();
    }

    function test_CreatePoolRevertsOnZeroTickets() public {
        vm.prank(organizer);
        vm.expectRevert(Squads.NoTickets.selector);
        squads.createPool(drawingId, 0, DEFAULT_RESERVE_BPS, "empty");
    }

    function test_CreatePoolRevertsOverTicketCap() public {
        vm.prank(organizer);
        vm.expectRevert(Squads.TooManyTickets.selector); // MAX_POOL_TICKETS = 100
        squads.createPool(drawingId, 101, DEFAULT_RESERVE_BPS, "huge");
    }

    function test_CreatePoolWithTicketsBuysExplicitPicks() public {
        // 12 explicit picks -> bought in two Megapot chunks (10 + 2), atomically at creation.
        _createPoolPicks(organizer, 12, DEFAULT_RESERVE_BPS);

        assertEq(uint256(_state(organizer)), uint256(Squads.State.Building));
        assertEq(_ticketCount(organizer), 12);
        assertEq(_ticketFunding(organizer), 12 * TICKET_PRICE);
        assertEq(squads.getTicketIds(organizer, drawingId).length, 12);
        // Sales fee collected atomically, same as the quick-pick path.
        assertEq(_feesCollected(organizer), (12 * TICKET_PRICE * FEE_RATE) / 1e18);
        _assertSolvent();

        // ...and the pool runs the normal lifecycle.
        _lock(organizer);
        _buy(alice, organizer, DEFAULT_FOR_SALE); // sold out
        _settle();
        uint256[] memory ids = squads.getTicketIds(organizer, drawingId);
        _setWinner(ids[0], 1, 100 * TICKET_PRICE);
        squads.claimAndDistribute(organizer, drawingId);
        assertEq(uint256(_state(organizer)), uint256(Squads.State.Settled));
        assertGt(squads.claimableOf(organizer, drawingId, alice), 0);
        _assertSolvent();
    }

    function test_CreatePoolWithTicketsRevertsOnZero() public {
        vm.prank(organizer);
        vm.expectRevert(Squads.NoTickets.selector);
        squads.createPoolWithTickets(drawingId, _picks(0), DEFAULT_RESERVE_BPS, "empty");
    }

    function test_CreatePoolWithTicketsRevertsOverCap() public {
        IJackpot.Ticket[] memory many = _picks(101);
        vm.prank(organizer);
        vm.expectRevert(Squads.TooManyTickets.selector);
        squads.createPoolWithTickets(drawingId, many, DEFAULT_RESERVE_BPS, "huge");
    }

    function test_CreatePoolWithTicketsRevertsOnTooLongName() public {
        IJackpot.Ticket[] memory t = _picks(3);
        string memory name = _nameOfBytes(65);
        vm.prank(organizer);
        vm.expectRevert(Squads.NameTooLong.selector);
        squads.createPoolWithTickets(drawingId, t, DEFAULT_RESERVE_BPS, name);
    }

    function test_CreatePool_revertsOnDuplicate() public {
        _createPool(organizer, 5);
        vm.prank(organizer);
        vm.expectRevert(Squads.PoolExists.selector);
        squads.createPool(drawingId, 5, DEFAULT_RESERVE_BPS, "dup");
    }

    function test_CreatePool_revertsOnWrongDrawing() public {
        vm.prank(organizer);
        vm.expectRevert(Squads.DrawingNotOpen.selector);
        squads.createPool(drawingId + 5, 5, DEFAULT_RESERVE_BPS, "wrong");
    }

    function test_TotalSharesIsFixed() public {
        // Whatever the organizer does, totalShares is the fixed TOTAL_SHARES constant.
        _createPool(organizer, 5);
        assertEq(_totalShares(organizer), TOTAL_SHARES);

        address org2 = address(0xD00D);
        _fund(org2, 100 * TICKET_PRICE);
        _createPool(org2, 50, 5_000); // different ticket count + reserve
        assertEq(_totalShares(org2), TOTAL_SHARES);
    }

    // ---------------------------------------------------------------------
    // createPool name (bounded bytes, event-only metadata)
    // ---------------------------------------------------------------------

    function test_CreatePoolAcceptsNormalName() public {
        vm.expectEmit(true, true, false, true, address(squads));
        emit PoolCreated(organizer, drawingId, DEFAULT_RESERVE_BPS, "Friday Degens");
        vm.prank(organizer);
        squads.createPool(drawingId, 5, DEFAULT_RESERVE_BPS, "Friday Degens");
        assertTrue(squads.poolExists(organizer, drawingId));
    }

    function test_CreatePoolAcceptsEmptyName() public {
        vm.prank(organizer);
        squads.createPool(drawingId, 5, DEFAULT_RESERVE_BPS, ""); // frontend supplies a default
        assertTrue(squads.poolExists(organizer, drawingId));
    }

    function test_CreatePoolAcceptsMaxLengthName() public {
        string memory name = _nameOfBytes(64); // exactly MAX_NAME_BYTES
        assertEq(bytes(name).length, 64);
        vm.prank(organizer);
        squads.createPool(drawingId, 5, DEFAULT_RESERVE_BPS, name);
        assertTrue(squads.poolExists(organizer, drawingId));
    }

    function test_CreatePoolRevertsOnTooLongName() public {
        string memory name = _nameOfBytes(65); // MAX_NAME_BYTES + 1
        vm.prank(organizer);
        vm.expectRevert(Squads.NameTooLong.selector);
        squads.createPool(drawingId, 5, DEFAULT_RESERVE_BPS, name);
    }

    function test_CreatePoolNameNotInStorage() public {
        // The name is display metadata only: emitted in PoolCreated, never written to the Pool
        // struct. getPool()'s return tuple is all scalars — there is no name field to read.
        _createPool(organizer, 5);
        assertEq(uint256(_state(organizer)), uint256(Squads.State.Building));
        assertEq(_totalShares(organizer), TOTAL_SHARES);
        assertFalse(_soldOut(organizer));
    }

    // ---------------------------------------------------------------------
    // addTickets / addRandomTickets (grow during Building)
    // ---------------------------------------------------------------------

    function test_AddTicketsStillGrowsPoolDuringBuilding() public {
        _createPool(organizer, 5); // starts with 5
        _addTickets(organizer, 10);
        _addTickets(organizer, 10);
        _addTickets(organizer, 5); // 5 + 25 = 30 total
        assertEq(_ticketCount(organizer), 30);
        assertEq(_ticketFunding(organizer), 30 * TICKET_PRICE);

        // Once locked, no more tickets can be added.
        _lock(organizer);
        vm.prank(organizer);
        vm.expectRevert(Squads.WrongState.selector);
        squads.addTickets(drawingId, _picks(1));
    }

    function test_AddRandomTickets() public {
        _createPool(organizer, 5);
        vm.prank(organizer);
        squads.addRandomTickets(drawingId, 3);
        assertEq(_ticketCount(organizer), 8);
        assertEq(_feesCollected(organizer), (8 * TICKET_PRICE * FEE_RATE) / 1e18);
        _assertSolvent();
    }

    function test_AddTickets_revertsOverBatch() public {
        _createPool(organizer, 5);
        vm.prank(organizer);
        vm.expectRevert(Squads.InvalidTicketCount.selector);
        squads.addTickets(drawingId, _picks(11));
    }

    function test_AddTickets_revertsOverPoolCap() public {
        _createPool(organizer, 10); // 10
        for (uint256 i = 0; i < 9; i++) {
            _addTickets(organizer, 10); // +90 -> 100 (MAX_POOL_TICKETS)
        }
        vm.prank(organizer);
        vm.expectRevert(Squads.TooManyTickets.selector);
        squads.addTickets(drawingId, _picks(1));
    }

    function test_AddTickets_revertsForNonOrganizer() public {
        _createPool(organizer, 5);
        // Pools are keyed by (msg.sender, drawingId), so a stranger has no pool here.
        vm.prank(stranger);
        vm.expectRevert(Squads.PoolNotFound.selector);
        squads.addTickets(drawingId, _picks(1));
    }

    function test_LargePoolViaRepeatedAddTickets() public {
        _createPool(organizer, 10);
        _addTickets(organizer, 10);
        _addTickets(organizer, 10); // 30 tickets total
        assertEq(_ticketCount(organizer), 30);

        // ...and the pool settles normally.
        _lock(organizer);
        _buy(alice, organizer, DEFAULT_FOR_SALE);
        _settle();
        uint256[] memory ids = squads.getTicketIds(organizer, drawingId);
        _setWinner(ids[0], 1, 100 * TICKET_PRICE);
        squads.claimAndDistribute(organizer, drawingId);
        assertEq(uint256(_state(organizer)), uint256(Squads.State.Settled));
        _assertSolvent();
    }

    // ---------------------------------------------------------------------
    // lock (opens shares; no stored cutoff)
    // ---------------------------------------------------------------------

    function test_LockOpensSharesWithoutCutoff() public {
        _createPool(organizer, 5); // default reserve 250 bps
        _lock(organizer);

        assertEq(uint256(_state(organizer)), uint256(Squads.State.Live));
        assertEq(_totalShares(organizer), TOTAL_SHARES);
        assertEq(_reserveShares(organizer), 25); // 1000 * 250 / 10000
        assertEq(_sharesForSale(organizer), DEFAULT_FOR_SALE); // 975
        assertEq(_pricePerShare(organizer), (5 * TICKET_PRICE) / TOTAL_SHARES); // ticketFunding / TOTAL_SHARES
        assertEq(squads.sharesOf(organizer, drawingId, organizer), 25); // reserve granted

        // Shares are open for sale (no stored salesCloseTime exists) — a buy succeeds.
        _buy(alice, organizer, 1);
        assertEq(squads.sharesOf(organizer, drawingId, alice), 1);
        _assertSolvent();
    }

    function test_Lock_revertsIfNotBuilding() public {
        _createPool(organizer, 1);
        _lock(organizer);
        vm.prank(organizer);
        vm.expectRevert(Squads.WrongState.selector);
        squads.lock(drawingId);
    }

    // ---------------------------------------------------------------------
    // buyShares / buySharesFor
    // ---------------------------------------------------------------------

    function test_BuyShares() public {
        _createPool(organizer, 5);
        _lock(organizer);

        uint256 price = squads.quoteShares(organizer, drawingId, 10);
        uint256 orgBefore = usdc.balanceOf(organizer);
        uint256 aliceBefore = usdc.balanceOf(alice);

        _buy(alice, organizer, 10);

        assertEq(squads.sharesOf(organizer, drawingId, alice), 10);
        assertEq(usdc.balanceOf(alice), aliceBefore - price);
        assertEq(usdc.balanceOf(organizer), orgBefore); // reimbursed via claimable, not pushed
        assertEq(squads.claimableOf(organizer, drawingId, organizer), price);
        _assertSolvent();
    }

    function test_BuySharesFor_gift() public {
        _createPool(organizer, 5);
        _lock(organizer);

        uint256 bobBefore = usdc.balanceOf(bob);
        vm.prank(bob);
        squads.buySharesFor(organizer, drawingId, 7, carol); // bob pays, carol owns

        assertEq(squads.sharesOf(organizer, drawingId, carol), 7);
        assertEq(squads.sharesOf(organizer, drawingId, bob), 0);
        assertLt(usdc.balanceOf(bob), bobBefore);
        _assertSolvent();
    }

    function test_BuyShares_revertsBeforeLock() public {
        _createPool(organizer, 5);
        vm.prank(alice);
        vm.expectRevert(Squads.WrongState.selector);
        squads.buyShares(organizer, drawingId, 1);
    }

    function test_BuyShares_revertsOverCapacity() public {
        _createPool(organizer, 5);
        _lock(organizer);
        vm.prank(alice);
        vm.expectRevert(Squads.ExceedsForSale.selector);
        squads.buyShares(organizer, drawingId, DEFAULT_FOR_SALE + 1); // only 975 for sale
    }

    function test_BuySharesAllowedUntilDrawing() public {
        _createPool(organizer, 5);
        _lock(organizer);

        // Open: shares are purchasable.
        _buy(alice, organizer, 10);
        assertEq(squads.sharesOf(organizer, drawingId, alice), 10);

        // Reaching the drawing's close time closes sales — gated on live Megapot state, no cutoff.
        uint256 dt = jackpot.getDrawingState(drawingId).drawingTime;
        vm.warp(dt);
        vm.prank(bob);
        vm.expectRevert(Squads.SalesClosed.selector);
        squads.buyShares(organizer, drawingId, 1);
    }

    function test_BuyShares_revertsOnceDrawn() public {
        _createPool(organizer, 5);
        _lock(organizer);
        _buy(alice, organizer, 10);

        _settle(); // winningTicket set -> drawing closed
        vm.prank(bob);
        vm.expectRevert(Squads.SalesClosed.selector);
        squads.buyShares(organizer, drawingId, 1);
    }

    // ---------------------------------------------------------------------
    // claimAndDistribute — the riskiest path (totalShares = 1000)
    // ---------------------------------------------------------------------

    function test_Settle_winning_soldOut() public {
        _createPool(organizer, 5); // reserve 25, sharesForSale 975
        _lock(organizer);
        _buy(alice, organizer, DEFAULT_FOR_SALE); // every for-sale share -> sold out

        uint256 feesCollected = (5 * TICKET_PRICE * FEE_RATE) / 1e18; // 500_000

        _settle();
        uint256[] memory ids = squads.getTicketIds(organizer, drawingId);
        _setWinner(ids[0], 1, 100 * TICKET_PRICE); // 100 USDC prize

        squads.claimAndDistribute(organizer, drawingId);

        assertTrue(_soldOut(organizer));
        assertEq(_totalWinnings(organizer), 100 * TICKET_PRICE);

        // organizer holds reserve 25 of 1000, alice 975. Winnings + sold-out fee rebate split by total.
        uint256 aliceWin = (100 * TICKET_PRICE * 975) / 1000; // 97.5 USDC
        uint256 aliceFee = (feesCollected * 975) / 1000; // 487_500
        assertEq(squads.claimableOf(organizer, drawingId, alice), aliceWin + aliceFee);

        uint256 orgReimburse = squads.quoteShares(organizer, drawingId, 975);
        uint256 orgWin = (100 * TICKET_PRICE * 25) / 1000; // 2.5 USDC
        uint256 orgFee = (feesCollected * 25) / 1000; // 12_500
        assertEq(squads.claimableOf(organizer, drawingId, organizer), orgReimburse + orgWin + orgFee);

        assertEq(_feesCollected(organizer), 0);
        assertEq(squads.totalFeesLocked(), 0);
        _assertSolvent();
    }

    function test_Settle_winning_undersold() public {
        _createPool(organizer, 5);
        _lock(organizer);
        _buy(alice, organizer, 40); // 935 of 975 unsold -> NOT sold out

        uint256 feesCollected = (5 * TICKET_PRICE * FEE_RATE) / 1e18;

        _settle();
        uint256[] memory ids = squads.getTicketIds(organizer, drawingId);
        _setWinner(ids[0], 1, 100 * TICKET_PRICE);

        squads.claimAndDistribute(organizer, drawingId);

        assertFalse(_soldOut(organizer));
        // Organizer holds reserve 25 + unsold 935 = 960 of 1000.
        assertEq(squads.sharesOf(organizer, drawingId, organizer), 960);
        assertEq(squads.sharesOf(organizer, drawingId, alice), 40);

        uint256 aliceWin = (100 * TICKET_PRICE * 40) / 1000; // 4 USDC
        assertEq(squads.claimableOf(organizer, drawingId, alice), aliceWin);

        uint256 orgReimburse = squads.quoteShares(organizer, drawingId, 40);
        uint256 orgWin = (100 * TICKET_PRICE * 960) / 1000; // 96 USDC
        // Undersold -> ALL fees to organizer.
        assertEq(squads.claimableOf(organizer, drawingId, organizer), orgReimburse + orgWin + feesCollected);
        _assertSolvent();
    }

    function test_Settle_losing() public {
        _createPool(organizer, 5);
        _lock(organizer);
        _buy(alice, organizer, DEFAULT_FOR_SALE); // sold out

        _settle();
        squads.claimAndDistribute(organizer, drawingId); // no winners -> totalWinnings 0

        assertEq(_totalWinnings(organizer), 0);
        // Sold out, so the referral fees still get rebated to holders (alice holds 975/1000).
        uint256 feesCollected = (5 * TICKET_PRICE * FEE_RATE) / 1e18;
        assertEq(squads.claimableOf(organizer, drawingId, alice), (feesCollected * 975) / 1000);
        _assertSolvent();
    }

    function test_Settle_revertsIfNotSettled() public {
        _createPool(organizer, 5);
        _lock(organizer);
        _buy(alice, organizer, 10);
        vm.expectRevert(Squads.DrawingNotSettled.selector);
        squads.claimAndDistribute(organizer, drawingId);
    }

    function test_Settle_neverLocked_goesToOrganizer() public {
        _createPool(organizer, 5); // organizer never locks
        _settle();
        uint256[] memory ids = squads.getTicketIds(organizer, drawingId);
        _setWinner(ids[0], 1, 100 * TICKET_PRICE);

        squads.claimAndDistribute(organizer, drawingId);

        // Organizer is the sole holder of all 1000 shares (reserve 25 + unsold 975) -> all winnings + fees.
        assertEq(squads.sharesOf(organizer, drawingId, organizer), TOTAL_SHARES);
        uint256 feesCollected = (5 * TICKET_PRICE * FEE_RATE) / 1e18;
        assertEq(squads.claimableOf(organizer, drawingId, organizer), 100 * TICKET_PRICE + feesCollected);
        _assertSolvent();
    }

    function test_Settle_isPermissionless() public {
        _createPool(organizer, 3);
        _lock(organizer);
        _buy(alice, organizer, DEFAULT_FOR_SALE);
        _settle();

        vm.prank(stranger); // anyone can settle; no party can freeze a pool
        squads.claimAndDistribute(organizer, drawingId);
        assertEq(uint256(_state(organizer)), uint256(Squads.State.Settled));
        _assertSolvent();
    }

    // ---------------------------------------------------------------------
    // withdraw
    // ---------------------------------------------------------------------

    function test_Withdraw() public {
        _createPool(organizer, 5);
        _lock(organizer);
        _buy(alice, organizer, DEFAULT_FOR_SALE);
        _settle();
        uint256[] memory ids = squads.getTicketIds(organizer, drawingId);
        _setWinner(ids[0], 1, 100 * TICKET_PRICE);
        squads.claimAndDistribute(organizer, drawingId);

        uint256 owed = squads.claimableOf(organizer, drawingId, alice);
        assertGt(owed, 0);
        uint256 before = usdc.balanceOf(alice);

        vm.prank(alice);
        squads.withdraw(organizer, drawingId);

        assertEq(usdc.balanceOf(alice), before + owed);
        assertEq(squads.claimableOf(organizer, drawingId, alice), 0);
        _assertSolvent();

        vm.prank(alice);
        vm.expectRevert(Squads.NothingToWithdraw.selector);
        squads.withdraw(organizer, drawingId);
    }

    function test_Withdraw_revertsWhenNothing() public {
        _createPool(organizer, 1);
        _lock(organizer);
        vm.prank(stranger);
        vm.expectRevert(Squads.NothingToWithdraw.selector);
        squads.withdraw(organizer, drawingId);
    }

    // ---------------------------------------------------------------------
    // cancel (now only reachable on an empty pool, which can no longer exist)
    // ---------------------------------------------------------------------

    function test_CancelRevertsOncePoolHasTickets() public {
        // createPool always buys >= 1 ticket, so a Building pool always has tickets and cancel
        // can never delete it (no empty pools exist).
        _createPool(organizer, 5);
        vm.prank(organizer);
        vm.expectRevert(Squads.TicketsAlreadyBought.selector);
        squads.cancel(drawingId);
    }

    // ---------------------------------------------------------------------
    // pause / access control
    // ---------------------------------------------------------------------

    function test_Pause_blocksBuildAndBuy() public {
        vm.prank(admin);
        squads.pause();

        vm.prank(organizer);
        vm.expectRevert(Pausable.EnforcedPause.selector);
        squads.createPool(drawingId, 5, DEFAULT_RESERVE_BPS, "x");
    }

    function test_Pause_allowsSettleAndWithdraw() public {
        _createPool(organizer, 3);
        _lock(organizer);
        _buy(alice, organizer, DEFAULT_FOR_SALE); // sold out -> losing pool's fees rebate to alice
        _settle();

        vm.prank(admin);
        squads.pause();

        // Settlement and withdrawal remain open under pause.
        squads.claimAndDistribute(organizer, drawingId);
        vm.prank(alice);
        squads.withdraw(organizer, drawingId);
        _assertSolvent();
    }

    function test_Pause_onlyOwner() public {
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        squads.pause();
    }

    // ---------------------------------------------------------------------
    // misc: self-purchase, dust, multi-pool invariant
    // ---------------------------------------------------------------------

    function test_OrganizerSelfPurchaseUncapped() public {
        _createPool(organizer, 5);
        _lock(organizer);
        _buy(organizer, organizer, DEFAULT_FOR_SALE); // organizer buys all its for-sale shares
        assertEq(squads.sharesOf(organizer, drawingId, organizer), TOTAL_SHARES); // 25 reserve + 975
        _assertSolvent();
    }

    function test_Distribution_dustToOrganizer() public {
        // A prize that does not divide evenly across 1000 shares -> floor each holder, dust to organizer.
        _createPool(organizer, 1, 0); // reserve 0 -> sharesForSale 1000
        _lock(organizer);
        _buy(alice, organizer, 1);
        _buy(bob, organizer, 1);
        // alice 1, bob 1, organizer 998 (unsold) of 1000.

        _settle();
        uint256[] memory ids = squads.getTicketIds(organizer, drawingId);
        uint256 prize = 100 * TICKET_PRICE + 777; // not divisible by 1000
        _setWinner(ids[0], 1, prize);
        squads.claimAndDistribute(organizer, drawingId);

        uint256 aliceWin = (prize * 1) / 1000;
        uint256 bobWin = (prize * 1) / 1000;
        uint256 orgShareWin = (prize * 998) / 1000;
        uint256 dust = prize - (aliceWin + bobWin + orgShareWin);
        assertGt(dust, 0); // the prize doesn't divide evenly

        assertEq(squads.claimableOf(organizer, drawingId, alice), aliceWin);
        assertEq(squads.claimableOf(organizer, drawingId, bob), bobWin);

        // organizer: reimbursement + own winnings share + dust + ALL fees (undersold).
        uint256 orgReimburse = squads.quoteShares(organizer, drawingId, 2); // alice + bob proceeds
        uint256 feesCollected = (1 * TICKET_PRICE * FEE_RATE) / 1e18;
        assertEq(squads.claimableOf(organizer, drawingId, organizer), orgReimburse + orgShareWin + dust + feesCollected);
        // Conservation: every micro-USDC of the prize is credited.
        assertEq(aliceWin + bobWin + orgShareWin + dust, prize);
        _assertSolvent();
    }

    function test_MultiPool_invariantHolds() public {
        // Two organizers, two pools sharing the one contract balance.
        _createPool(organizer, 5);
        _lock(organizer);
        _buy(alice, organizer, 50);
        _assertSolvent();

        address org2 = address(0xBEEF);
        _fund(org2, 100 * TICKET_PRICE);
        vm.prank(org2);
        squads.createPool(drawingId, 8, DEFAULT_RESERVE_BPS, "Squad 2");
        _lock(org2);
        _buy(bob, org2, 100);
        _assertSolvent();

        _settle();
        uint256[] memory ids1 = squads.getTicketIds(organizer, drawingId);
        _setWinner(ids1[0], 1, 100 * TICKET_PRICE);

        squads.claimAndDistribute(organizer, drawingId);
        _assertSolvent();
        squads.claimAndDistribute(org2, drawingId); // org2 lost; fees still resolve
        _assertSolvent();

        // Everyone with a balance withdraws; bob's pool lost AND was undersold, so he is owed nothing.
        _tryWithdraw(alice, organizer);
        _tryWithdraw(bob, org2);
        _tryWithdraw(organizer, organizer);
        _tryWithdraw(org2, org2);
        _assertSolvent();

        assertEq(squads.totalClaimable(), 0);
        assertEq(squads.totalFeesLocked(), 0);
    }

    // ---------------------------------------------------------------------
    // Organizer reserve: chosen percentage carved out of the fixed total
    // ---------------------------------------------------------------------

    function test_ReserveZeroSellsEntirePool() public {
        _createPool(organizer, 10, 0); // 10 tickets, reserve 0 -> whole pool for sale
        _lock(organizer);

        assertEq(squads.sharesOf(organizer, drawingId, organizer), 0);
        assertEq(_reserveShares(organizer), 0);
        assertEq(_sharesForSale(organizer), TOTAL_SHARES);

        // Full sellout reimburses ticketFunding exactly (1000 evenly divides 10e6).
        _buy(alice, organizer, TOTAL_SHARES);
        assertEq(squads.claimableOf(organizer, drawingId, organizer), 10 * TICKET_PRICE);
        _assertSolvent();
    }

    function test_ReserveCarvesOutShares() public {
        _createPool(organizer, 10, 250); // 2.5%
        _lock(organizer);
        assertEq(_reserveShares(organizer), 25);
        assertEq(_sharesForSale(organizer), 975);
        assertEq(_totalShares(organizer), TOTAL_SHARES);
        assertEq(squads.sharesOf(organizer, drawingId, organizer), 25);
        _assertSolvent();
    }

    function test_ReserveReimbursementShortfallEqualsStakeValue() public {
        _createPool(organizer, 10, 2000); // 20% reserve
        _lock(organizer);
        _buy(alice, organizer, 800); // full sellout (1000 - 200 reserve)

        // Before settlement the organizer's claimable is pure reimbursement = soldShares * price.
        uint256 price = squads.quoteShares(organizer, drawingId, 1);
        uint256 reimburse = squads.claimableOf(organizer, drawingId, organizer);
        assertEq(reimburse, 800 * price); // $8.00

        uint256 ticketFunding = 10 * TICKET_PRICE;
        assertEq(ticketFunding - reimburse, 200 * price); // shortfall == reserveShares * price = $2.00
        _assertSolvent();
    }

    function test_ReserveOwnershipInWinnings() public {
        _createPool(organizer, 10, 2000); // 20%
        _lock(organizer);
        _buy(alice, organizer, 800);

        _settle();
        uint256[] memory ids = squads.getTicketIds(organizer, drawingId);
        uint256 prize = 500 * TICKET_PRICE;
        _setWinner(ids[0], 1, prize);
        squads.claimAndDistribute(organizer, drawingId);

        uint256 orgWin = (prize * 200) / 1000; // 100 USDC = 20%
        uint256 aliceWin = (prize * 800) / 1000; // 400 USDC
        assertEq(orgWin + aliceWin, prize);

        uint256 feesCollected = (10 * TICKET_PRICE * FEE_RATE) / 1e18;
        uint256 aliceFee = (feesCollected * 800) / 1000;
        assertEq(squads.claimableOf(organizer, drawingId, alice), aliceWin + aliceFee);

        uint256 orgReimburse = squads.quoteShares(organizer, drawingId, 800);
        uint256 orgFee = (feesCollected * 200) / 1000;
        assertEq(squads.claimableOf(organizer, drawingId, organizer), orgReimburse + orgWin + orgFee);
        _assertSolvent();
    }

    function test_HighReserveAllowed() public {
        _createPool(organizer, 10, 7500); // 75% reserve
        _lock(organizer);
        assertEq(_reserveShares(organizer), 750);
        assertEq(_sharesForSale(organizer), 250);
        assertEq(squads.sharesOf(organizer, drawingId, organizer), 750);

        // Full sellout reimburses only $2.50 on a $10 pool (250 * 10_000).
        _buy(alice, organizer, 250);
        assertEq(squads.claimableOf(organizer, drawingId, organizer), 250 * 10_000);
        _assertSolvent();
    }

    function test_CreatePoolRevertsWhenNothingToSell() public {
        // 100% reserve leaves nothing for players to buy.
        vm.prank(organizer);
        vm.expectRevert(Squads.InvalidReserve.selector);
        squads.createPool(drawingId, 5, 10_000, "all");

        vm.prank(organizer);
        vm.expectRevert(Squads.InvalidReserve.selector);
        squads.createPool(drawingId, 5, 10_001, "over");

        // Anything below 100% is allowed — even 99.99% leaves >= 1 share for sale
        // (reserveShares = floor(1000 * 9999 / 10000) = 999, sharesForSale = 1, set at lock).
        _createPool(organizer, 5, 9_999);
        _lock(organizer);
        assertEq(_reserveShares(organizer), 999);
        assertEq(_sharesForSale(organizer), 1);
    }

    // ---------------------------------------------------------------------
    // Win-share referral attribution (Megapot's single aggregate balance)
    // ---------------------------------------------------------------------

    function test_SalesFeeStillAtomicAndCorrect() public {
        // No win-share configured: the sales fee is collected atomically at buy time and fully
        // attributed to the pool, with nothing left in the shared bucket.
        _createPool(organizer, 5);

        uint256 salesFee = (5 * TICKET_PRICE * FEE_RATE) / 1e18; // 500_000
        assertEq(_feesCollected(organizer), salesFee);
        assertEq(squads.totalFeesLocked(), salesFee);
        assertEq(squads.unattributedFees(), 0);
        _assertSolvent();
    }

    function test_WinShareWhenNoConcurrentSweep() public {
        jackpot.setWinShareRate(0.1e18); // 10% win-share referral
        _createPool(organizer, 5);
        _lock(organizer);
        _buy(alice, organizer, DEFAULT_FOR_SALE); // sold out

        _settle();
        uint256[] memory ids = squads.getTicketIds(organizer, drawingId);
        uint256 prize = 100 * TICKET_PRICE;
        _setWinner(ids[0], 1, prize);
        uint256 winShare = (prize * 0.1e18) / 1e18; // 10 USDC, accrues to Squads' aggregate
        _accrueWinShare(winShare);

        squads.claimAndDistribute(organizer, drawingId);

        assertEq(squads.unattributedFees(), 0); // pool collected its win-share, nothing stranded

        // Sold out -> total fees (sales + win-share) rebated pro rata; alice holds 975/1000.
        uint256 salesFee = (5 * TICKET_PRICE * FEE_RATE) / 1e18;
        uint256 totalFees = salesFee + winShare;
        uint256 aliceWin = (prize * 975) / 1000;
        uint256 aliceFeeShare = (totalFees * 975) / 1000;
        assertEq(squads.claimableOf(organizer, drawingId, alice), aliceWin + aliceFeeShare);
        _assertSolvent();
    }

    function test_WinShareAttributedToSettlingPoolUnderConcurrency() public {
        jackpot.setWinShareRate(0.1e18); // 10%
        address orgA = organizer;
        address orgB = address(0xB0B0);
        _fund(orgB, 1_000 * TICKET_PRICE);

        // Pool A in drawing 1: build, lock, sell out.
        _createPool(orgA, 5);
        _lock(orgA);
        _buy(alice, orgA, DEFAULT_FOR_SALE);

        // Settle drawing 1; A's ticket wins, and A's win-share accrues to the aggregate at
        // settlement (the worst-case timing the fix must tolerate).
        _settle(); // currentDrawingId -> 2
        uint256[] memory idsA = squads.getTicketIds(orgA, drawingId);
        uint256 prize = 100 * TICKET_PRICE;
        _setWinner(idsA[0], 1, prize);
        uint256 winShareA = (prize * 0.1e18) / 1e18; // 10 USDC
        _accrueWinShare(winShareA);

        // CONCURRENCY: pool B (next drawing) is created — its atomic ticket buy sweeps the aggregate
        // (including A's pending win-share) but draws only B's own sales fee.
        uint256 drawB = jackpot.currentDrawingId(); // 2
        vm.prank(orgB);
        squads.createPool(drawB, 3, DEFAULT_RESERVE_BPS, "B");

        uint256 bSalesFee = (3 * TICKET_PRICE * FEE_RATE) / 1e18; // 300_000
        assertEq(_feesCollected(orgB, drawB), bSalesFee);
        assertEq(squads.unattributedFees(), winShareA); // A's win-share parked in the bucket

        // Now A settles and collects ITS win-share from the bucket.
        squads.claimAndDistribute(orgA, drawingId);
        assertEq(squads.unattributedFees(), 0);

        // A's holders received A's win-share (sold-out rebate); alice holds 975/1000 of A.
        uint256 aSalesFee = (5 * TICKET_PRICE * FEE_RATE) / 1e18;
        uint256 aliceWin = (prize * 975) / 1000;
        uint256 aliceFeeShare = ((aSalesFee + winShareA) * 975) / 1000;
        assertEq(squads.claimableOf(orgA, drawingId, alice), aliceWin + aliceFeeShare);

        // B still has only its own sales fee — it never received A's win-share.
        assertEq(_feesCollected(orgB, drawB), bSalesFee);
        _assertSolvent();
    }

    function test_SweepUnattributedOnlyTransfersSurplus() public {
        _createPool(organizer, 5);

        // A stray win-share enters the aggregate, then a buy sweeps it into the bucket but draws
        // only its own sales fee, leaving the stray parked.
        uint256 stray = 7 * TICKET_PRICE;
        _accrueWinShare(stray);
        _addTickets(organizer, 2);
        assertEq(squads.unattributedFees(), stray);
        _assertSolvent();

        _lock(organizer);
        _buy(alice, organizer, DEFAULT_FOR_SALE); // sold out
        _settle();
        squads.claimAndDistribute(organizer, drawingId); // losing; fees rebated to holders

        uint256 aliceOwed = squads.claimableOf(organizer, drawingId, alice);
        assertGt(aliceOwed, 0);
        assertEq(squads.unattributedFees(), stray); // pool drew no win-share; stray still parked

        // Non-owner cannot sweep.
        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, stranger));
        squads.sweepUnattributed(stranger);

        // Owner sweeps ONLY the unattributed residue; holder funds are untouched.
        vm.prank(admin);
        squads.sweepUnattributed(admin);
        assertEq(squads.unattributedFees(), 0);
        assertEq(usdc.balanceOf(admin), stray);
        _assertSolvent();

        // alice can still withdraw her full claimable — the sweep could not reach it.
        uint256 aliceBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        squads.withdraw(organizer, drawingId);
        assertEq(usdc.balanceOf(alice), aliceBefore + aliceOwed);
        _assertSolvent();
    }
}
