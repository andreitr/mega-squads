"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ConnectKitButton } from "connectkit";

const NAV = [
  { href: "/", label: "Discover" },
  { href: "/portfolio", label: "Portfolio" },
];

export function TopBar() {
  const pathname = usePathname();
  const router = useRouter();

  return (
    <header className="sticky top-0 z-40 border-b border-white/[0.07] bg-[rgba(14,13,12,0.92)] backdrop-blur-xl">
      <div className="mx-auto flex h-[66px] max-w-[1200px] items-center gap-[18px] px-4 sm:gap-[26px] sm:px-7">
        <Link href="/" className="flex items-center gap-[9px]">
          <span className="h-[11px] w-[11px] rounded-full bg-accent shadow-ball" />
          <span className="text-[20px] font-bold tracking-[-0.5px] text-txt">POOLS</span>
        </Link>

        <nav className="flex items-center gap-0.5">
          {NAV.map((n) => {
            const active = n.href === "/" ? pathname === "/" : pathname.startsWith(n.href);
            return (
              <Link
                key={n.href}
                href={n.href}
                className={`rounded-[10px] px-[10px] py-2 text-[14px] font-semibold sm:px-[14px] ${active ? "text-accent" : "text-txt-muted hover:text-txt"}`}
              >
                {n.label}
              </Link>
            );
          })}
        </nav>

        <div className="ml-auto flex items-center gap-3">
          <Link
            href="/create"
            className="flex items-center gap-2 rounded-[11px] bg-accent px-4 py-[10px] text-[14px] font-bold text-bg hover:bg-[#d4ff66]"
          >
            <svg width="14" height="14" viewBox="0 0 16 16" aria-hidden>
              <rect x="7" y="1" width="2" height="14" rx="1" fill="#0a0908" />
              <rect x="1" y="7" width="14" height="2" rx="1" fill="#0a0908" />
            </svg>
            <span className="hidden sm:inline">Host a pool</span>
          </Link>

          <ConnectKitButton.Custom>
            {({ isConnected, show, truncatedAddress }) =>
              isConnected ? (
                <button
                  onClick={() => router.push("/portfolio")}
                  title={truncatedAddress}
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-white/[0.08] bg-raised font-mono text-[12px] font-bold text-accent"
                >
                  YOU
                </button>
              ) : (
                <button
                  onClick={show}
                  className="rounded-[11px] border border-white/[0.08] bg-raised px-4 py-[10px] text-[13px] font-semibold text-txt-muted hover:text-txt"
                >
                  Connect
                </button>
              )
            }
          </ConnectKitButton.Custom>
        </div>
      </div>
    </header>
  );
}
