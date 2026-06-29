import { TopBar } from "@/components/TopBar";

// Phase 2/3: list the connected user's hosted pools (getHistory) + bought-in positions
// (SharesPurchased logs), each with claimableOf + a withdraw action.
export default function PortfolioPage() {
  return (
    <main className="relative">
      <TopBar />
      <div className="mx-auto w-full max-w-[720px] px-4 py-6">
        <h1 className="text-[24px] font-bold text-txt">Your pools</h1>
        <div className="mt-6 rounded-card border border-white/[0.06] bg-surface p-8 text-center font-mono text-[12px] text-txt-faint">
          Portfolio lands with the data layer (Phase 3) — your hosted pools + positions.
        </div>
      </div>
    </main>
  );
}
