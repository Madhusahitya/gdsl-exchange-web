'use client'

import Link from 'next/link'
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useBalance, useChainId, usePublicClient } from 'wagmi'
import { bsc } from 'wagmi/chains'
import { formatEther, formatUnits } from 'viem'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { LiveNumber, LivePulse } from '@/components/ui/LiveNumber'
import { erc20Abi } from '@/lib/dex/bsc'
import { BSC_USDT, BSC_WBNB } from '@/lib/dex/bscTokens'
import {
  dashboard as dashApi,
  dexJupiter,
  engine,
  ensureAuthSession,
  personalWallet,
  trades,
  type DashboardSummary,
  type DexJupiterPosition,
} from '@/lib/api'
import { getApiOriginForErrors } from '@/lib/apiBaseUrl'
import { useSocket } from '@/hooks/useSocket'
import { connectSocket } from '@/lib/socket'
import { RefreshCw } from 'lucide-react'
import {
  buildChainDashboardView,
  type HoldingRow,
  type WalletView as ChainWalletView,
} from '@/components/dashboard/dashboardChainView'

type WalletView = ChainWalletView

const DASH_CACHE_KEY = 'gdsl_dashboard_cache_v1'
const SOL_CACHE_KEY = 'gdsl_sol_wallet_cache_v1'

function isRealOpenPosition(p: { strategyBook?: string | null; avgEntryPrice?: number | null }): boolean {
  if (p.strategyBook === 'Wallet (no book)') return false
  return p.avgEntryPrice != null && Number.isFinite(p.avgEntryPrice)
}

function isAutoBinanceBook(strategyBook?: string | null): boolean {
  const b = (strategyBook ?? '').toLowerCase()
  return b === 'binance' || b === 'auto binance'
}

/** User-facing book label — API/DB may still emit legacy names. */
function displayBookLabel(book: string): string {
  if (book === 'Auto Binance' || book === 'Binance') return 'Binance'
  if (book === 'DEX Jupiter SOL' || book.includes('DEX Jupiter')) return 'Solana'
  return book
}

function cexLotMatchesSymbol(
  dashboardSymbol: string,
  cex: { symbol: string; pair: string } | null | undefined,
): boolean {
  if (!cex) return false
  const base = dashboardSymbol.toUpperCase()
  return cex.symbol.toUpperCase().startsWith(base) || cex.pair.toUpperCase().startsWith(`${base}/`)
}

function isJupiterBook(strategyBook?: string | null): boolean {
  return (strategyBook ?? '').toLowerCase().includes('jupiter')
}

/** Binance-style symbol the Jupiter position routes are keyed by (e.g. GEODUSDT). */
function jupiterSymbolFor(dashboardSymbol: string, match?: DexJupiterPosition | null): string {
  if (match?.binanceSymbol) return match.binanceSymbol
  const s = dashboardSymbol.toUpperCase()
  return s.endsWith('USDT') ? s : `${s}USDT`
}

function strategyChain(strategy: string): 'bsc' | 'solana' {
  return strategy.toLowerCase().includes('jupiter') ? 'solana' : 'bsc'
}

function tradeMatchesView(strategy: string, view: WalletView): boolean {
  if (view === 'all') return true
  if (view === 'browser-bsc') return strategyChain(strategy) === 'bsc'
  if (view === 'sol-personal') return strategyChain(strategy) === 'solana'
  if (view === 'bsc-personal') return strategyChain(strategy) === 'bsc'
  return true
}

type ReadContractClient = Pick<import('viem').PublicClient, 'readContract'>

/** Builds GET params so /dashboard/summary can overlay MetaMask BSC balances (see API walletView=browser). */
async function fetchBrowserDashboardQueryParams(opts: {
  address: `0x${string}`
  publicClient: ReadContractClient
  bnbWei?: bigint
}): Promise<Record<string, string>> {
  const pxRes = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT')
  const pxJson = (await pxRes.json()) as { price?: string }
  const bnbPx = pxJson.price ? parseFloat(pxJson.price) : NaN
  if (!Number.isFinite(bnbPx) || bnbPx <= 0) throw new Error('bnb_px')

  const [usdtRaw, wbnbRaw] = await Promise.all([
    opts.publicClient.readContract({
      address: BSC_USDT,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [opts.address],
    }),
    opts.publicClient.readContract({
      address: BSC_WBNB,
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [opts.address],
    }),
  ])
  const stable = Number(formatUnits(usdtRaw as bigint, 18))
  const wbnb = Number(formatUnits(wbnbRaw as bigint, 18))
  const bnbN = opts.bnbWei !== undefined ? Number(formatEther(opts.bnbWei)) : 0
  const risk = (wbnb + bnbN) * bnbPx
  const total = stable + risk
  return {
    walletView: 'browser',
    bt: String(total),
    bs: String(stable),
    br: String(Math.max(0, risk)),
    btail: opts.address.slice(-4),
  }
}

type TradeLogRow = {
  id: string
  pair: string
  /**
   * Server-derived trade direction:
   *   BUY    — position still held (status === 'OPEN')
   *   CLOSED — full round-trip; entry + exit both present, pnl realized
   *   SELL   — standalone sell with no matching buy in this book (orphan)
   *   CANCELLED — ghost lot cleared by reconcile (not an executed sell)
   * Older API builds may not emit this; we default to `null` and the UI
   * falls back to inferring from status/exitPrice locally.
   */
  side?: 'BUY' | 'SELL' | 'CLOSED' | 'CANCELLED' | null
  entryPrice: number
  exitPrice: number | null
  pnl: number | null
  allocationUsd: number | null
  status: string
  strategy: string
  createdAt: string
}

