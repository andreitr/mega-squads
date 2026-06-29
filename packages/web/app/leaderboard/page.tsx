import { TopBar } from "@/components/TopBar";

// Phase 5: rank organizers by pools hosted / sell-through / winnings (aggregated from PoolCreated +
// Distributed logs, optionally cross-referenced with the Megapot Data API).
export default function LeaderboardPage() {
  return (
    <main className="relative">
      <TopBar />
      <div className="mx-auto w-full max-w-[780px] px-4 py-6">
        <h1 className="text-[26px] font-bold tracking-[-0.5px] text-txt">Organizer board</h1>
        <p className="mt-1 text-[13px] text-txt-muted">You're hot — host a pool and keep the fees.</p>
        <div className="mt-6 rounded-card border border-white/[0.06] bg-surface p-8 text-center font-mono text-[12px] text-txt-faint">
          Leaderboard lands in Phase 5.
        </div>
      </div>
    </main>
  );
}
