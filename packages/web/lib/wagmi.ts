import { getDefaultConfig } from "connectkit";
import { createConfig, http } from "wagmi";
import { base, mainnet } from "wagmi/chains";

// ConnectKit's getDefaultConfig wires a sensible default wallet set (Injected, Coinbase Wallet,
// WalletConnect, Safe) plus storage + SSR glue; createConfig passes it through.
//
// WalletConnect needs a free project id from https://cloud.walletconnect.com. If unset, Injected +
// Coinbase Wallet still work; WalletConnect-based wallets won't connect.
const projectId = process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID || "megapools-dev-placeholder";

// Frontend RPC. Set NEXT_PUBLIC_ALCHEMY_API_KEY for a dedicated endpoint (the key ships in the
// client bundle either way), or fall back to the public RPCs. Base = all contract reads/writes;
// Ethereum mainnet (chain 1) is only for ConnectKit's ENS name/avatar resolution.
const alchemyKey = process.env.NEXT_PUBLIC_ALCHEMY_API_KEY;
const baseRpcUrl = alchemyKey ? `https://base-mainnet.g.alchemy.com/v2/${alchemyKey}` : "https://mainnet.base.org";
const mainnetRpcUrl = alchemyKey ? `https://eth-mainnet.g.alchemy.com/v2/${alchemyKey}` : "https://eth.llamarpc.com";

export const wagmiConfig = createConfig(
  getDefaultConfig({
    appName: "Mega Pools",
    appDescription: "Host and join group lottery pools on Base",
    appUrl: "https://pools.fun",
    walletConnectProjectId: projectId,
    chains: [base, mainnet],
    transports: {
      [base.id]: http(baseRpcUrl),
      [mainnet.id]: http(mainnetRpcUrl),
    },
    ssr: true,
  }),
);
