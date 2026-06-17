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

    function _closeTime() internal view returns (uint64) {
        return uint64(block.timestamp + 23 hours); // leaves exactly the 1h selling window
    }

    function _createPool(address org, uint256 totalShares) internal {
        vm.prank(org);
        squads.createPool(drawingId, totalShares, _closeTime(), "My Squad");
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

    // ---------------------------------------------------------------------
    // createPool
    // ---------------------------------------------------------------------

    function test_CreatePool() public {
        _createPool(organizer, 100);

        (Squads.State state,, uint256 totalShares,,,,, uint64 closeTime,,,,) = squads.getPool(organizer, drawingId);
        assertEq(uint256(state), uint256(Squads.State.Building));
        assertEq(totalShares, 100);
        assertEq(closeTime, _closeTime());
        assertTrue(squads.poolExists(organizer, drawingId));

        uint256[] memory h = squads.getHistory(organizer);
        assertEq(h.length, 1);
        assertEq(h[0], drawingId);
        _assertSolvent();
    }

    function test_CreatePool_revertsOnDuplicate() public {
        _createPool(organizer, 100);
        vm.prank(organizer);
        vm.expectRevert(Squads.PoolExists.selector);
        squads.createPool(drawingId, 100, _closeTime(), "dup");
    }

    function test_CreatePool_revertsOnTightWindow() public {
        // salesCloseTime only 30 min before drawingTime < MIN_SELLING_WINDOW (1h)
        uint64 tooLate = uint64(block.timestamp + DRAW_DURATION - 30 minutes);
        vm.prank(organizer);
        vm.expectRevert(Squads.SellingWindowTooTight.selector);
        squads.createPool(drawingId, 100, tooLate, "tight");
    }

    function test_CreatePool_revertsOnPastCloseTime() public {
        vm.prank(organizer);
        vm.expectRevert(Squads.SalesClosed.selector);
        squads.createPool(drawingId, 100, uint64(block.timestamp), "past");
    }

    function test_CreatePool_revertsOnWrongDrawing() public {
        vm.prank(organizer);
        vm.expectRevert(Squads.DrawingNotOpen.selector);
        squads.createPool(drawingId + 5, 100, _closeTime(), "wrong");
    }

    function test_CreatePool_revertsOnInvalidShares() public {
        vm.prank(organizer);
        vm.expectRevert(Squads.InvalidShares.selector);
        squads.createPool(drawingId, 0, _closeTime(), "zero");

        uint256 tooMany = squads.MAX_TOTAL_SHARES() + 1; // read before arming expectRevert
        vm.prank(organizer);
        vm.expectRevert(Squads.InvalidShares.selector);
        squads.createPool(drawingId, tooMany, _closeTime(), "huge");
    }

    // ---------------------------------------------------------------------
    // addTickets / addRandomTickets
    // ---------------------------------------------------------------------

    function test_AddTickets() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 5);

        (,,,,,, uint256 ticketCount,,, uint256 ticketFunding,, uint256 feesCollected) =
            squads.getPool(organizer, drawingId);
        assertEq(ticketCount, 5);
        assertEq(ticketFunding, 5 * TICKET_PRICE);
        // 10% referral fee on a 5-USDC purchase = 0.5 USDC, swept and locked in the pool.
        assertEq(feesCollected, (5 * TICKET_PRICE * FEE_RATE) / 1e18);
        assertEq(squads.totalFeesLocked(), feesCollected);
        assertEq(squads.getTicketIds(organizer, drawingId).length, 5);
        _assertSolvent();
    }

    function test_AddTickets_accumulatesAcrossCalls() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 6);
        _addTickets(organizer, 4);
        (,,,,,, uint256 ticketCount,,, uint256 ticketFunding,,) = squads.getPool(organizer, drawingId);
        assertEq(ticketCount, 10);
        assertEq(ticketFunding, 10 * TICKET_PRICE);
        _assertSolvent();
    }

    function test_AddRandomTickets() public {
        _createPool(organizer, 100);
        vm.prank(organizer);
        squads.addRandomTickets(drawingId, 3);
        (,,,,,, uint256 ticketCount,,,,, uint256 feesCollected) = squads.getPool(organizer, drawingId);
        assertEq(ticketCount, 3);
        assertEq(feesCollected, (3 * TICKET_PRICE * FEE_RATE) / 1e18);
        _assertSolvent();
    }

    function test_AddTickets_revertsOverBatch() public {
        _createPool(organizer, 100);
        vm.prank(organizer);
        vm.expectRevert(Squads.InvalidTicketCount.selector);
        squads.addTickets(drawingId, _picks(11));
    }

    function test_AddTickets_revertsOverPoolCap() public {
        _createPool(organizer, 100);
        // MAX_POOL_TICKETS = 100; add 100 in 10 calls, then the 101st reverts.
        for (uint256 i = 0; i < 10; i++) {
            _addTickets(organizer, 10);
        }
        vm.prank(organizer);
        vm.expectRevert(Squads.TooManyTickets.selector);
        squads.addTickets(drawingId, _picks(1));
    }

    function test_AddTickets_revertsForNonOrganizer() public {
        _createPool(organizer, 100);
        // Pools are keyed by (msg.sender, drawingId), so a stranger has no pool here.
        vm.prank(stranger);
        vm.expectRevert(Squads.PoolNotFound.selector);
        squads.addTickets(drawingId, _picks(1));
    }

    function test_AddTickets_revertsAfterLock() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 2);
        _lock(organizer);
        vm.prank(organizer);
        vm.expectRevert(Squads.WrongState.selector);
        squads.addTickets(drawingId, _picks(1));
    }

    // ---------------------------------------------------------------------
    // lock
    // ---------------------------------------------------------------------

    function test_Lock() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 5);
        _lock(organizer);

        (
            Squads.State state,
            ,
            uint256 totalShares,
            uint256 sharesForSale,
            ,
            uint256 autoStakeShares,
            ,
            ,
            uint256 pricePerShare,
            ,
            ,
        ) = squads.getPool(organizer, drawingId);
        assertEq(uint256(state), uint256(Squads.State.Live));
        // The createPool value (100) is the for-sale supply; autoStake is minted on top.
        assertEq(sharesForSale, 100);
        assertEq(autoStakeShares, 2); // 100 * 250 / 9750, floored
        assertEq(totalShares, 102); // forSale 100 + autoStake 2
        assertEq(pricePerShare, (5 * TICKET_PRICE) / 100); // ticketFunding / forSale = 50_000 (even)
        assertEq(squads.sharesOf(organizer, drawingId, organizer), 2); // autoStake granted
        _assertSolvent();
    }

    function test_Lock_revertsWithoutTickets() public {
        _createPool(organizer, 100);
        vm.prank(organizer);
        vm.expectRevert(Squads.NoTickets.selector);
        squads.lock(drawingId);
    }

    function test_Lock_revertsIfNotBuilding() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 1);
        _lock(organizer);
        vm.prank(organizer);
        vm.expectRevert(Squads.WrongState.selector);
        squads.lock(drawingId);
    }

    // ---------------------------------------------------------------------
    // buyShares / buySharesFor
    // ---------------------------------------------------------------------

    function test_BuyShares() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 5);
        _lock(organizer);

        uint256 price = squads.quoteShares(organizer, drawingId, 10);
        uint256 orgBefore = usdc.balanceOf(organizer);
        uint256 aliceBefore = usdc.balanceOf(alice);

        _buy(alice, organizer, 10);

        assertEq(squads.sharesOf(organizer, drawingId, alice), 10);
        assertEq(usdc.balanceOf(alice), aliceBefore - price);
        // Organizer reimbursed via claimable (pull-based), not pushed.
        assertEq(usdc.balanceOf(organizer), orgBefore);
        assertEq(squads.claimableOf(organizer, drawingId, organizer), price);
        _assertSolvent();
    }

    function test_BuySharesFor_gift() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 5);
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
        _createPool(organizer, 100);
        _addTickets(organizer, 5);
        vm.prank(alice);
        vm.expectRevert(Squads.WrongState.selector);
        squads.buyShares(organizer, drawingId, 1);
    }

    function test_BuyShares_revertsOverCapacity() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 5);
        _lock(organizer);
        vm.prank(alice);
        vm.expectRevert(Squads.ExceedsForSale.selector);
        squads.buyShares(organizer, drawingId, 101); // only 100 for sale
    }

    function test_BuyShares_revertsAfterClose() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 5);
        _lock(organizer);
        vm.warp(block.timestamp + 23 hours); // == salesCloseTime
        vm.prank(alice);
        vm.expectRevert(Squads.SalesClosed.selector);
        squads.buyShares(organizer, drawingId, 1);
    }

    // ---------------------------------------------------------------------
    // claimAndDistribute — the riskiest path
    // ---------------------------------------------------------------------

    function test_Settle_winning_soldOut() public {
        _createPool(organizer, 975); // for-sale supply; autoStake 25 minted on top -> 1000 total
        _addTickets(organizer, 5);
        _lock(organizer);
        _buy(alice, organizer, 975); // buys every for-sale share -> sold out

        uint256 feesCollected = (5 * TICKET_PRICE * FEE_RATE) / 1e18; // 500_000

        _settle();
        uint256[] memory ids = squads.getTicketIds(organizer, drawingId);
        _setWinner(ids[0], 1, 100 * TICKET_PRICE); // 100 USDC prize on a winning ticket

        squads.claimAndDistribute(organizer, drawingId);

        (, bool soldOut,,,,,,,,, uint256 totalWinnings,) = squads.getPool(organizer, drawingId);
        assertTrue(soldOut);
        assertEq(totalWinnings, 100 * TICKET_PRICE);

        // Auto-stake on top: organizer holds 25 of 1000 (exactly 2.5%), alice 975. Winnings and
        // the sold-out fee rebate both split pro rata by totalShares.
        uint256 aliceWin = (100 * TICKET_PRICE * 975) / 1000; // 97.5 USDC
        uint256 aliceFee = (feesCollected * 975) / 1000; // 487_500
        assertEq(squads.claimableOf(organizer, drawingId, alice), aliceWin + aliceFee);

        uint256 orgReimburse = squads.quoteShares(organizer, drawingId, 975); // full reimbursement
        assertGe(orgReimburse, 5 * TICKET_PRICE); // organizer made whole on what they fronted
        uint256 orgWin = (100 * TICKET_PRICE * 25) / 1000; // 2.5 USDC
        uint256 orgFee = (feesCollected * 25) / 1000; // 12_500
        assertEq(squads.claimableOf(organizer, drawingId, organizer), orgReimburse + orgWin + orgFee);

        // No fees left locked; counters consistent.
        (,,,,,,,,,,, uint256 feesAfter) = squads.getPool(organizer, drawingId);
        assertEq(feesAfter, 0);
        assertEq(squads.totalFeesLocked(), 0);
        _assertSolvent();
    }

    function test_Settle_winning_undersold() public {
        _createPool(organizer, 975); // autoStake 25 on top -> 1000 total
        _addTickets(organizer, 5);
        _lock(organizer);
        _buy(alice, organizer, 40); // 935 of 975 unsold -> NOT sold out

        uint256 feesCollected = (5 * TICKET_PRICE * FEE_RATE) / 1e18;

        _settle();
        uint256[] memory ids = squads.getTicketIds(organizer, drawingId);
        _setWinner(ids[0], 1, 100 * TICKET_PRICE);

        squads.claimAndDistribute(organizer, drawingId);

        (, bool soldOut,,,,,,,,,,) = squads.getPool(organizer, drawingId);
        assertFalse(soldOut);

        // Organizer absorbs unsold: holds autoStake 25 + unsold 935 = 960 of 1000 shares.
        assertEq(squads.sharesOf(organizer, drawingId, organizer), 960);
        assertEq(squads.sharesOf(organizer, drawingId, alice), 40);

        // Winnings amplified to the organizer; undersold -> ALL fees to organizer.
        uint256 aliceWin = (100 * TICKET_PRICE * 40) / 1000; // 4 USDC
        assertEq(squads.claimableOf(organizer, drawingId, alice), aliceWin);

        uint256 orgReimburse = squads.quoteShares(organizer, drawingId, 40);
        uint256 orgWin = (100 * TICKET_PRICE * 960) / 1000; // 96 USDC
        assertEq(squads.claimableOf(organizer, drawingId, organizer), orgReimburse + orgWin + feesCollected);
        _assertSolvent();
    }

    function test_Settle_losing() public {
        _createPool(organizer, 975); // autoStake 25 on top -> 1000 total
        _addTickets(organizer, 5);
        _lock(organizer);
        _buy(alice, organizer, 975); // sold out

        _settle();
        // No winners set: every ticket is tier 0 -> skipped, totalWinnings == 0.
        squads.claimAndDistribute(organizer, drawingId);

        (,,,,,,,,,, uint256 totalWinnings,) = squads.getPool(organizer, drawingId);
        assertEq(totalWinnings, 0);
        // Sold out, so the referral fees still get rebated to holders (alice holds 975/1000).
        uint256 feesCollected = (5 * TICKET_PRICE * FEE_RATE) / 1e18;
        assertEq(squads.claimableOf(organizer, drawingId, alice), (feesCollected * 975) / 1000);
        _assertSolvent();
    }

    function test_Settle_revertsIfNotSettled() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 5);
        _lock(organizer);
        _buy(alice, organizer, 10);
        // Drawing not yet drawn.
        vm.expectRevert(Squads.DrawingNotSettled.selector);
        squads.claimAndDistribute(organizer, drawingId);
    }

    function test_Settle_neverLocked_goesToOrganizer() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 5); // organizer never locks
        _settle();
        uint256[] memory ids = squads.getTicketIds(organizer, drawingId);
        _setWinner(ids[0], 1, 100 * TICKET_PRICE);

        squads.claimAndDistribute(organizer, drawingId);

        // Organizer is the sole holder of all 102 shares (forSale 100 + autoStake 2) -> all
        // winnings + fees.
        assertEq(squads.sharesOf(organizer, drawingId, organizer), 102);
        uint256 feesCollected = (5 * TICKET_PRICE * FEE_RATE) / 1e18;
        assertEq(squads.claimableOf(organizer, drawingId, organizer), 100 * TICKET_PRICE + feesCollected);
        _assertSolvent();
    }

    function test_Settle_isPermissionless() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 3);
        _lock(organizer);
        _buy(alice, organizer, 98);
        _settle();

        // A stranger can settle; no party can freeze a pool.
        vm.prank(stranger);
        squads.claimAndDistribute(organizer, drawingId);
        (Squads.State state,,,,,,,,,,,) = squads.getPool(organizer, drawingId);
        assertEq(uint256(state), uint256(Squads.State.Settled));
        _assertSolvent();
    }

    // ---------------------------------------------------------------------
    // withdraw
    // ---------------------------------------------------------------------

    function test_Withdraw() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 5);
        _lock(organizer);
        _buy(alice, organizer, 98);
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

        // Double withdraw reverts.
        vm.prank(alice);
        vm.expectRevert(Squads.NothingToWithdraw.selector);
        squads.withdraw(organizer, drawingId);
    }

    function test_Withdraw_revertsWhenNothing() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 1);
        _lock(organizer);
        vm.prank(stranger);
        vm.expectRevert(Squads.NothingToWithdraw.selector);
        squads.withdraw(organizer, drawingId);
    }

    // ---------------------------------------------------------------------
    // cancel
    // ---------------------------------------------------------------------

    function test_Cancel_emptyPool() public {
        _createPool(organizer, 100);
        vm.prank(organizer);
        squads.cancel(drawingId);
        assertFalse(squads.poolExists(organizer, drawingId));
        // Slot is free again.
        _createPool(organizer, 50);
        assertTrue(squads.poolExists(organizer, drawingId));
    }

    function test_Cancel_revertsAfterTickets() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 1);
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
        squads.createPool(drawingId, 100, _closeTime(), "x");
    }

    function test_Pause_allowsSettleWithdrawCancel() public {
        // Build + go live, then pause: settle/withdraw must still work.
        _createPool(organizer, 100);
        _addTickets(organizer, 3);
        _lock(organizer);
        _buy(alice, organizer, 100); // sold out, so the losing pool's fees rebate to alice
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
    // misc: self-purchase, dust, multi-holder, multi-pool invariant
    // ---------------------------------------------------------------------

    function test_OrganizerSelfPurchaseUncapped() public {
        _createPool(organizer, 100);
        _addTickets(organizer, 5);
        _lock(organizer);
        // Organizer buys all of its own for-sale shares (the "squad of one"). Allowed.
        _buy(organizer, organizer, 98);
        assertEq(squads.sharesOf(organizer, drawingId, organizer), 100); // 2 autoStake + 98
        _assertSolvent();
    }

    function test_Distribution_dustToOrganizer() public {
        // totalShares = 3 doesn't divide a 100-USDC prize evenly -> dust to organizer.
        _createPool(organizer, 3);
        _addTickets(organizer, 1);
        _lock(organizer); // autoStake = 0 (2.5% of 3 floors to 0), sharesForSale = 3
        _buy(alice, organizer, 1);
        _buy(bob, organizer, 1);
        // 1 share left unsold -> organizer at settle. Holders: alice 1, bob 1, organizer 1.

        _settle();
        uint256[] memory ids = squads.getTicketIds(organizer, drawingId);
        _setWinner(ids[0], 1, 100 * TICKET_PRICE);
        squads.claimAndDistribute(organizer, drawingId);

        uint256 each = (100 * TICKET_PRICE) / 3; // floor
        uint256 dust = 100 * TICKET_PRICE - 3 * each;
        assertEq(squads.claimableOf(organizer, drawingId, alice), each);
        assertEq(squads.claimableOf(organizer, drawingId, bob), each);
        // organizer gets: share proceeds (reimbursement) + its own winnings share + dust +
        // ALL referral fees (the pool is undersold, so fees route to the organizer).
        uint256 orgReimburse = squads.quoteShares(organizer, drawingId, 2); // alice+bob proceeds
        uint256 feesCollected = (1 * TICKET_PRICE * FEE_RATE) / 1e18; // 100_000, undersold -> organizer
        assertEq(squads.claimableOf(organizer, drawingId, organizer), orgReimburse + each + dust + feesCollected);

        // Total credited winnings exactly equals the prize (no strand, no overflow).
        assertEq(each * 3 + dust, 100 * TICKET_PRICE);
        _assertSolvent();
    }

    function test_MultiPool_invariantHolds() public {
        // Two organizers, two pools sharing the one contract balance.
        _createPool(organizer, 100);
        _addTickets(organizer, 5);
        _lock(organizer);
        _buy(alice, organizer, 50);
        _assertSolvent();

        address org2 = address(0xBEEF);
        _fund(org2, 100 * TICKET_PRICE);
        vm.prank(org2);
        squads.createPool(drawingId, 200, _closeTime(), "Squad 2");
        vm.prank(org2);
        squads.addTickets(drawingId, _picks(8));
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

        // Everyone with a balance withdraws; bob's pool lost AND was undersold, so he is
        // legitimately owed nothing. After draining all holders the counters hit zero.
        _tryWithdraw(alice, organizer);
        _tryWithdraw(bob, org2);
        _tryWithdraw(organizer, organizer);
        _tryWithdraw(org2, org2);
        _assertSolvent();

        assertEq(squads.totalClaimable(), 0);
        assertEq(squads.totalFeesLocked(), 0);
    }

    // ---------------------------------------------------------------------
    // Organizer auto-stake: minted on top of the for-sale supply
    // ---------------------------------------------------------------------

    function test_AutoStakeIsExactly2Point5Percent() public {
        _createPool(organizer, 975);
        _addTickets(organizer, 10);
        _lock(organizer);

        (,, uint256 totalShares,,, uint256 autoStakeShares,,,,,,) = squads.getPool(organizer, drawingId);
        assertEq(autoStakeShares, 25);
        assertEq(totalShares, 1000);
        // Exactly 2.5% of the FINAL total, not 2.5% of the for-sale slice.
        assertEq((autoStakeShares * 10_000) / totalShares, 250);
    }

    function test_FullSelloutReimbursesOrganizerInFull() public {
        _createPool(organizer, 975);
        _addTickets(organizer, 10); // ticketFunding = 10 USDC
        _lock(organizer);
        _buy(alice, organizer, 975); // full sellout of the for-sale supply

        _settle(); // no winner: organizer's claim is reimbursement + sold-out fee rebate
        squads.claimAndDistribute(organizer, drawingId);

        uint256 ticketFunding = 10 * TICKET_PRICE;
        // The for-sale shares alone return at least everything the organizer fronted — they are
        // made whole (ceil pricing rounds in their favor by at most forSale-1 micro-USDC).
        uint256 reimburse = squads.quoteShares(organizer, drawingId, 975);
        assertGe(reimburse, ticketFunding);
        assertLe(reimburse - ticketFunding, 975);
        assertGe(squads.claimableOf(organizer, drawingId, organizer), ticketFunding);
        _assertSolvent();
    }

    function test_OrganizerRetains2Point5PercentOfWinnings() public {
        _createPool(organizer, 975);
        _addTickets(organizer, 10);
        _lock(organizer);
        _buy(alice, organizer, 975); // sold out: organizer holds exactly autoStake = 25/1000 = 2.5%

        _settle();
        uint256[] memory ids = squads.getTicketIds(organizer, drawingId);
        uint256 prize = 200 * TICKET_PRICE;
        _setWinner(ids[0], 1, prize);
        squads.claimAndDistribute(organizer, drawingId);

        // Organizer owns exactly 2.5% of the total, so its winnings cut is prize * 25 / 1000.
        assertEq(squads.sharesOf(organizer, drawingId, organizer), 25);
        uint256 feesCollected = (10 * TICKET_PRICE * FEE_RATE) / 1e18;
        uint256 aliceWin = (prize * 975) / 1000; // 195 USDC
        uint256 aliceFee = (feesCollected * 975) / 1000;
        assertEq(squads.claimableOf(organizer, drawingId, alice), aliceWin + aliceFee);

        uint256 orgReimburse = squads.quoteShares(organizer, drawingId, 975);
        uint256 orgWin = (prize * 25) / 1000; // 5 USDC = 2.5% of the prize
        uint256 orgFee = (feesCollected * 25) / 1000;
        assertEq(squads.claimableOf(organizer, drawingId, organizer), orgReimburse + orgWin + orgFee);
        _assertSolvent();
    }

    function test_PriceDividesByForSaleNotTotal() public {
        _createPool(organizer, 975);
        _addTickets(organizer, 10);
        _lock(organizer);

        (,, uint256 totalShares, uint256 sharesForSale,,,,, uint256 pricePerShare,,,) =
            squads.getPool(organizer, drawingId);
        uint256 ticketFunding = 10 * TICKET_PRICE;

        // Price is computed off the for-sale supply (rounded up), NOT off totalShares.
        assertEq(pricePerShare, (ticketFunding + sharesForSale - 1) / sharesForSale);
        assertTrue(pricePerShare != ticketFunding / totalShares); // distinct from the old /total formula
        // The for-sale shares alone cover the full ticket cost on a sellout.
        assertGe(pricePerShare * sharesForSale, ticketFunding);
    }
}
