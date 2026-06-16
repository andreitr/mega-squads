// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Script, console} from "forge-std/Script.sol";
import {Squads} from "../src/Squads.sol";

/// @notice Deploys Squads. Defaults target Base mainnet (chain ID 8453); override any
///         value via environment variables:
///   USDC_ADDRESS         - USDC token                  (default: Base USDC)
///   JACKPOT_ADDRESS      - Megapot Jackpot             (default: Base Jackpot)
///   RANDOM_BUYER_ADDRESS - Megapot RandomTicketBuyer   (default: Base buyer)
///   OWNER_ADDRESS        - initial owner (pause admin)  (default: INITIAL_OWNER below)
///
/// Squads is both the recipient and the referrer of every ticket it buys, so Megapot
/// accrues referral fees to Squads itself — no separate referrer wallet to wire. The
/// owner role only controls pause(); organizers front their own capital, so there is no
/// reserve to seed after deploy.
///
/// Usage:
///   forge script script/Deploy.s.sol:Deploy --rpc-url $RPC_URL --broadcast --verify
contract Deploy is Script {
    // Base mainnet (chain ID 8453). Source: https://llms.megapot.io/
    address internal constant BASE_USDC = 0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913;
    address internal constant BASE_JACKPOT = 0x3bAe643002069dBCbcd62B1A4eb4C4A397d042a2;
    address internal constant BASE_RANDOM_BUYER = 0xb9560b43b91dE2c1DaF5dfbb76b2CFcDaFc13aBd;

    /// @notice Initial contract owner (pause admin). Override with OWNER_ADDRESS.
    address internal constant INITIAL_OWNER = 0x1d671d1B191323A38490972D58354971E5c1cd2A;

    function run() external returns (Squads squads) {
        address usdc = vm.envOr("USDC_ADDRESS", BASE_USDC);
        address jackpot = vm.envOr("JACKPOT_ADDRESS", BASE_JACKPOT);
        address randomBuyer = vm.envOr("RANDOM_BUYER_ADDRESS", BASE_RANDOM_BUYER);
        address owner = vm.envOr("OWNER_ADDRESS", INITIAL_OWNER);

        vm.startBroadcast();
        squads = new Squads(usdc, jackpot, randomBuyer, owner);
        vm.stopBroadcast();

        console.log("Squads deployed at:", address(squads));
        console.log("  USDC:        ", usdc);
        console.log("  Jackpot:     ", jackpot);
        console.log("  randomBuyer: ", randomBuyer);
        console.log("  owner:       ", owner);
    }
}
