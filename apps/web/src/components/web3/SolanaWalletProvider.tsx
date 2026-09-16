'use client'

/**
 * Solana browser-wallet context (Phantom, Solflare, Backpack, Coinbase Solana …).
 *
 * No adapter list is passed on purpose: `WalletProvider` discovers every wallet
 * that registers itself through the Wallet Standard, which all current Solana
 * extensions do. That keeps the bundle small and means new wallets show up
 * without a code change.
 */
import { type ReactNode, useMemo } from 'react'
import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import type { Adapter } from '@solana/wallet-adapter-base'
import { solanaRpcEndpoint } from '@/lib/solana/config'

const NO_MANUAL_ADAPTERS: Adapter[] = []

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const config = useMemo(() => ({ commitment: 'confirmed' as const }), [])

  return (
    <ConnectionProvider endpoint={solanaRpcEndpoint} config={config}>
      <WalletProvider
        wallets={NO_MANUAL_ADAPTERS}
        autoConnect
        onError={(err) => {
          // User-cancelled connect/sign throws here too; the calling component
          // surfaces its own toast, so don't double-report.
          if (process.env.NODE_ENV !== 'production') {
            console.warn('[solana-wallet]', err.name, err.message)
          }
        }}
      >
        {children}
      </WalletProvider>
    </ConnectionProvider>
  )
}
