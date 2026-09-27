'use client'

/**
 * Solana balances for whichever wallet is currently active.
 *
 * When a browser wallet is connected the holdings come from the same
 * server-side enumeration and pricing used for the platform wallet, just for a
 * different owner address — so the two read identically and the browser is not
 * exposed to public-RPC rate limits.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useActiveWallet, type WalletSource } from '@/context/ActiveWalletContext'
import { dexJupiter } from '@/lib/api'
import { connectSocket } from '@/lib/socket'

export type SolanaTokenRow = {
  mint: string
  symbol: string
  icon: string | null
  amount: number
  decimals: number
  usdPrice: number
  usdValue: number
}

export type SolanaWalletView = {
  source: WalletSource
  label: string
  address: string | null
  sol: number
  usdc: number
  totalUsd: number
  tokens: SolanaTokenRow[]
  loading: boolean
  error: string | null
  /** True when the wallet is connected but its address hasn't arrived yet. */
  awaitingAddress: boolean
  /** True when the numbers on screen are from a previous successful read. */
  stale: boolean
  /** True when the bot holds a key for this wallet and can trade or auto-exit. */
  botCanTrade: boolean
  refresh: () => Promise<void>
}

type Snapshot = {
  sol: number
  usdc: number
  totalUsd: number
  tokens: SolanaTokenRow[]
  address: string | null
}

const EMPTY: Snapshot = { sol: 0, usdc: 0, totalUsd: 0, tokens: [], address: null }

export function useSolanaWalletView(): SolanaWalletView {
  const { solana } = useActiveWallet()
  const [state, setState] = useState<Snapshot>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [stale, setStale] = useState(false)

  const wantBrowser = solana.source === 'browser'
  const browserAddress = wantBrowser ? solana.browserAddress : null
  // A wallet can report connected a frame before its public key arrives. Fetching
  // the platform wallet in that window would show the wrong wallet's money under
  // the browser wallet's name, so we wait instead.
  const awaitingAddress = wantBrowser && !browserAddress

  /** Identifies which wallet the in-flight request is for, so late replies can be dropped. */
  const targetRef = useRef<string>('')
  const target = wantBrowser ? `browser:${browserAddress ?? ''}` : 'platform'
  targetRef.current = target

  /**
   * Whether this wallet has ever loaded successfully. Held in a ref rather than
   * state so `refresh` keeps a stable identity — depending on loaded state would
   * make the polling effect re-run on every successful read and loop.
   */
  const hasLoadedRef = useRef(false)

  const refresh = useCallback(async () => {
    if (awaitingAddress) return
    const requestedFor = target

    try {
      const next: Snapshot = browserAddress
        ? await (async () => {
            const res = await dexJupiter.holdingsAt(browserAddress)
            return {
              sol: res.sol,
              usdc: res.usdc,
              totalUsd: res.totalUsd,
              tokens: res.tokens,
              address: res.address,
            }
          })()
        : await (async () => {
            const [balances, tokens] = await Promise.all([
              dexJupiter.walletBalances(),
              dexJupiter.walletTokens().catch(() => ({ address: null, tokens: [] as SolanaTokenRow[] })),
            ])
            return {
              sol: balances.sol,
              usdc: balances.usdc,
              totalUsd: balances.totalUsd,
              tokens: tokens.tokens,
              address: balances.address,
            }
          })()

      // The user may have switched wallets while this was in flight.
      if (targetRef.current !== requestedFor) return
      hasLoadedRef.current = true
      setState(next)
      setError(null)
      setStale(false)
    } catch (err) {
      if (targetRef.current !== requestedFor) return
      const raw = err as { response?: { status?: number; data?: { error?: string } }; message?: string }
      const status = raw.response?.status
      setError(
        status === 404
          ? 'This server build does not support reading connected wallets yet — it needs redeploying.'
          : (raw.response?.data?.error ?? raw.message ?? 'Could not read wallet balances'),
      )
      // Keep the last good numbers rather than flashing zeros on a transient blip;
      // zeros read as "your money is gone", which is far worse than a stale value.
      setStale(hasLoadedRef.current)
    } finally {
      if (targetRef.current === requestedFor) setLoading(false)
    }
  }, [awaitingAddress, target, browserAddress])

  useEffect(() => {
    // Switching wallets must not leave the previous wallet's balances on screen.
    hasLoadedRef.current = false
    setState(EMPTY)
    setError(null)
    setStale(false)
    setLoading(true)
  }, [target])

  const refreshRef = useRef(refresh)
  refreshRef.current = refresh

  useEffect(() => {
    if (awaitingAddress) return
    void refreshRef.current()

    const socket = connectSocket()
    const onTrade = () => void refreshRef.current()
    socket.on('trade:executed', onTrade)

    return () => {
      socket.off('trade:executed', onTrade)
    }
  }, [target, awaitingAddress])

  return useMemo(
    () => ({
      source: solana.source,
      label: solana.source === 'browser' ? (solana.browserLabel ?? 'Browser wallet') : 'Personal wallet',
      address: wantBrowser ? (browserAddress ?? state.address) : state.address,
      sol: state.sol,
      usdc: state.usdc,
      totalUsd: state.totalUsd,
      tokens: state.tokens,
      loading: loading || awaitingAddress,
      error,
      awaitingAddress,
      stale,
      botCanTrade: solana.source === 'platform',
      refresh,
    }),
    [
      solana.source,
      solana.browserLabel,
      wantBrowser,
      browserAddress,
      state,
      loading,
      error,
      awaitingAddress,
      stale,
      refresh,
    ],
  )
}