export default function DashboardPage() {
  const [summary, setSummary] = useState<DashboardSummary | null>(null)
  const [tradeRows, setTradeRows] = useState<TradeLogRow[]>([])
  const [loadErr, setLoadErr] = useState('')
  const [refreshSlow, setRefreshSlow] = useState(false)
  const [sellingSymbol, setSellingSymbol] = useState<string | null>(null)
  const [sellErr, setSellErr] = useState('')
  const [positionMsg, setPositionMsg] = useState('')
  const [cexOpenPos, setCexOpenPos] = useState<
    Awaited<ReturnType<typeof engine.cexSuperMachine>>['openPosition']
  >(null)
  /** Solana (Jupiter) open lots — effective TP/SL + skimmable state per token. */
  const [jupPositions, setJupPositions] = useState<DexJupiterPosition[]>([])
  /** Row key (`sellKey`) whose Skim is running / whose TP-SL editor is open. */
  const [skimBusyKey, setSkimBusyKey] = useState<string | null>(null)
  const [exitEditKey, setExitEditKey] = useState<string | null>(null)
  const [exitEditTp, setExitEditTp] = useState('')
  const [exitEditSl, setExitEditSl] = useState('')
  const [exitEditTrail, setExitEditTrail] = useState(false)
  const [exitEditBusy, setExitEditBusy] = useState(false)
  const [liveMarks, setLiveMarks] = useState<Record<string, number>>({})
  const loadInFlightRef = useRef<Promise<void> | null>(null)
  const socketRefreshRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [walletView, setWalletView] = useState<WalletView>('all')
  const [solSnapshot, setSolSnapshot] = useState<{
    usdc: number
    sol: number
    totalUsd: number
    address: string | null
  } | null>(null)
  const [bscTotalUsd, setBscTotalUsd] = useState<number | null>(null)
  const [bscHoldings, setBscHoldings] = useState<HoldingRow[]>([])
  const [solTokens, setSolTokens] = useState<HoldingRow[]>([])
  const [solLoading, setSolLoading] = useState(false)
  const hasCachedPaintRef = useRef(false)

  const { address, isConnected } = useAccount()
  const chainId = useChainId()
  const publicClient = usePublicClient({ chainId: bsc.id })
  const { data: bnbNative } = useBalance({
    address,
    chainId: bsc.id,
    query: { enabled: Boolean(address && isConnected && chainId === bsc.id) },
  })
  // Keep BNB wei out of load() deps — wei ticks were re-triggering summary
  // fetches and making the All-chains balance flash.
  const bnbWeiRef = useRef(bnbNative?.value)
  bnbWeiRef.current = bnbNative?.value

  const summaryRef = useRef<DashboardSummary | null>(null)
  summaryRef.current = summary

  const load = useCallback(async () => {
    if (loadInFlightRef.current) return loadInFlightRef.current

    const run = async () => {
      const isBackgroundRefresh = Boolean(summaryRef.current)
      if (!isBackgroundRefresh) setRefreshSlow(true)
      const apiOrigin = getApiOriginForErrors()

      const summaryPromise = (async () => {
        let params: Record<string, string> | undefined
        if (
          typeof window !== 'undefined' &&
          localStorage.getItem('preferred_trading_wallet') === 'dex' &&
          address &&
          isConnected &&
          chainId === bsc.id &&
          publicClient
        ) {
          try {
            params = await Promise.race([
              fetchBrowserDashboardQueryParams({
                address: address as `0x${string}`,
                publicClient,
                bnbWei: bnbWeiRef.current,
              }),
              new Promise<never>((_, reject) => {
                setTimeout(() => reject(new Error('browser_wallet_params_timeout')), 2_000)
              }),
            ])
          } catch {
            params = undefined
          }
        }
        return dashApi.summary(params)
      })()
      const tradesPromise = trades.list({ status: 'ALL', page: 1, limit: 25 })

      // Solana wallet — single combined endpoint (was two parallel RPC-heavy calls).
      if (!isBackgroundRefresh) setSolLoading(true)
      void dexJupiter
        .walletSummary()
        .then((v) => {
          if (!v) return
          setSolSnapshot((prev) => {
            const usdc = Number(v.usdc) || 0
            const sol = Number(v.sol) || 0
            let totalUsd = Math.max(Number(v.totalUsd) || 0, usdc)
            if (prev && prev.address === v.address && totalUsd + 0.5 < prev.totalUsd && usdc <= prev.usdc + 0.01) {
              totalUsd = prev.totalUsd
            }
            if (
              prev &&
              Math.abs(prev.usdc - usdc) < 0.01 &&
              Math.abs(prev.sol - sol) < 0.0001 &&
              Math.abs(prev.totalUsd - totalUsd) < 0.05 &&
              prev.address === v.address
            ) {
              return prev
            }
            return { usdc, sol, totalUsd, address: v.address }
          })
          const next = (v.tokens ?? []).map((t) => ({
            symbol: t.symbol,
            amount: t.amount,
            usdValue: t.usdValue,
          }))
          setSolTokens((prev) => {
            if (!next.length) return prev
            if (prev.length > next.length + 1) return prev
            return next
          })
          if (typeof window !== 'undefined') {
            try {
              sessionStorage.setItem(
                SOL_CACHE_KEY,
                JSON.stringify({
                  at: Date.now(),
                  snapshot: {
                    usdc: v.usdc,
                    sol: v.sol,
                    totalUsd: v.totalUsd,
                    address: v.address,
                  },
                  tokens: next,
                }),
              )
            } catch {
              /* quota */
            }
          }
        })
        .catch(() => null)
        .finally(() => setSolLoading(false))
      void personalWallet
        .status()
        .then((v) => {
          if (!v?.wallet) return
          const next = Number(v.wallet.totalUsdValue) || 0
          setBscTotalUsd((prev) => {
            // Ignore tiny oscillations / transient under-reads that flash the UI.
            if (prev != null && Math.abs(prev - next) < 0.05) return prev
            if (prev != null && next + 1 < prev * 0.5 && prev > 1) return prev
            return next
          })
          setBscHoldings(
            v.wallet.balances.map((b) => ({
              symbol: b.asset,
              amount: b.amount,
              usdValue: b.usdValue,
              role: b.role,
            })),
          )
        })
        .catch(() => null)

      const [summaryResult, tradesResult] = await Promise.allSettled([summaryPromise, tradesPromise])

      let anyOk = false

      if (summaryResult.status === 'fulfilled') {
        setSummary(summaryResult.value)
        anyOk = true
        if (summaryResult.value.degraded) {
          setLoadErr(
            'Some live data is temporarily unavailable (wallet RPC or market feed). Showing last known figures — auto-refresh will retry.',
          )
        } else {
          setLoadErr('')
        }
      } else {
        const reason = summaryResult.reason as {
          response?: { status?: number }
          code?: string
        }
        const status = reason?.response?.status
        // Only hard 401 after interceptor failed means session is gone.
        // 403 is often CSRF/CORS — do not scare users with "session expired".
        const isAuth = status === 401
        const isTransient =
          status === 403 ||
          status === 429 ||
          status === 502 ||
          status === 503 ||
          status === 504 ||
          reason?.code === 'ECONNABORTED' ||
          reason?.code === 'ERR_NETWORK'
        setLoadErr(
          isAuth
            ? 'Session expired — please sign in again.'
            : isTransient
              ? 'Server is busy or restarting — retrying automatically. Your data will return shortly.'
              : `Could not refresh dashboard summary (${apiOrigin}). Trades below may still load.`,
        )
      }

      if (tradesResult.status === 'fulfilled') {
        const rows = Array.isArray(tradesResult.value?.trades) ? tradesResult.value.trades : []
        setTradeRows(rows)
        anyOk = true
        if (summaryResult.status !== 'fulfilled') {
          setLoadErr((prev) => prev || 'Trade log loaded but wallet summary failed — retrying.')
        }
        if (typeof window !== 'undefined' && summaryResult.status === 'fulfilled') {
          try {
            sessionStorage.setItem(
              DASH_CACHE_KEY,
              JSON.stringify({
                at: Date.now(),
                summary: summaryResult.value,
                tradeRows: rows,
              }),
            )
          } catch {
            /* quota / private mode */
          }
        }
      } else if (summaryResult.status !== 'fulfilled') {
        const reason = tradesResult.reason as { response?: { status?: number }; code?: string }
        const isAuth = reason?.response?.status === 401
        setLoadErr(
          isAuth
            ? 'Session expired — please sign in again.'
            : `Could not reach the API (${apiOrigin}). Check that the server is running and you are signed in.`,
        )
      }

      if (!anyOk) {
        /* Keep previous summary/trades on screen — do not wipe to dashes on a blip. */
      }

      setRefreshSlow(false)
    }

    loadInFlightRef.current = run().finally(() => {
      loadInFlightRef.current = null
    })
    return loadInFlightRef.current
  }, [address, isConnected, chainId, publicClient])

  useEffect(() => {
    if (typeof window === 'undefined' || hasCachedPaintRef.current) return
    hasCachedPaintRef.current = true
    try {
      const raw = sessionStorage.getItem(DASH_CACHE_KEY)
      if (!raw) return
      const parsed = JSON.parse(raw) as {
        at?: number
        summary?: DashboardSummary
        tradeRows?: TradeLogRow[]
      }
      if (!parsed.at || Date.now() - parsed.at > 5 * 60_000) return
      if (parsed.summary) setSummary(parsed.summary)
      if (parsed.tradeRows?.length) setTradeRows(parsed.tradeRows)
      const solRaw = sessionStorage.getItem(SOL_CACHE_KEY)
      if (solRaw) {
        const solParsed = JSON.parse(solRaw) as {
          at?: number
          snapshot?: { usdc: number; sol: number; totalUsd: number; address: string | null }
          tokens?: HoldingRow[]
        }
        if (solParsed.at && Date.now() - solParsed.at < 5 * 60_000 && solParsed.snapshot) {
          setSolSnapshot(solParsed.snapshot)
          if (solParsed.tokens?.length) setSolTokens(solParsed.tokens)
        }
      }
    } catch {
      /* ignore corrupt cache */
    }
  }, [])

  useEffect(() => {
    void (async () => {
      await ensureAuthSession()
      await load()
    })()
  }, [load])

  /** When a browser wallet is connected, show that wallet's balances only. */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const pref = localStorage.getItem('preferred_trading_wallet')
    if (isConnected && chainId === bsc.id && (pref === 'dex' || pref == null)) {
      localStorage.setItem('preferred_trading_wallet', 'dex')
      setWalletView('browser-bsc')
    } else if (!isConnected && pref === 'personal') {
      setWalletView('all')
    }
  }, [isConnected, chainId])

  const filteredTradeRows = useMemo(
    () => tradeRows.filter((t) => tradeMatchesView(t.strategy, walletView)),
    [tradeRows, walletView],
  )

  const filteredOpenPositions = useMemo(
    () =>
      (summary?.openPositions ?? []).filter((p) => {
        if (!isRealOpenPosition(p)) return false
        if (walletView === 'all') return true
        const book = p.strategyBook ?? ''
        if (walletView === 'sol-personal') return book.toLowerCase().includes('jupiter')
        if (walletView === 'bsc-personal' || walletView === 'browser-bsc') {
          return !book.toLowerCase().includes('jupiter') && !isAutoBinanceBook(book)
        }
        return true
      }),
    [summary?.openPositions, walletView],
  )

  const hasAutoBinanceOpen = useMemo(
    () => filteredOpenPositions.some((p) => isAutoBinanceBook(p.strategyBook)),
    [filteredOpenPositions],
  )

  const loadCexPosition = useCallback(async () => {
    try {
      const s = await engine.cexSuperMachine()
      setCexOpenPos(s.openPosition)
    } catch {
      /* non-fatal — dashboard still shows summary row */
    }
  }, [])

  useEffect(() => {
    if (!hasAutoBinanceOpen) {
      setCexOpenPos(null)
      return
    }
    void loadCexPosition()
  }, [hasAutoBinanceOpen, loadCexPosition])

  const hasJupiterOpen = useMemo(
    () => filteredOpenPositions.some((p) => isJupiterBook(p.strategyBook)),
    [filteredOpenPositions],
  )

  const loadJupPositions = useCallback(async () => {
    try {
      const res = await dexJupiter.positions()
      setJupPositions(res.positions ?? [])
    } catch {
      /* non-fatal — dashboard still shows summary row */
    }
  }, [])

  useEffect(() => {
    if (!hasJupiterOpen) {
      setJupPositions([])
      return
    }
    void loadJupPositions()
  }, [hasJupiterOpen, loadJupPositions])

  const jupPositionFor = useCallback(
    (symbol: string): DexJupiterPosition | null =>
      jupPositions.find((p) => p.baseSymbol.toUpperCase() === symbol.toUpperCase()) ?? null,
    [jupPositions],
  )

  const refreshPositionSources = useCallback(() => {
    window.dispatchEvent(new Event('dashboard:refresh'))
    void load()
    void loadCexPosition()
    void loadJupPositions()
  }, [load, loadCexPosition, loadJupPositions])

  /** Skim the profit slice of a Binance or Solana row — position keeps running. */
  const skimRow = useCallback(
    async (rowKey: string, symbol: string, strategyBook?: string | null) => {
      setSkimBusyKey(rowKey)
      setSellErr('')
      setPositionMsg('')
      try {
        if (isAutoBinanceBook(strategyBook)) {
          const res = await engine.skimCexPosition()
          setPositionMsg(`Skimmed ${res.pair} profit → USDT · +$${res.skimmedUsdTotal.toFixed(2)} banked total`)
        } else {
          const res = await dexJupiter.skimPosition(jupiterSymbolFor(symbol, jupPositionFor(symbol)))
          const banked = res.trade.pnl != null ? ` · +$${res.trade.pnl.toFixed(2)} banked total` : ''
          setPositionMsg(`Skimmed ${symbol} profit → USDC${banked}`)
        }
        refreshPositionSources()
      } catch (e) {
        const msg =
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          (e instanceof Error ? e.message : 'Skim failed')
        setSellErr(msg)
      } finally {
        setSkimBusyKey(null)
      }
    },
    [jupPositionFor, refreshPositionSources],
  )

  const openExitEditorFor = useCallback(
    (rowKey: string, symbol: string, strategyBook?: string | null) => {
      if (isAutoBinanceBook(strategyBook)) {
        setExitEditTp(String(cexOpenPos?.effectiveTakeProfitPct ?? ''))
        setExitEditSl(String(cexOpenPos?.effectiveStopLossPct ?? ''))
        setExitEditTrail(cexOpenPos?.effectiveTrailingStop ?? false)
      } else {
        const jp = jupPositionFor(symbol)
        setExitEditTp(jp?.takeProfitPct != null ? String(jp.takeProfitPct) : '')
        setExitEditSl(jp?.stopLossPct != null ? String(jp.stopLossPct) : '')
        setExitEditTrail(jp?.trailingStop ?? false)
      }
      setExitEditKey(rowKey)
    },
    [cexOpenPos, jupPositionFor],
  )

  const saveExitOverridesFor = useCallback(
    async (symbol: string, strategyBook: string | null | undefined, reset = false) => {
      setExitEditBusy(true)
      setSellErr('')
      setPositionMsg('')
      const overrides = reset
        ? { takeProfitPct: null, stopLossPct: null, trailingStop: null }
        : {
            takeProfitPct: Number.parseFloat(exitEditTp) || undefined,
            stopLossPct: Number.parseFloat(exitEditSl) || undefined,
            trailingStop: exitEditTrail,
          }
      try {
        if (isAutoBinanceBook(strategyBook)) {
          await engine.setCexPositionExitOverrides(overrides)
        } else {
          await dexJupiter.setPositionExitOverrides(jupiterSymbolFor(symbol, jupPositionFor(symbol)), overrides)
        }
        setPositionMsg(
          reset ? `${symbol} back to global TP/SL` : `${symbol} TP/SL updated — live from next tick`,
        )
        setExitEditKey(null)
        void loadCexPosition()
        void loadJupPositions()
      } catch (e) {
        const msg =
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          (e instanceof Error ? e.message : 'Could not update TP/SL')
        setSellErr(msg)
      } finally {
        setExitEditBusy(false)
      }
    },
    [exitEditTp, exitEditSl, exitEditTrail, jupPositionFor, loadCexPosition, loadJupPositions],
  )

  const chainView = useMemo(
    () =>
      buildChainDashboardView({
        walletView,
        summary,
        solSnapshot,
        bscTotalUsd,
        bscBalances: bscHoldings,
        solTokens,
        filteredTrades: filteredTradeRows,
        filteredOpenPositions,
      }),
    [
      walletView,
      summary,
      solSnapshot,
      bscTotalUsd,
      bscHoldings,
      solTokens,
      filteredTradeRows,
      filteredOpenPositions,
    ],
  )

  /** Event-driven refresh — fires on user actions (trades, wallet connect, transfer). */
  useEffect(() => {
    const onRefresh = () => {
      void load()
      void loadCexPosition()
      void loadJupPositions()
    }
    window.addEventListener('dashboard:refresh', onRefresh)
    return () => window.removeEventListener('dashboard:refresh', onRefresh)
  }, [load, loadCexPosition, loadJupPositions])

  /**
   * Real-time trade execution: reload summary and positions when a trade executes.
   */
  useSocket({
    onTradeExecuted: () => {
      if (socketRefreshRef.current) clearTimeout(socketRefreshRef.current)
      socketRefreshRef.current = setTimeout(() => {
        void load()
        void loadCexPosition()
        void loadJupPositions()
      }, 600)
    },
  })

  /**
   * Stream live market marks in real-time via Socket.IO jupiter:ticker.
   * Eliminates HTTP polling for mark prices, market value, and unrealized PnL.
   */
  useEffect(() => {
    const socket = connectSocket()
    const onTicker = (ticks: Array<{ symbol: string; lastPrice: number }>) => {
      if (!Array.isArray(ticks) || ticks.length === 0) return
      setLiveMarks((prev) => {
        let changed = false
        const next = { ...prev }
        for (const t of ticks) {
          if (t?.symbol && t.lastPrice != null && t.lastPrice > 0) {
            const sym = t.symbol.toUpperCase()
            if (next[sym] !== t.lastPrice) {
              next[sym] = t.lastPrice
              changed = true
            }
          }
        }
        return changed ? next : prev
      })
    }
    socket.on('jupiter:ticker', onTicker)
    return () => {
      socket.off('jupiter:ticker', onTicker)
    }
  }, [])

  /** Binance spot marks from open positions — same feed as DEX signals / auto-exit. */
  const handleSellOpen = useCallback(
    async (symbol: string, uiKey?: string, strategyBook?: string | null, pair?: string | null) => {
      setSellErr('')
      setSellingSymbol(uiKey ?? symbol)
      try {
        const book = strategyBook?.toLowerCase() ?? ''
        const isJupiter = book.includes('jupiter')
        const isAutoBinance = isAutoBinanceBook(strategyBook)
        if (isJupiter) {
          const binanceSymbol = symbol.toUpperCase().endsWith('USDT')
            ? symbol.toUpperCase()
            : `${symbol.toUpperCase()}USDT`
          let lastErr: unknown
          for (let attempt = 0; attempt < 4; attempt++) {
            try {
              const res = await dexJupiter.sellOpen({ binanceSymbol, fraction: 'all' })
              void res
              lastErr = null
              break
            } catch (e) {
              lastErr = e
              const msg =
                (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
                (e instanceof Error ? e.message : '')
              if (!/rate-limited|too many requests/i.test(msg) || attempt >= 3) throw e
              await new Promise((r) => setTimeout(r, 16_000))
            }
          }
          if (lastErr) throw lastErr
        } else if (isAutoBinance) {
          const tradeSymbol = pair?.replace('/', '').toUpperCase() ?? `${symbol.toUpperCase()}USDT`
          await engine.manualTrade({ symbol: tradeSymbol, side: 'SELL', fraction: 1 })
        } else {
          await personalWallet.sellOpen({ symbol })
        }
        window.dispatchEvent(new Event('dashboard:refresh'))
        void load()
      } catch (e) {
        const msg =
          (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          (e instanceof Error ? e.message : 'Sell failed')
        setSellErr(msg)
      } finally {
        setSellingSymbol(null)
      }
    },
    [load],
  )

  const botLiveMarkBySymbol = useMemo(() => {
    const m = new Map<string, number>()
    for (const p of summary?.openPositions ?? []) {
      const sym = p.symbol.toUpperCase()
      const mark = liveMarks[sym] ?? p.markPrice
      if (mark == null || !Number.isFinite(mark)) continue
      if (p.strategyBook?.includes('1inch')) {
        m.set(`${sym}:1inch`, mark)
      } else {
        m.set(sym, mark)
      }
    }
    for (const [sym, px] of Object.entries(liveMarks)) {
      if (px != null && Number.isFinite(px) && !m.has(sym)) {
        m.set(sym, px)
      }
    }
    return m
  }, [summary?.openPositions, liveMarks])

  const fmt = (n: number) =>
    n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  /** Execution rate (USDT per 1 base) — extra decimals when near-parity stables. */
  const fmtExecPx = (n: number) => {
    if (!Number.isFinite(n)) return '—'
    const maxFrac = n >= 100 ? 2 : n >= 1 ? 5 : 8
    return `$${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: maxFrac })}`
  }
  const fmtSigned = (n: number) =>
    `${n >= 0 ? '+' : '−'}$${Math.abs(n).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  /** Swap/trade PnL: extra fraction digits when |value| < $1 so dust isn't shown as ±$0.00. */
  const fmtSignedPnl = (n: number) => {
    if (!Number.isFinite(n)) return '—'
    const abs = Math.abs(n)
    const maxFrac = abs >= 1 ? 2 : abs >= 0.01 ? 5 : abs >= 0.0001 ? 7 : 9
    return `${n >= 0 ? '+' : '−'}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: maxFrac })}`
  }
  const fmtQty = (n: number) =>
    n.toLocaleString(undefined, { maximumFractionDigits: n < 1 ? 6 : 4 })
  const fmtPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(2)}%`
  const fmtTime = (d: string | Date) => new Date(d).toLocaleString()
  const fmtRelative = (iso: string | null) => {
    if (!iso) return 'No trades yet'
    const diffMs = Date.now() - new Date(iso).getTime()
    if (!Number.isFinite(diffMs) || diffMs < 0) return new Date(iso).toLocaleString()
    const min = Math.floor(diffMs / 60_000)
    if (min < 1) return 'just now'
    if (min < 60) return `${min}m ago`
    const hr = Math.floor(min / 60)
    if (hr < 24) return `${hr}h ago`
    const day = Math.floor(hr / 24)
    return `${day}d ago`
  }

  const todayPnlClass = useMemo(() => {
    const v = chainView?.stats.todayProfit ?? 0
    if (v > 0) return 'text-emerald-300'
    if (v < 0) return 'text-rose-300'
    return 'text-white'
  }, [chainView?.stats.todayProfit])

  const walletChangeBadgeClass =
    (chainView?.walletChangeUsd ?? 0) >= 0
      ? 'bg-emerald-500/20 text-emerald-300'
      : 'bg-rose-500/20 text-rose-300'

  const walletViewLabel =
    walletView === 'browser-bsc'
      ? 'Connected MetaMask / browser wallet (BSC)'
      : walletView === 'sol-personal'
        ? 'Solana personal wallet'
        : walletView === 'bsc-personal'
          ? 'BSC personal wallet'
          : 'All chains (BSC + Solana)'

  return (
    <div className="space-y-6">
      {loadErr ? (
        <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 text-sm text-amber-200">
          {loadErr}{' '}
          <button
            type="button"
            className="underline font-medium"
            onClick={() => void load()}
            disabled={refreshSlow}
          >
            {refreshSlow ? 'Refreshing…' : 'Retry now'}
          </button>
          {' · '}
          <Link href="/login" className="underline">
            Login
          </Link>
        </p>
      ) : null}
      {!summary && !loadErr ? (
        <p className="rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3 text-sm text-zinc-400">
          Loading dashboard…
        </p>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 rounded-xl border border-white/10 bg-[#0a0a0f] px-3 py-2">
        <span className="text-[11px] text-zinc-500">Overview for:</span>
        {(
          [
            ['all', 'All chains'],
            ['bsc-personal', 'BSC personal'],
            ['sol-personal', 'Solana personal'],
            ['browser-bsc', 'Browser wallet (BSC)'],
          ] as const
        ).map(([id, label]) => (
          <button
            key={id}
            type="button"
            onClick={() => setWalletView(id)}
            className={`rounded-md px-2.5 py-1 text-[11px] font-medium ${
              walletView === id ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:bg-white/5'
            }`}
          >
            {label}
          </button>
        ))}
        <div className="ml-auto flex items-center gap-3">
          <span className="text-[10px] text-zinc-600">{walletViewLabel}</span>
          <button
            type="button"
            onClick={() => refreshPositionSources()}
            disabled={refreshSlow}
            title="Refresh dashboard data"
            className="flex items-center gap-1.5 rounded-md border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] font-medium text-zinc-300 transition-colors hover:bg-white/10 hover:text-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${refreshSlow ? 'animate-spin text-violet-400' : ''}`} />
            <span>{refreshSlow ? 'Refreshing…' : 'Refresh'}</span>
          </button>
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {(walletView === 'all' || walletView === 'bsc-personal' || walletView === 'browser-bsc') && summary ? (
          <div className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-emerald-300/80">
              {walletView === 'browser-bsc' ? 'Browser wallet (BSC)' : 'BSC personal wallet'}
            </p>
            <p className="text-xl font-semibold text-white">
              <LiveNumber value={bscTotalUsd ?? summary?.walletBalance}>
                ${fmt(bscTotalUsd ?? summary?.walletBalance ?? 0)}
              </LiveNumber>
            </p>
          </div>
        ) : null}
        {(walletView === 'all' || walletView === 'sol-personal') && (solSnapshot || solLoading) ? (
          <div className="rounded-xl border border-violet-500/25 bg-violet-500/5 px-4 py-3">
            <p className="text-[10px] uppercase tracking-wide text-violet-300/80">Solana personal wallet</p>
            {solSnapshot ? (
              <>
            <p className="text-xl font-semibold text-white">
              <LiveNumber value={Math.max(solSnapshot.totalUsd, solSnapshot.usdc)}>
                ${fmt(Math.max(solSnapshot.totalUsd, solSnapshot.usdc))}
              </LiveNumber>
            </p>
              </>
            ) : (
              <p className="text-sm text-zinc-500">Loading…</p>
            )}
          </div>
        ) : null}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="border-white/10 bg-[#0a0a0f]">
          <CardHeader className="flex flex-row items-start justify-between pb-2">
            <div>
              <CardTitle className="text-base font-medium text-white">Profit overview</CardTitle>
            </div>
            {summary?.generatedAt ? (
              <span className="text-[10px] text-zinc-500">Updated {fmtRelative(summary.generatedAt)}</span>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
              <div>
                <p className="text-zinc-500">Today PnL</p>
                <p className={`font-medium ${todayPnlClass}`}>
                  {chainView ? fmtSignedPnl(chainView.stats.todayProfit) : '—'}
                </p>
              </div>
              <div>
                <p className="text-zinc-500">Win rate (today)</p>
                <p className="font-medium text-white">
                  {chainView && chainView.stats.tradesToday > 0
                    ? `${chainView.stats.winRateToday.toFixed(0)}%`
                    : '—'}
                </p>
              </div>
              <div>
                <p className="text-zinc-500">7-day PnL</p>
                <p
                  className={`font-medium ${
                    (chainView?.stats.weekProfit ?? 0) > 0
                      ? 'text-emerald-300'
                      : (chainView?.stats.weekProfit ?? 0) < 0
                        ? 'text-rose-300'
                        : 'text-white'
                  }`}
                >
                  {chainView ? fmtSignedPnl(chainView.stats.weekProfit) : '—'}
                </p>
              </div>
              <div>
                <p className="text-zinc-500">Total PnL</p>
                <p
                  className={`font-medium ${
                    (chainView?.stats.totalProfit ?? 0) > 0
                      ? 'text-emerald-300'
                      : (chainView?.stats.totalProfit ?? 0) < 0
                        ? 'text-rose-300'
                        : 'text-white'
                  }`}
                >
                  {chainView ? fmtSignedPnl(chainView.stats.totalProfit) : '—'}
                </p>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Best today</p>
                <p className="text-sm font-medium text-emerald-300">
                  {chainView ? fmtSignedPnl(chainView.stats.bestTradeToday) : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Worst today</p>
                <p className="text-sm font-medium text-rose-300">
                  {chainView ? fmtSignedPnl(chainView.stats.worstTradeToday) : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Last trade</p>
                <p className="text-sm font-medium text-white">
                  {fmtRelative(chainView?.stats.lastTradeAt ?? null)}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Open positions</p>
                <p className="text-sm font-medium text-white">{chainView?.openPositionsCount ?? 0}</p>
              </div>
            </div>

            {/*
              7-day performance dashboard — the honest investor view.

              Why 7-day instead of "today": with 2-4 trades a day the daily
              expectancy/payoff numbers are pure noise. The 7-day window
              gives a sample size where win-rate × avg-win actually means
              something. We still surface the "low sample" badge when the
              weekly count is too small so we never overstate confidence.
            */}
            <div className="space-y-2 rounded-xl border border-white/10 bg-white/[0.02] p-3">
              <div className="flex items-center justify-between">
                <p className="text-xs font-medium text-zinc-300">Performance · 7d</p>
                {chainView && chainView.stats.tradesThisWeek < 10 ? (
                  <span
                    className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium text-amber-200"
                    title="Fewer than 10 trades this week. Metrics shown but treat with caution — small samples are noisy."
                  >
                    Low sample · {chainView.stats.tradesThisWeek} trade
                    {chainView.stats.tradesThisWeek === 1 ? '' : 's'}
                  </span>
                ) : chainView ? (
                  <span className="rounded-md bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                    {chainView.stats.tradesThisWeek} trades
                  </span>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <div className="rounded-lg border border-white/5 bg-black/30 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Win rate</p>
                  <p className="text-sm font-medium text-white">
                    {chainView && chainView.stats.tradesThisWeek > 0
                      ? `${chainView.stats.winRateWeek.toFixed(0)}%`
                      : '—'}
                  </p>
                </div>

                <div className="rounded-lg border border-white/5 bg-black/30 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Avg win</p>
                  <p className="text-sm font-medium text-emerald-300">
                    {chainView && chainView.stats.avgWinWeekUsd > 0
                      ? fmtSignedPnl(chainView.stats.avgWinWeekUsd)
                      : '—'}
                  </p>
                </div>

                <div className="rounded-lg border border-white/5 bg-black/30 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Avg loss</p>
                  <p className="text-sm font-medium text-rose-300">
                    {chainView && chainView.stats.avgLossWeekUsd > 0
                      ? `−$${fmt(chainView.stats.avgLossWeekUsd)}`
                      : '—'}
                  </p>
                </div>

                <div className="rounded-lg border border-white/5 bg-black/30 px-3 py-2">
                  <p className="text-[10px] uppercase tracking-wide text-zinc-500">Expectancy / trade</p>
                  <p
                    className={`text-sm font-medium ${
                      chainView == null || chainView.stats.tradesThisWeek === 0
                        ? 'text-white'
                        : chainView.stats.expectancyWeekUsd > 0
                          ? 'text-emerald-300'
                          : chainView.stats.expectancyWeekUsd < 0
                            ? 'text-rose-300'
                            : 'text-white'
                    }`}
                  >
                    {chainView && chainView.stats.tradesThisWeek > 0
                      ? fmtSignedPnl(chainView.stats.expectancyWeekUsd)
                      : '—'}
                  </p>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-[#0a0a0f]">
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <div>
              <CardTitle className="text-base font-medium text-white">Balance overview</CardTitle>
            </div>
            <Button variant="ghost" size="sm" className="text-blue-400 hover:text-blue-300" asChild>
              <Link href="/profit">More insights</Link>
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-end justify-between">
              <div>
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Wallet balance</p>
                <p className="text-2xl font-semibold text-white">
                  <LiveNumber
                    value={
                      chainView?.walletBalance != null
                        ? Math.round(chainView.walletBalance * 100) / 100
                        : null
                    }
                  >
                    ${chainView ? fmt(chainView.walletBalance) : '—'}
                  </LiveNumber>
                </p>
              </div>
              <span className={`rounded-md px-2 py-0.5 text-xs ${walletChangeBadgeClass}`}>
                {fmtPct(chainView?.walletChangePercent ?? 0)}
              </span>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">
                  {walletView === 'sol-personal' ? 'USDC / stablecoins' : 'Stablecoin funds'}
                </span>
                <span className="font-mono text-white">${chainView ? fmt(chainView.cashEquity) : '—'}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Open positions value</span>
                <span className="font-mono text-white">
                  <LiveNumber value={chainView?.openPositionsMv}>
                    ${chainView ? fmt(chainView.openPositionsMv) : '—'}
                  </LiveNumber>
                </span>
              </div>
              {walletView !== 'sol-personal' && walletView !== 'browser-bsc' ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-zinc-400">Unrealized PnL</span>
                  <span
                    className={`font-mono ${
                      (chainView?.unrealizedPnl ?? 0) >= 0 ? 'text-emerald-300' : 'text-rose-300'
                    }`}
                  >
                    {chainView ? fmtSignedPnl(chainView.unrealizedPnl) : '—'}
                  </span>
                </div>
              ) : null}
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">Token exposure (live)</span>
                <span className="font-mono text-white">
                  ${chainView ? fmt(chainView.tokenExposure) : '—'}
                </span>
              </div>
            </div>

            <div className="space-y-2 border-t border-white/10 pt-3">
              <div className="flex items-center justify-between text-sm">
                <span className="text-zinc-400">
                  {chainView?.showDeposits ? 'Total deposits' : 'Portfolio total'}
                </span>
                <span className="flex items-center gap-2">
                  <span className="font-mono text-white">
                    ${chainView ? fmt(chainView.showDeposits ? chainView.totalDeposits : chainView.walletBalance) : '—'}
                  </span>
                  {chainView?.showDeposits && chainView.depositsToday > 0 ? (
                    <span className="rounded-md bg-emerald-500/20 px-2 py-0.5 text-xs text-emerald-300">
                      +${fmt(chainView.depositsToday)} today
                    </span>
                  ) : null}
                </span>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Referral reward</p>
                <p className="text-sm font-medium text-emerald-300">
                  ${summary ? fmt(summary.referralReward) : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Today rewards</p>
                <p className="text-sm font-medium text-emerald-300">
                  ${summary ? fmt(summary.todayRewards) : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Today referrals</p>
                <p className="text-sm font-medium text-blue-300">{summary?.todayReferrals ?? '—'}</p>
              </div>
              <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Active plans</p>
                <p className="text-sm font-medium text-blue-200">{summary?.activePlans ?? '—'}</p>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {summary &&
      ((summary.openTradesAllTime ?? 0) > 0 || filteredOpenPositions.length > 0) ? (
        <Card className="border-white/10 bg-[#0a0a0f]">
          <CardHeader className="pb-2">
            <div className="flex items-center gap-2">
              <CardTitle className="text-base font-medium text-white">Open positions</CardTitle>
              <LivePulse />
            </div>
            {sellErr ? (
              <p className="mt-2 rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
                {sellErr}
              </p>
            ) : null}
            {positionMsg ? (
              <p className="mt-2 rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 text-xs text-emerald-200">
                {positionMsg}
              </p>
            ) : null}
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[880px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-zinc-500">
                  <th className="px-4 py-3 font-normal">Symbol</th>
                  <th className="px-4 py-3 font-normal">Book</th>
                  <th className="px-4 py-3 font-normal">Quantity</th>
                  <th className="px-4 py-3 font-normal">Avg entry (fill)</th>
                  <th className="px-4 py-3 font-normal">Exit mark (live)</th>
                  <th className="px-4 py-3 font-normal">Cost basis</th>
                  <th className="px-4 py-3 font-normal">Market value</th>
                  <th className="px-4 py-3 font-normal">Unrealized PnL</th>
                  <th className="px-4 py-3 font-normal text-right">Skimmed</th>
                  <th className="px-4 py-3 font-normal text-right">Exit</th>
                </tr>
              </thead>
              <tbody>
                {filteredOpenPositions.length === 0 ? (
                  <tr>
                    <td colSpan={10} className="px-4 py-6 text-center text-zinc-500">
                      No open positions for this wallet view.
                    </td>
                  </tr>
                ) : null}
                {filteredOpenPositions.map((pos) => {
                  const posMark = liveMarks[pos.symbol.toUpperCase()] ?? pos.markPrice
                  const posMarketValueUsd = posMark != null && pos.quantity > 0 ? pos.quantity * posMark : pos.marketValueUsd
                  const posUnrealizedPnlUsd = posMarketValueUsd - pos.costBasisUsd
                  const posUnrealizedPnlPct = pos.costBasisUsd > 0 ? (posUnrealizedPnlUsd / pos.costBasisUsd) * 100 : pos.unrealizedPnlPct
                  const positive = posUnrealizedPnlUsd >= 0
                  const isAutoBinance = isAutoBinanceBook(pos.strategyBook)
                  const cexMatch = isAutoBinance && cexLotMatchesSymbol(pos.symbol, cexOpenPos)
                  const canSell =
                    isRealOpenPosition(pos) &&
                    (summary.equitySource === 'personal_wallet_live' ||
                      (pos.strategyBook?.includes('Binance') ?? false) ||
                      (pos.strategyBook?.includes('1inch') ?? false) ||
                      (pos.strategyBook?.includes('Jupiter') ?? false))
                  const sellKey = `${pos.symbol}-${pos.strategyBook ?? 'x'}`
                  const selling = sellingSymbol === sellKey
                  const isJupiter = isJupiterBook(pos.strategyBook)
                  const jup = isJupiter ? jupPositionFor(pos.symbol) : null
                  const hasExitControls = canSell && (isAutoBinance || isJupiter)
                  const skimBusy = skimBusyKey === sellKey
                  const editorOpen = exitEditKey === sellKey
                  const stableAsset = isJupiter ? 'USDC' : 'USDT'

                  // Skimmed so far — venue-specific live source wins over the summary snapshot.
                  const skimUsd =
                    (cexMatch ? cexOpenPos?.skimmedUsd : isJupiter ? jup?.bankedSkimUsd : undefined) ??
                    pos.skimmedUsd ??
                    0
                  const skimPctOfCost = pos.costBasisUsd > 0 ? (skimUsd / pos.costBasisUsd) * 100 : null

                  // What a Skim would bank right now, and why it might be blocked.
                  const livePnlUsd = cexMatch
                    ? (cexOpenPos?.pnlUsd ?? posUnrealizedPnlUsd)
                    : isJupiter
                      ? (jup?.estNetPnlUsd ?? posUnrealizedPnlUsd)
                      : posUnrealizedPnlUsd
                  const skimmableUsd = cexMatch
                    ? (cexOpenPos?.skimmableUsd ?? 0)
                    : isJupiter
                      ? Math.max(0, Math.min(livePnlUsd, posMarketValueUsd * 0.4))
                      : 0
                  const skimBlocked: string | null = cexMatch
                    ? (cexOpenPos?.skimBlockedReason ?? null)
                    : isJupiter
                      ? posUnrealizedPnlUsd <= 0
                        ? 'Not in profit yet'
                        : null
                      : livePnlUsd <= 0
                        ? 'Not in profit yet'
                        : null
                  const belowMinOrder = cexMatch ? (cexOpenPos?.belowMinOrder ?? false) : false
                  const effTp = cexMatch ? cexOpenPos?.effectiveTakeProfitPct : jup?.takeProfitPct
                  const effSl = cexMatch ? cexOpenPos?.effectiveStopLossPct : jup?.stopLossPct
                  const effTrail = cexMatch ? cexOpenPos?.effectiveTrailingStop : jup?.trailingStop
                  const hasOverride = cexMatch
                    ? cexOpenPos?.takeProfitPct != null ||
                      cexOpenPos?.stopLossPct != null ||
                      cexOpenPos?.trailingStop != null
                    : jup?.exitOverrides?.takeProfitPct != null ||
                      jup?.exitOverrides?.stopLossPct != null ||
                      jup?.exitOverrides?.trailingStop != null
                  return (
                    <Fragment key={sellKey}>
                      <tr className="border-b border-white/5 hover:bg-white/[0.03]">
                        <td className="px-4 py-3 font-medium text-white">{pos.symbol}</td>
                        <td className="px-4 py-3 text-[11px] text-zinc-400">
                          {pos.strategyBook ? displayBookLabel(pos.strategyBook) : '—'}
                        </td>
                        <td className="px-4 py-3 text-zinc-300">{fmtQty(pos.quantity)}</td>
                        <td className="px-4 py-3 text-zinc-300">
                          {pos.avgEntryPrice != null ? fmtExecPx(pos.avgEntryPrice) : '—'}
                        </td>
                        <td className="px-4 py-3 text-zinc-300">
                          {posMark != null ? (
                            <LiveNumber value={posMark}>{fmtExecPx(posMark)}</LiveNumber>
                          ) : (
                            '—'
                          )}
                        </td>
                        <td className="px-4 py-3 text-zinc-300">${fmt(pos.costBasisUsd)}</td>
                        <td className="px-4 py-3 text-white">
                          <LiveNumber value={posMarketValueUsd}>${fmt(posMarketValueUsd)}</LiveNumber>
                        </td>
                        <td className={`px-4 py-3 ${positive ? 'text-emerald-300' : 'text-rose-300'}`}>
                          <LiveNumber value={posUnrealizedPnlUsd}>{fmtSignedPnl(posUnrealizedPnlUsd)}</LiveNumber>
                          {posUnrealizedPnlPct != null ? (
                            <span className="ml-1 text-[10px] text-zinc-500">({fmtPct(posUnrealizedPnlPct)})</span>
                          ) : null}
                          {hasExitControls && effTp != null && effSl != null ? (
                            <div
                              className="mt-0.5 text-[9px] text-zinc-600"
                              title={hasOverride ? 'Custom for this position' : 'From global exit settings'}
                            >
                              TP {effTp}% · SL {effSl}%
                              {effTrail ? ' · trail' : ''}
                              {hasOverride ? ' ✎' : ''}
                            </div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right font-mono text-xs">
                          {skimUsd > 0 ? (
                            <div
                              className="text-emerald-400"
                              title={`Profit already sold to ${stableAsset} — it is in your wallet balance; the position keeps running`}
                            >
                              <LiveNumber value={skimUsd}>+${fmt(skimUsd)}</LiveNumber>
                              {skimPctOfCost != null ? (
                                <span className="ml-1 text-[10px] text-zinc-500">({fmtPct(skimPctOfCost)})</span>
                              ) : null}
                            </div>
                          ) : hasExitControls && skimmableUsd > 0 && !skimBlocked ? (
                            <div
                              className="text-amber-300"
                              title={`Skim would bank about this much ${stableAsset} right now — click Skim`}
                            >
                              <LiveNumber value={skimmableUsd}>≈ +${fmt(skimmableUsd)}</LiveNumber>
                              <span className="ml-1 text-[10px] text-amber-500/70">ready</span>
                            </div>
                          ) : (
                            <div
                              className="text-zinc-600"
                              title={
                                skimBlocked ??
                                `Nothing skimmed yet — Skim sells the profit slice to ${stableAsset} once in profit`
                              }
                            >
                              —
                              {hasExitControls && livePnlUsd > 0 && skimBlocked ? (
                                <div className="mt-0.5 max-w-[140px] whitespace-normal text-[9px] leading-tight text-amber-500/80">
                                  {skimBlocked}
                                </div>
                              ) : hasExitControls && livePnlUsd <= 0 ? (
                                <div className="mt-0.5 text-[9px] text-zinc-600">
                                  {Math.abs(pos.unrealizedPnlPct ?? 0).toFixed(2)}% to profit
                                </div>
                              ) : null}
                            </div>
                          )}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {hasExitControls ? (
                            <div className="flex justify-end gap-1">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={skimBusy || skimBlocked != null}
                                title={
                                  skimBlocked ??
                                  `Bank ≈ $${fmt(skimmableUsd)} of profit into ${stableAsset} now — position keeps running`
                                }
                                className="h-7 border-amber-500/30 px-2 text-[10px] text-amber-300 hover:bg-amber-500/10"
                                onClick={() => void skimRow(sellKey, pos.symbol, pos.strategyBook)}
                              >
                                {skimBusy ? '…' : 'Skim'}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                title="Edit take-profit / stop-loss for this position"
                                className="h-7 border-sky-500/30 px-2 text-[10px] text-sky-300 hover:bg-sky-500/10"
                                onClick={() =>
                                  editorOpen
                                    ? setExitEditKey(null)
                                    : openExitEditorFor(sellKey, pos.symbol, pos.strategyBook)
                                }
                              >
                                TP/SL
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                className="h-7 border-rose-500/40 px-2 text-[10px] text-rose-200 hover:bg-rose-500/10"
                                disabled={selling || refreshSlow}
                                title={
                                  belowMinOrder
                                    ? `Lot is worth under Binance's $${cexOpenPos?.minSellNotionalUsd ?? 5} minimum order — Binance will reject the sell until it grows`
                                    : 'Close the whole position now'
                                }
                                onClick={() => void handleSellOpen(pos.symbol, sellKey, pos.strategyBook, pos.pair)}
                              >
                                {selling ? '…' : 'Sell now'}
                              </Button>
                            </div>
                          ) : canSell ? (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              className="border-rose-500/40 text-rose-200 hover:bg-rose-500/10"
                              disabled={selling || refreshSlow}
                              onClick={() => void handleSellOpen(pos.symbol, sellKey, pos.strategyBook, pos.pair)}
                            >
                              {selling ? 'Selling…' : 'Sell now'}
                            </Button>
                          ) : isAutoBinance ? (
                            <Link
                              href="/trading"
                              className="text-xs text-sky-400 underline hover:text-sky-300"
                            >
                              Binance →
                            </Link>
                          ) : (
                            <Link href="/dex" className="text-xs text-blue-400 underline hover:text-blue-300">
                              DEX →
                            </Link>
                          )}
                        </td>
                      </tr>
                      {belowMinOrder ? (
                        <tr className="border-b border-white/5 bg-amber-500/[0.04]">
                          <td colSpan={10} className="px-4 py-1.5 text-[10px] text-amber-200/80">
                            {pos.symbol} lot is worth ${fmt(pos.marketValueUsd)} — under Binance&apos;s $
                            {cexOpenPos?.minSellNotionalUsd ?? 5} minimum order. Skim, take-profit, stop-loss and
                            Sell now cannot execute on Binance until the position is worth more than that.
                          </td>
                        </tr>
                      ) : null}
                      {hasExitControls && editorOpen ? (
                        <tr className="border-b border-white/5 bg-sky-500/[0.04]">
                          <td colSpan={10} className="px-4 py-2">
                            <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
                              <span className="font-medium text-sky-300">{pos.symbol} exit plan</span>
                              <label className="flex items-center gap-1">
                                TP %
                                <input
                                  type="number"
                                  min="0.1"
                                  max="50"
                                  step="0.1"
                                  value={exitEditTp}
                                  onChange={(e) => setExitEditTp(e.target.value)}
                                  className="h-6 w-16 rounded border border-white/10 bg-[#0a0a0f] px-1.5 font-mono text-[10px] text-zinc-200 outline-none focus:border-sky-500/50"
                                />
                              </label>
                              <label className="flex items-center gap-1">
                                SL %
                                <input
                                  type="number"
                                  min="0.1"
                                  max="50"
                                  step="0.1"
                                  value={exitEditSl}
                                  onChange={(e) => setExitEditSl(e.target.value)}
                                  className="h-6 w-16 rounded border border-white/10 bg-[#0a0a0f] px-1.5 font-mono text-[10px] text-zinc-200 outline-none focus:border-sky-500/50"
                                />
                              </label>
                              <label className="flex items-center gap-1">
                                <input
                                  type="checkbox"
                                  checked={exitEditTrail}
                                  onChange={(e) => setExitEditTrail(e.target.checked)}
                                  className="h-3 w-3 accent-sky-500"
                                />
                                Trailing
                              </label>
                              <Button
                                type="button"
                                size="sm"
                                disabled={exitEditBusy}
                                className="h-6 px-2 text-[9px]"
                                onClick={() => void saveExitOverridesFor(pos.symbol, pos.strategyBook)}
                              >
                                {exitEditBusy ? '…' : 'Save'}
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={exitEditBusy}
                                title="Clear per-position overrides — use global exit settings"
                                className="h-6 px-2 text-[9px]"
                                onClick={() => void saveExitOverridesFor(pos.symbol, pos.strategyBook, true)}
                              >
                                Reset
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="ghost"
                                className="h-6 px-2 text-[9px] text-zinc-500"
                                onClick={() => setExitEditKey(null)}
                              >
                                Cancel
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      ) : null}

      <Card className="border-white/10 bg-[#0a0a0f]">
        <CardHeader className="pb-2">
          <div className="flex items-center gap-2">
            <CardTitle className="text-base font-medium text-white">Trade log</CardTitle>
            <LivePulse />
          </div>
        </CardHeader>
        <CardContent className="overflow-x-auto px-2 py-0 sm:px-4">
            <table className="w-full min-w-[1020px] text-left text-sm">
              <thead>
                <tr className="border-b border-white/10 text-zinc-500">
                  <th className="sticky left-0 z-10 bg-[#0a0a0f] px-4 py-3 font-normal">Time</th>
                  <th className="px-4 py-3 font-normal">Pair</th>
                  <th className="px-4 py-3 font-normal">Side</th>
                  <th className="px-4 py-3 font-normal">Strategy</th>
                  <th className="px-4 py-3 font-normal">Volume (USDT)</th>
                  <th className="px-4 py-3 font-normal">Avg fill</th>
                  <th className="px-4 py-3 font-normal">Exit mark (live)</th>
                  <th className="px-4 py-3 font-normal">Exit</th>
                  <th className="px-4 py-3 font-normal">Status</th>
                  <th className="px-4 py-3 font-normal">Realized</th>
                </tr>
              </thead>
              <tbody>
              {filteredTradeRows.map((t) => {
                const pnl = t.pnl ?? 0
                const pnlCls =
                  Math.abs(pnl) < Number.EPSILON
                    ? 'text-zinc-300'
                    : pnl > 0
                      ? 'text-emerald-300'
                      : 'text-rose-300'
                // Fall back to deriving side locally for any rows from an
                // older API build that hasn't started emitting `side` yet.
                const derivedSide: 'BUY' | 'SELL' | 'CLOSED' | 'CANCELLED' =
                  t.side ??
                  (t.status === 'CANCELLED'
                    ? 'CANCELLED'
                    : t.status === 'OPEN'
                      ? 'BUY'
                      : t.exitPrice != null
                        ? 'CLOSED'
                        : 'SELL')
                const sideCls =
                  derivedSide === 'BUY'
                    ? 'text-emerald-300'
                    : derivedSide === 'SELL'
                      ? 'text-rose-300'
                      : derivedSide === 'CANCELLED'
                        ? 'text-amber-300/90'
                        : 'text-sky-300'
                const baseSym = t.pair.split('/')[0]?.toUpperCase() ?? ''
                const isOneInchBook = t.strategy.includes('1inch')
                const liveMark =
                  t.status === 'OPEN'
                    ? isOneInchBook
                      ? botLiveMarkBySymbol.get(`${baseSym}:1inch`) ?? botLiveMarkBySymbol.get(baseSym)
                      : botLiveMarkBySymbol.get(baseSym)
                    : undefined
                const movePct =
                  liveMark != null &&
                  Number.isFinite(t.entryPrice) &&
                  t.entryPrice > 0
                    ? ((liveMark - t.entryPrice) / t.entryPrice) * 100
                    : null
                return (
                  <tr key={t.id} className="border-b border-white/5 hover:bg-white/[0.03]">
                    <td className="sticky left-0 z-10 bg-[#0a0a0f] px-4 py-3 text-zinc-400">{fmtTime(t.createdAt)}</td>
                    <td className="px-4 py-3 text-white">{t.pair}</td>
                    <td className={`px-4 py-3 font-medium ${sideCls}`}>{derivedSide}</td>
                    <td className="px-4 py-3 text-zinc-300">{displayBookLabel(t.strategy)}</td>
                    <td className="px-4 py-3 text-zinc-300">
                      {t.allocationUsd != null ? `$${fmt(t.allocationUsd)}` : '—'}
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{fmtExecPx(t.entryPrice)}</td>
                    <td className="px-4 py-3 text-zinc-300">
                      {liveMark != null ? (
                        <LiveNumber value={liveMark}>
                          <span>
                            {fmtExecPx(liveMark)}
                            {movePct != null ? (
                              <span
                                className={`ml-1 text-[10px] ${movePct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                              >
                                ({movePct >= 0 ? '+' : ''}
                                {movePct.toFixed(2)}%)
                              </span>
                            ) : null}
                          </span>
                        </LiveNumber>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-4 py-3 text-zinc-300">{t.exitPrice != null ? fmtExecPx(t.exitPrice) : '—'}</td>
                    <td className="px-4 py-3 text-zinc-300">{t.status}</td>
                    <td className={`px-4 py-3 ${pnlCls}`}>{t.pnl != null ? fmtSignedPnl(t.pnl) : '—'}</td>
                  </tr>
                )
              })}
              {!filteredTradeRows.length ? (
                <tr>
                  <td colSpan={10} className="px-4 py-8 text-center text-zinc-500">
                    No trades yet.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-[#0a0a0f]">
        <CardHeader className="flex flex-row items-center justify-between pb-2">
          <CardTitle className="text-base font-medium text-white">Quick links</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" className="border-emerald-500/40 text-emerald-300" asChild>
            <Link href="/dex-1inch">DEX 1inch · BSC</Link>
          </Button>
          <Button variant="outline" size="sm" className="border-violet-500/40 text-violet-300" asChild>
            <Link href="/dex-jupiter">Solana</Link>
          </Button>
          <Button variant="outline" size="sm" asChild>
            <Link href="/wallet">Wallet · all chains</Link>
          </Button>
        </CardContent>
      </Card>
    </div>
  )
}
