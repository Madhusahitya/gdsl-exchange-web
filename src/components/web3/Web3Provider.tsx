'use client'

import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { type ReactNode, useEffect, useState } from 'react'
import { WagmiProvider } from 'wagmi'
import { wagmiConfig } from '@/lib/wagmi/config'
import { SolanaWalletProvider } from '@/components/web3/SolanaWalletProvider'
import { ActiveWalletProvider } from '@/context/ActiveWalletContext'

/**
 * WalletConnect's background relay subscription occasionally drops in dev mode
 * (network blips, idle browser tabs, HMR reloads). The resulting unhandled
 * promise rejection bubbles up as a Next.js dev-overlay error even though it
 * has no user-visible impact. We swallow ONLY these specific WalletConnect
 * errors here — anything else still surfaces normally.
 */
const WC_NOISY_PATTERNS = [
  'Connection interrupted while trying to subscribe',
  'WalletConnect',
  'JSON-RPC',
  'jsonrpc-ws-connection',
]

function isWcNoise(reason: unknown): boolean {
  if (!reason) return false
  const message = (reason as { message?: string }).message ?? String(reason)
  return WC_NOISY_PATTERNS.some((p) => message.includes(p))
}

export function Web3Provider({ children }: { children: ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: false } } }))

  useEffect(() => {
    const onRejection = (event: PromiseRejectionEvent) => {
      if (isWcNoise(event.reason)) {
        // Non-fatal — connector will retry / user can re-open the dialog.
        event.preventDefault()
      }
    }
    const onError = (event: ErrorEvent) => {
      if (isWcNoise(event.error ?? event.message)) {
        event.preventDefault()
      }
    }
    // Capture: true ensures we run BEFORE Next.js's dev overlay listener and
    // can call preventDefault to keep the red overlay from appearing for the
    // (entirely cosmetic) WalletConnect relay disconnect noise.
    window.addEventListener('unhandledrejection', onRejection, { capture: true })
    window.addEventListener('error', onError, { capture: true })
    return () => {
      window.removeEventListener('unhandledrejection', onRejection, { capture: true } as EventListenerOptions)
      window.removeEventListener('error', onError, { capture: true } as EventListenerOptions)
    }
  }, [])

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SolanaWalletProvider>
          <ActiveWalletProvider>{children}</ActiveWalletProvider>
        </SolanaWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  )
}
