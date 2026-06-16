// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {Squads} from "../src/Squads.sol";
import {IJackpot} from "../src/interfaces/IJackpot.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {MockJackpot} from "./mocks/MockJackpot.sol";
import {MockRandomTicketBuyer} from "./mocks/MockRandomTicketBuyer.sol";

/**
 * @notice Stateful fuzzing of the cross-pool solvency invariant — the headline risk of
 *         the single-contract design (every pool shares one USDC balance). The handler
 *         drives random create / add / lock / buy / settle / claim / withdraw sequences
 *         across multiple organizers and drawings; after every call the invariant asserts
 *         that outstanding liabilities never exceed the contract's USDC balance.
 */
contract SquadsHandler is Test {
    Squads public squads;
    MockUSDC public usdc;
    MockJackpot public jackpot;

    address[] internal actors;

    struct Ref {
        address org;
        uint256 draw;
    }

    Ref[] internal refs;

    constructor(Squads _squads, MockUSDC _usdc, MockJackpot _jackpot, address[] memory _actors) {
        squads = _squads;
        usdc = _usdc;
        jackpot = _jackpot;
        actors = _actors;
    }

    function _actor(uint256 s) internal view returns (address) {
        return actors[s % actors.length];
    }

    function _picks(uint256 n) internal pure returns (IJackpot.Ticket[] memory arr) {
        arr = new IJackpot.Ticket[](n);
        for (uint256 i; i < n; i++) {
            arr[i].normals = new uint8[](5);
            for (uint8 j; j < 5; j++) {
                arr[i].normals[j] = j + 1;
            }
            arr[i].bonusball = uint8(i + 1);
        }
    }

    function createPool(uint256 orgSeed, uint256 shares) public {
        address org = _actor(orgSeed);
        uint256 draw = jackpot.currentDrawingId();
        if (squads.poolExists(org, draw)) return;
        shares = bound(shares, 1, 200);
        uint64 close = uint64(block.timestamp + 23 hours);
        vm.prank(org);
        try squads.createPool(draw, shares, close, "h") {
            refs.push(Ref(org, draw));
        } catch {}
    }

    function addTickets(uint256 refSeed, uint256 n) public {
        if (refs.length == 0) return;
        Ref memory r = refs[refSeed % refs.length];
        n = bound(n, 1, 5);
        vm.prank(r.org);
        try squads.addTickets(r.draw, _picks(n)) {} catch {}
    }

    function lock(uint256 refSeed) public {
        if (refs.length == 0) return;
        Ref memory r = refs[refSeed % refs.length];
        vm.prank(r.org);
        try squads.lock(r.draw) {} catch {}
    }

    function buyShares(uint256 refSeed, uint256 buyerSeed, uint256 amount) public {
        if (refs.length == 0) return;
        Ref memory r = refs[refSeed % refs.length];
        amount = bound(amount, 1, 50);
        vm.prank(_actor(buyerSeed));
        try squads.buyShares(r.org, r.draw, amount) {} catch {}
    }

    function settle() public {
        uint256 draw = jackpot.currentDrawingId();
        uint256 dt = jackpot.getDrawingState(draw).drawingTime;
        if (block.timestamp <= dt) vm.warp(dt + 1);
        try jackpot.settleDrawing() {} catch {}
    }

    function claim(uint256 refSeed) public {
        if (refs.length == 0) return;
        Ref memory r = refs[refSeed % refs.length];
        try squads.claimAndDistribute(r.org, r.draw) {} catch {}
    }

    function withdraw(uint256 refSeed, uint256 actorSeed) public {
        if (refs.length == 0) return;
        Ref memory r = refs[refSeed % refs.length];
        vm.prank(_actor(actorSeed));
        try squads.withdraw(r.org, r.draw) {} catch {}
    }
}

contract SquadsInvariantTest is Test {
    Squads internal squads;
    MockUSDC internal usdc;
    MockJackpot internal jackpot;
    MockRandomTicketBuyer internal randomBuyer;
    SquadsHandler internal handler;

    function setUp() public {
        vm.warp(1_700_000_000);
        usdc = new MockUSDC();
        jackpot = new MockJackpot(address(usdc), 1_000_000, 1 days);
        randomBuyer = new MockRandomTicketBuyer(address(usdc), address(jackpot));
        squads = new Squads(address(usdc), address(jackpot), address(randomBuyer), address(this));

        address[] memory actors = new address[](4);
        actors[0] = address(0xA1);
        actors[1] = address(0xA2);
        actors[2] = address(0xA3);
        actors[3] = address(0xA4);
        for (uint256 i; i < actors.length; i++) {
            usdc.mint(actors[i], 1_000_000 * 1_000_000);
            vm.prank(actors[i]);
            usdc.approve(address(squads), type(uint256).max);
        }
        // Buffer so the Jackpot can always honor referral sweeps and any payouts.
        usdc.mint(address(jackpot), 1_000_000 * 1_000_000);

        handler = new SquadsHandler(squads, usdc, jackpot, actors);
        targetContract(address(handler));
    }

    /// @notice Liabilities (owed winnings/rebates + locked fees) never exceed the balance.
    function invariant_solvent() public view {
        assertTrue(squads.isSolvent(), "INSOLVENT: liabilities exceed USDC balance");
        assertLe(squads.totalClaimable() + squads.totalFeesLocked(), usdc.balanceOf(address(squads)));
    }
}
