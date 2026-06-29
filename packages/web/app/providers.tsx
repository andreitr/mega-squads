"use client";

import dynamic from "next/dynamic";

// WalletConnect (via ConnectKit's default config) touches IndexedDB at connector construction,
// which doesn't exist in Node. Dynamic-import the wagmi/ConnectKit tree with ssr:false so it never
// loads on the server. The fallback renders identical content on server + first client paint.
const ClientProviders = dynamic(() => import("./client-providers"), {
  ssr: false,
  loading: () => <BootShell />,
});

export function Providers({ children }: { children: React.ReactNode }) {
  return <ClientProviders>{children}</ClientProviders>;
}

function BootShell() {
  return (
    <div className="mx-auto flex w-full max-w-[980px] items-center justify-between px-4 pt-5">
      <div className="flex items-center gap-2">
        <span className="h-[11px] w-[11px] rounded-[3px] bg-accent" />
        <span className="text-[20px] font-bold tracking-[-0.5px] text-txt">POOLS</span>
      </div>
      <div className="h-9 w-32 animate-pulseGlow rounded-btn bg-surface" />
    </div>
  );
}
