import { TopBar } from "@/components/TopBar";
import { Discover } from "@/components/Discover";

// Discover feed: jackpot hero + "Host your own pool" promo + Live/Sold-out tabs + pool-card grid.
// All data is read straight from chain (Discover → useCurrentRoundPools: PoolCreated logs +
// getPool multicall + getDrawingState for the jackpot/countdown), no off-chain indexer.
export default function HomePage() {
  return (
    <main className="relative">
      <TopBar />
      <Discover />
    </main>
  );
}
