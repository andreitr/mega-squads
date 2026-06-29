import Link from "next/link";
import { TopBar } from "@/components/TopBar";

// Discover feed. The pool grid (PoolCard + Live/Sold-out tabs) is wired in Phase 3 once the
// PoolCreated log-indexing data layer (lib/pools.ts) lands. For now: the shell + hero + promo.
export default function HomePage() {
  return (
    <main className="relative">
      <TopBar />
      <div className="mx-auto w-full max-w-[980px] px-4 py-6">
        <div className="grid grid-cols-1 gap-[18px] md:grid-cols-[1.7fr_1fr]">
          <section className="rounded-card border border-white/[0.06] bg-surface p-6">
            <h1 className="text-[30px] font-bold leading-tight tracking-[-0.6px] text-txt">
              Group lottery pools
            </h1>
            <p className="mt-2 max-w-md text-[14px] text-txt-muted">
              A host funds a batch of tickets, keeps a slice, and sells the rest as shares. As friends
              buy in, the host is repaid. If the pool wins, the prize splits by share.
            </p>
          </section>
          <Link
            href="/create"
            className="flex flex-col justify-between rounded-card border border-accent/30 bg-accent/[0.06] p-6 transition-colors hover:bg-accent/[0.1]"
          >
            <span className="font-mono text-[11px] uppercase tracking-[0.1em] text-accent">Host your own</span>
            <span className="mt-3 text-[18px] font-bold text-txt">Create a pool →</span>
          </Link>
        </div>

        <div className="mt-8 rounded-card border border-white/[0.06] bg-surface p-8 text-center font-mono text-[12px] text-txt-faint">
          Discover feed lands in Phase 3 (PoolCreated indexing). Create a pool to get started.
        </div>
      </div>
    </main>
  );
}
