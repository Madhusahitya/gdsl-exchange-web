'use client'

import dynamic from 'next/dynamic'
import { PortfolioProvider } from '@/context/PortfolioContext'
import { ToastProvider } from '@/context/ToastContext'
import { Toaster } from 'sonner'
import { ErrorBoundary } from '@/components/ErrorBoundary'

const Web3Provider = dynamic(
  () => import('@/components/web3/Web3Provider').then((m) => m.Web3Provider),
  { ssr: false, loading: () => null },
)

export function AppProviders({ children }: { children: React.ReactNode }) {
  return (
    <PortfolioProvider>
      <Web3Provider>
        <ToastProvider>
          <ErrorBoundary>{children}</ErrorBoundary>
          <Toaster
            richColors
            closeButton
            expand
            position="bottom-right"
            duration={8000}
            toastOptions={{
              className: 'font-mono text-sm border border-emerald-500/20',
            }}
          />
        </ToastProvider>
      </Web3Provider>
    </PortfolioProvider>
  )
}
