"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ConnectKitButton } from "connectkit";

const NAV = [
  { href: "/", label: "Feed" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/leaderboard", label: "Leaderboard" },
];

export function TopBar() {
  const pathname = usePathname();
  return (
    <header className="mx-auto flex w-full max-w-[980px] items-center justify-between gap-4 px-4 pt-5 pb-2">
      <div className="flex items-center gap-6">
        <Link href="/" className="flex items-center gap-2">
          <span className="h-[11px] w-[11px] rounded-[3px] bg-accent" />
          <span className="text-[20px] font-bold tracking-[-0.5px] text-txt">POOLS</span>
        </Link>
        <nav className="hidden items-center gap-4 sm:flex">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`font-mono text-[13px] ${active ? "text-accent" : "text-txt-muted hover:text-txt"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>
      </div>
      <div className="flex items-center gap-3">
        <Link
          href="/create"
          className="hidden rounded-btn bg-accent px-4 py-2 text-[13px] font-semibold text-bg hover:bg-[#d4ff66] sm:block"
        >
          Host a pool
        </Link>
        <ConnectKitButton showBalance={false} />
      </div>
    </header>
  );
}
