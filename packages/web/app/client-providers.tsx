"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ConnectKitProvider } from "connectkit";
import { Toaster } from "sonner";
import { WagmiProvider } from "wagmi";
import { wagmiConfig } from "@/lib/wagmi";
import { BASE_CHAIN_ID } from "@/lib/addresses";

const queryClient = new QueryClient({
  defaultOptions: { queries: { staleTime: 10_000, refetchOnWindowFocus: true } },
});

export default function ClientProviders({ children }: { children: React.ReactNode }) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ConnectKitProvider
          mode="dark"
          options={{ initialChainId: BASE_CHAIN_ID }}
          customTheme={{
            "--ck-accent-color": "#c6ff3a",
            "--ck-accent-text-color": "#0a0908",
            "--ck-primary-button-background": "#c6ff3a",
            "--ck-primary-button-color": "#0a0908",
            "--ck-primary-button-hover-background": "#d4ff66",
            "--ck-focus-color": "#c6ff3a",
            "--ck-border-radius": "13px",
            "--ck-body-background": "#161412",
            "--ck-font-family": "var(--font-space-grotesk), ui-sans-serif, system-ui, sans-serif",
          }}
        >
          {children}
          <Toaster
            theme="dark"
            position="bottom-right"
            richColors
            closeButton
            toastOptions={{
              style: {
                background: "#161412",
                border: "1px solid rgba(255,255,255,0.1)",
                color: "#f4f1ea",
                fontFamily: "var(--font-jetbrains-mono), ui-monospace, monospace",
                fontSize: "12px",
              },
            }}
          />
        </ConnectKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
