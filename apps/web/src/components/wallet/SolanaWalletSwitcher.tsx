'use client'

/**
 * Shows which Solana wallet the page is currently reporting on, and lets the
 * user flip between their connected browser wallet and the platform wallet.
 *
 * The distinction matters beyond display: both wallets can trade, but the bot
 * only holds a key for the platform wallet, so take-profit, stop-loss and
 * Super Machine cannot act on a self-custody position. That is stated up front
 * rather than discovered after a fill.
 */
import { useWallet } from '@solana/wallet-adapter-react'
import { toast } from 'sonner'
import { useActiveWallet } from '@/context/ActiveWalletContext'
import { shortSolanaAddress } from '@/lib/solana/config'
import type { SolanaWalletView } from '@/hooks/useSolanaWalletView'

export function SolanaWalletSwitcher({ view }: { view: SolanaWalletView }) {
  const { solana } = useActiveWallet()
  const { wallets, select, connect, connecting } = useWallet()

  const installed = wallets.filter((w) => w.readyState === 'Installed' || w.readyState === 'Loadable')

  const connectBrowser = async () => {
    const first = installed[0]
    if (!first) {
      toast.error('No Solana wallet detected. Install Phantom or Solflare and reload.')
      return
    }
    try {
      select(first.adapter.name)
      await connect()
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Connect failed'
      toast.error(msg.includes('rejected') ? 'Connection cancelled' : msg)
    }
  }

  return (
    <div
      className={`rounded-xl border px-3 py-2.5 ${
        view.source === 'browser'
          ? 'border-violet-500/30 bg-violet-500/[0.07]'
          : 'border-white/10 bg-white/[0.03]'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">
            Showing
            {view.loading ? ' · reading…' : view.stale ? ' · last known' : ''}
          </p>
          <p className="truncate text-sm font-medium text-white">
            {view.label}
            {view.address ? (
              <span className="ml-2 font-mono text-xs text-zinc-400">
                {shortSolanaAddress(view.address)}
              </span>
            ) : null}
          </p>
          {!view.loading && !view.error ? (
            <p className="mt-0.5 font-mono text-[10px] text-zinc-500">
              ${view.totalUsd.toLocaleString(undefined, { maximumFractionDigits: 2 })} ·{' '}
              {view.usdc.toFixed(2)} USDC · {view.sol.toFixed(4)} SOL
            </p>
          ) : null}
        </div>

        <div className="flex rounded-lg border border-white/10 bg-black/40 p-0.5">
          <button
            type="button"
            onClick={() => solana.setPreference('platform')}
            className={`rounded-md px-2.5 py-1 text-[11px] transition ${
              view.source === 'platform' ? 'bg-white/15 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            Platform
          </button>
          <button
            type="button"
            disabled={connecting}
            onClick={() => {
              if (solana.browserConnected) solana.setPreference('browser')
              else void connectBrowser()
            }}
            className={`rounded-md px-2.5 py-1 text-[11px] transition disabled:opacity-50 ${
              view.source === 'browser' ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
            }`}
          >
            {solana.browserConnected
              ? (solana.browserLabel ?? 'Browser')
              : connecting
                ? 'Connecting…'
                : 'Connect wallet'}
          </button>
        </div>
      </div>

      {view.error ? (
        <div className="mt-1.5 rounded-lg border border-rose-500/30 bg-rose-500/[0.07] px-2 py-1.5">
          <p className="text-[11px] leading-snug text-rose-200">{view.error}</p>
          <button
            type="button"
            onClick={() => void view.refresh()}
            className="mt-1 rounded bg-white/10 px-2 py-0.5 text-[10px] text-zinc-200 hover:bg-white/20"
          >
            Retry
          </button>
        </div>
      ) : null}

      {view.awaitingAddress ? (
        <p className="mt-1 text-[11px] text-zinc-500">Waiting for your wallet to share its address…</p>
      ) : null}
    </div>
  )
}
