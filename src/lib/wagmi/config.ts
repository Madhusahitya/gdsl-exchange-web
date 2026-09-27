import { createConfig, http, fallback } from 'wagmi'
import { bsc, mainnet } from 'wagmi/chains'
import { coinbaseWallet, injected, metaMask, walletConnect } from '@wagmi/connectors'

const walletConnectProjectId = (process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? '').trim()
// WalletConnect runs a persistent websocket subscription as soon as the
// connector is instantiated — when the relay drops we get noisy "Connection
// interrupted while trying to subscribe" rejections that bubble up as Next.js
// dev-overlay errors (handled in Web3Provider).
//
// Having a project id is the real signal that someone wants WalletConnect, so
// it is on by default whenever one is set. NEXT_PUBLIC_WALLETCONNECT_ENABLED=false
// still forces it off for local dev.
const walletConnectFlag = (process.env.NEXT_PUBLIC_WALLETCONNECT_ENABLED ?? '').trim().toLowerCase()
const walletConnectEnabled = walletConnectFlag === 'false' ? false : Boolean(walletConnectProjectId)
const bscRpcUrl = process.env.NEXT_PUBLIC_BSC_RPC_URL?.trim()
const bscRpcFallback1 = process.env.NEXT_PUBLIC_BSC_RPC_FALLBACK_1?.trim()
const bscRpcFallback2 = process.env.NEXT_PUBLIC_BSC_RPC_FALLBACK_2?.trim()

const appUrl = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000'
type WagmiConfigType = ReturnType<typeof createConfig>

declare global {
  // eslint-disable-next-line no-var
  var __gdslWagmiConfig__: WagmiConfigType | undefined
}

/**
 * Connectors ordered for clarity in the UI:
 * - MetaMask: dedicated SDK connector
 * - Coinbase Wallet: app + extension
 * - WalletConnect: QR + deep links — primary path for Trust Wallet mobile, Rainbow, OKX, etc.
 * - Injected: Trust browser extension, Rabby, Brave, other EIP-1193 / EIP-6963 wallets
 */
function buildWagmiConfig(): WagmiConfigType {
  const connectors = [
    metaMask(),
    coinbaseWallet({
      appName: 'koie.fin',
      preference: 'all',
    }),
    ...(walletConnectEnabled && walletConnectProjectId
      ? [
          walletConnect({
            projectId: walletConnectProjectId,
            showQrModal: true,
            metadata: {
              name: 'koie.fin',
              description: 'DEX trading terminal — BNB Smart Chain',
              url: appUrl,
              icons: [`${appUrl.replace(/\/$/, '')}/favicon.ico`],
            },
          }),
        ]
      : []),
    injected({ shimDisconnect: true }),
  ]

  return createConfig({
    /** BSC first (default). Include Ethereum so wallets can switch cleanly — single-chain configs confuse MetaMask when users hop networks. */
    chains: [bsc, mainnet],
    connectors,
    transports: {
      [bsc.id]: fallback([
        ...(bscRpcUrl ? [http(bscRpcUrl)] : []),
        ...(bscRpcFallback1 ? [http(bscRpcFallback1)] : []),
        ...(bscRpcFallback2 ? [http(bscRpcFallback2)] : []),
        http(), // Default fallback
      ]),
      [mainnet.id]: http(),
    },
    // Keep wallet connectors client-side to prevent server/hot-reload double init noise.
    ssr: false,
  })
}

export const wagmiConfig = globalThis.__gdslWagmiConfig__ ?? buildWagmiConfig()
if (!globalThis.__gdslWagmiConfig__) {
  globalThis.__gdslWagmiConfig__ = wagmiConfig
}

export function isWalletConnectConfigured(): boolean {
  return walletConnectEnabled && Boolean(walletConnectProjectId)
}
