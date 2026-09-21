'use client'

import { Fragment, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import dynamic from 'next/dynamic'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { useSolanaWalletView } from '@/hooks/useSolanaWalletView'
import { useBrowserJupiterSwap } from '@/hooks/useBrowserJupiterSwap'
import { JupiterAutopilotPanel } from '@/components/dex/JupiterAutopilotPanel'
import { JupiterSuperMachinePanel } from '@/components/dex/JupiterSuperMachinePanel'
import {
  JupiterProfitControls,
  type SlippagePreset,
} from '@/components/dex/JupiterProfitControls'
import { JupiterTradingChart, type ChartOverlayLine } from '@/components/dex/JupiterTradingChart'
import { JupiterOrderBookPanel } from '@/components/dex/JupiterOrderBookPanel'
import { JupiterTokenSearch } from '@/components/dex/JupiterTokenSearch'
import { JupiterTokenHeader } from '@/components/dex/JupiterTokenHeader'
import { JupiterTradeModeTabs, type JupiterTradeMode } from '@/components/dex/JupiterTradeModeTabs'
import { JupiterCouncilStrip } from '@/components/dex/JupiterCouncilStrip'
import { useJupiterMarks } from '@/hooks/useJupiterMarks'
import { useOverviewSocket } from '@/hooks/useOverviewSocket'
import { connectSocket } from '@/lib/socket'
import { usePageVisible } from '@/hooks/usePageVisible'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LiveNumber } from '@/components/ui/LiveNumber'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  dexJupiter,
  type DexJupiterQuotePreview,
  type DexJupiterPosition,
  type ExecutionCompareResult,
  type MarketBoardRow,
  type JupiterLimitOrder,
  type LiveCandle,
} from '@/lib/api'

const JupiterPredictionsPanel = dynamic(
  () =>
    import('@/components/dex/JupiterPredictionsPanel').then((m) => ({
      default: m.JupiterPredictionsPanel,
    })),
  { ssr: false, loading: () => <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Loading Predict…</div> },
)

const ExecutionEnginePanel = dynamic(
  () =>
    import('@/components/dex/ExecutionEnginePanel').then((m) => ({
      default: m.ExecutionEnginePanel,
    })),
  { ssr: false, loading: () => <div className="flex flex-1 items-center justify-center text-sm text-zinc-500">Loading Router…</div> },
)

const QUOTE_DEBOUNCE_MS = 350
const POSITIONS_POLL_MS = 20_000

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SOL_MINT = 'So11111111111111111111111111111111111111112'

/** The coin a BUY is paid with — USDC/SOL or any SPL token the wallet holds. */
type PayWith = { mint: string; symbol: string; decimals: number }
const USDC_PAY: PayWith = { mint: USDC_MINT, symbol: 'USDC', decimals: 6 }

function fmtUsd(n: number): string {
  const sign = n < 0 ? '-' : ''
  const abs = Math.abs(n)
  return `${sign}$${abs.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return '—'
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (p >= 1) return p.toFixed(4)
  return p.toPrecision(6)
}

function fmtPct(p: number): string {
  if (!Number.isFinite(p)) return '—'
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`
}

function pairLabel(sym: string): string {
  return `${sym.replace(/USDT$/i, '')}/USDT`
}

const CHART_SYMBOL_LS = 'jupiter_chart_symbol'

function DexJupiterContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const symbolParam = searchParams.get('symbol')?.toUpperCase() ?? null

  const { rows, totalPairs } = useOverviewSocket()
  const [tradeMode, setTradeMode] = useState<JupiterTradeMode>('market')
  const [limitPrice, setLimitPrice] = useState('')
  const [recurringUsd, setRecurringUsd] = useState('25')
  const [recurringEvery, setRecurringEvery] = useState<'daily' | 'weekly'>('daily')
  const [selected, setSelected] = useState<string | null>(() => {
    if (typeof window === 'undefined') return symbolParam
    const saved = localStorage.getItem(CHART_SYMBOL_LS)?.toUpperCase()
    return symbolParam ?? saved ?? null
  })
  const [meta, setMeta] = useState<Awaited<ReturnType<typeof dexJupiter.meta>> | null>(null)
  const [tradable, setTradable] = useState<boolean | null>(null)
  const [resolveMsg, setResolveMsg] = useState<string | null>(null)
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [amount, setAmount] = useState('50')
  const [payWith, setPayWith] = useState<PayWith>(USDC_PAY)
  const [payTokens, setPayTokens] = useState<
    Awaited<ReturnType<typeof dexJupiter.walletTokens>>['tokens']
  >([])
  const [payPickerOpen, setPayPickerOpen] = useState(false)
  const walletView = useSolanaWalletView()
  const browserSwap = useBrowserJupiterSwap()
  /** Auto = Super Machine + council; Manual = market/limit/recurring ticket. */
  const [terminalMode, setTerminalMode] = useState<'auto' | 'manual'>('auto')
  const [slippagePct, setSlippagePct] = useState('1')
  const [slippagePreset, setSlippagePreset] = useState<SlippagePreset>('mid')
  const [pageMode, setPageMode] = useState<'trade' | 'router' | 'predict'>(() => {
    const tab = searchParams.get('tab')
    if (tab === 'router' || tab === 'predict' || tab === 'trade') return tab
    return 'trade'
  })
  const [quote, setQuote] = useState<DexJupiterQuotePreview | null>(null)
  const [quoteBusy, setQuoteBusy] = useState(false)
  const [tradeBusy, setTradeBusy] = useState(false)
  const [sellBusyMint, setSellBusyMint] = useState<string | null>(null)
  const [skimBusyMint, setSkimBusyMint] = useState<string | null>(null)
  /** Mint of the position whose TP/SL editor is open (null = none). */
  const [exitEditMint, setExitEditMint] = useState<string | null>(null)
  const [exitEditTp, setExitEditTp] = useState('')
  const [exitEditSl, setExitEditSl] = useState('')
  const [exitEditTrail, setExitEditTrail] = useState(false)
  const [exitEditBusy, setExitEditBusy] = useState(false)
  const [solAddress, setSolAddress] = useState<string | null>(null)
  const [tokenBalance, setTokenBalance] = useState<number | null>(null)
  const [positions, setPositions] = useState<DexJupiterPosition[]>([])
  const [positionsTotalPnl, setPositionsTotalPnl] = useState<number | null>(null)
  const [positionsBankedSkim, setPositionsBankedSkim] = useState<number>(0)
  const [positionsLoading, setPositionsLoading] = useState(false)
  const [limitOrders, setLimitOrders] = useState<JupiterLimitOrder[]>([])
  const [routeCompare, setRouteCompare] = useState<ExecutionCompareResult | null>(null)
  const prevSideRef = useRef<'BUY' | 'SELL'>(side)
  const quoteSeq = useRef(0)

  const sellQtyForFiftyUsd = useCallback((price: number, decimals = 8) => {
    if (!Number.isFinite(price) || price <= 0) return '0.001'
    const raw = 50 / price
    const factor = 10 ** Math.min(decimals, 8)
    return String(Math.floor(raw * factor) / factor)
  }, [])

  const fetchJupiterCandles = useCallback(
    async (symbol: string, interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d', limit: number) => {
      // 1. Direct public CDN fetch for Binance-paired tokens (<80ms)
      try {
        const binanceSym = symbol.toUpperCase()
        const r = await fetch(
          `https://data-api.binance.vision/api/v3/klines?symbol=${encodeURIComponent(binanceSym)}&interval=${interval}&limit=${limit}`,
          { signal: AbortSignal.timeout(3500) },
        )
        if (r.ok) {
          const raw = (await r.json()) as Array<Array<string | number>>
          if (Array.isArray(raw) && raw.length > 0) {
            const candles: LiveCandle[] = raw.map((row) => ({
              openTime: Number(row[0]),
              open: parseFloat(String(row[1])),
              high: parseFloat(String(row[2])),
              low: parseFloat(String(row[3])),
              close: parseFloat(String(row[4])),
              volume: parseFloat(String(row[5])),
              closeTime: Number(row[6]),
            }))
            return {
              candles,
              footerExtra: 'Solana live',
            }
          }
        }
      } catch {
        /* fallback to backend API */
      }

      // 2. Backend fallback
      const result = await dexJupiter.candles(symbol, interval, limit)
      const block =
        result.jupiterBlockId != null ? `Solana block ${result.jupiterBlockId}` : 'Solana live'
      return {
        candles: result.candles,
        footerExtra: block,
        stale: result.stale,
        degraded: result.degraded,
        note: result.note,
      }
    },
    [],
  )

  const fetchJupiterLivePrice = useCallback(async (symbol: string) => {
    const res = await dexJupiter.livePrice(symbol)
    return res.price
  }, [])

  const pageVisible = usePageVisible()

  useEffect(() => {
    void dexJupiter.meta().then(setMeta).catch(() => setMeta(null))
    void dexJupiter.walletStatus().then(async (s) => {
      if (s.wallet?.address) {
        setSolAddress(s.wallet.address)
        return
      }
      if (s.configured) {
        try {
          const w = await dexJupiter.ensureWallet()
          setSolAddress(w.address)
        } catch {
          setSolAddress(null)
        }
      }
    })
  }, [])

  const tradableCount = totalPairs || meta?.tradableCount || rows.length

  const filtered = useMemo(() => rows, [rows])

  useEffect(() => {
    if (symbolParam) setSelected(symbolParam)
  }, [symbolParam])

  useEffect(() => {
    if (filtered.length === 0) return
    if (selected && filtered.some((r) => r.symbol === selected)) return
    const saved =
      typeof window !== 'undefined' ? localStorage.getItem(CHART_SYMBOL_LS)?.toUpperCase() : null
    if (saved && filtered.some((r) => r.symbol === saved)) {
      setSelected(saved)
      return
    }
    if (!selected) {
      const sol = filtered.find((r) => r.symbol === 'SOLUSDT')
      setSelected(sol?.symbol ?? filtered[0]!.symbol)
    }
  }, [filtered, selected])

  useEffect(() => {
    if (!selected) return
    if (typeof window !== 'undefined') {
      localStorage.setItem(CHART_SYMBOL_LS, selected)
    }
    router.replace(`/dex-jupiter?symbol=${encodeURIComponent(selected)}`, { scroll: false })
  }, [selected, router])

  useEffect(() => {
    if (!selected) return
    void dexJupiter
      .resolve(selected)
      .then((r) => {
        setTradable(r.tradable)
        setResolveMsg(r.message ?? (r.tradable ? null : 'Not tradable on Solana via Jupiter.'))
      })
      .catch((e: unknown) => {
        setTradable(false)
        const ax = e as { response?: { data?: { error?: string; message?: string } } }
        setResolveMsg(ax.response?.data?.error ?? ax.response?.data?.message ?? 'Could not check Solana route.')
      })
  }, [selected])

  const selectedRow = useMemo(
    () => rows.find((r) => r.symbol === selected) ?? null,
    [rows, selected],
  )

  useEffect(() => {
    if (!selected) return
    void dexJupiter.tokenBalance(selected).then((b) => setTokenBalance(b.balance)).catch(() => setTokenBalance(null))
  }, [selected])

  // The pay-with picker must list the wallet the page is actually reporting on,
  // otherwise a user on their Phantom balance is offered platform-wallet coins.
  const loadPayTokens = useCallback(async () => {
    if (walletView.source === 'browser') {
      await walletView.refresh()
      return
    }
    try {
      const res = await dexJupiter.walletTokens()
      setPayTokens((prev) => {
        const next = res.tokens ?? []
        if (!next.length) return prev
        if (prev.length > next.length + 1) return prev
        return next
      })
    } catch {
      /* keep previous — RPC blips must not clear pay-with list */
    }
  }, [walletView.source])

  useEffect(() => {
    void loadPayTokens()
  }, [loadPayTokens])

  useEffect(() => {
    if (walletView.source !== 'browser') return
    setPayTokens(walletView.tokens)
  }, [walletView.source, walletView.tokens])

  useEffect(() => {
    const sideChanged = prevSideRef.current !== side
    prevSideRef.current = side
    const price = selectedRow?.lastPrice ?? 0
    if (side === 'BUY') {
      if (sideChanged) setAmount(payWith.mint === USDC_MINT ? '50' : '')
      return
    }
    if (sideChanged) {
      setAmount(sellQtyForFiftyUsd(price, 8))
    }
  }, [side, payWith.mint, selectedRow?.lastPrice, sellQtyForFiftyUsd])

  useEffect(() => {
    if (side !== 'SELL' || !selectedRow?.lastPrice) return
    setAmount(sellQtyForFiftyUsd(selectedRow.lastPrice, 8))
  }, [selected, side, selectedRow?.lastPrice, sellQtyForFiftyUsd])

  const chartOverlays = useMemo((): ChartOverlayLine[] => {
    if (!selected) return []
    const base = selected.replace(/USDT$/i, '')
    const pos = positions.find((p) => p.binanceSymbol === selected || p.baseSymbol === base)
    if (!pos) return []
    const lines: ChartOverlayLine[] = [
      { label: 'Entry', price: pos.avgEntry, color: '#a78bfa' },
    ]
    if (pos.breakEvenSellPrice != null && pos.breakEvenSellPrice > 0) {
      lines.push({ label: 'Break-even', price: pos.breakEvenSellPrice, color: '#fbbf24' })
    }
    if (pos.liveMidPrice != null && pos.liveMidPrice > 0) {
      lines.push({ label: 'Live price', price: pos.liveMidPrice, color: '#34d399' })
    } else if (pos.liveSellPrice != null && pos.liveSellPrice > 0) {
      lines.push({ label: 'Live price', price: pos.liveSellPrice, color: '#34d399' })
    }
    return lines
  }, [positions, selected])

  const slippageBps = useMemo(() => {
    const n = Number.parseFloat(slippagePct)
    if (!Number.isFinite(n)) return 100
    return Math.max(10, Math.min(2000, Math.round(n * 100)))
  }, [slippagePct])

  useEffect(() => {
    if (!selected || tradable === false) {
      setQuote(null)
      return
    }
    const amt = Number.parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setQuote(null)
      return
    }
    const seq = ++quoteSeq.current
    const t = window.setTimeout(() => {
      void (async () => {
        setQuoteBusy(true)
        const fetchQuote = async () =>
          dexJupiter.quote({
            binanceSymbol: selected,
            side,
            amount: amt,
            slippageBps,
            spendMint: side === 'BUY' ? payWith.mint : undefined,
          })

        try {
          let q = await fetchQuote()
          if (seq !== quoteSeq.current) return
          // Server may return a zero-out placeholder while Jupiter is busy — retry once.
          if (q.amountOutHuman <= 0 && /busy|rate limit|429|api gateway/i.test(q.message ?? '')) {
            setResolveMsg('Jupiter busy — retrying quote…')
            await new Promise((r) => window.setTimeout(r, 2_500))
            if (seq !== quoteSeq.current) return
            q = await fetchQuote()
          }
          if (seq !== quoteSeq.current) return
          setQuote(q)
          if (q.amountOutHuman > 0 && q.tradable !== false) setResolveMsg(null)
          else if (q.message && /busy|rate limit|429|api gateway/i.test(q.message)) {
            setResolveMsg('Jupiter busy — quote will refresh automatically')
          }
        } catch (e: unknown) {
          if (seq !== quoteSeq.current) return
          const ax = e as { response?: { data?: { error?: string }; status?: number } }
          const raw = ax.response?.data?.error ?? ''
          const isRateLimit =
            /too many requests|429|rate limit|api gateway|jupiter is busy/i.test(raw) ||
            ax.response?.status === 429
          if (isRateLimit) {
            setResolveMsg('Jupiter busy — retrying in a moment…')
            await new Promise((r) => window.setTimeout(r, 3_000))
            if (seq !== quoteSeq.current) return
            try {
              const q = await fetchQuote()
              if (seq !== quoteSeq.current) return
              setQuote(q)
              if (q.amountOutHuman > 0) setResolveMsg(null)
            } catch {
              /* keep last quote on screen */
            }
          } else {
            setQuote(null)
            setResolveMsg(raw || 'Quote failed')
          }
        } finally {
          if (seq === quoteSeq.current) setQuoteBusy(false)
        }
      })()
    }, QUOTE_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [selected, side, amount, slippageBps, tradable, payWith.mint])

  const loadPositions = useCallback(async () => {
    try {
      setPositionsLoading(true)
      const res = await dexJupiter.positions()
      setPositions(res.positions)
      setPositionsTotalPnl(res.totalNetPnlUsd)
      setPositionsBankedSkim(res.totalBankedSkimUsd ?? 0)
    } catch {
      // Transient (rate-limit/route); keep last known positions.
    } finally {
      setPositionsLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!pageVisible || pageMode !== 'trade') return
    void loadPositions()
  }, [loadPositions, pageVisible, pageMode])

  const loadLimitOrders = useCallback(async () => {
    try {
      const res = await dexJupiter.limitOrders()
      setLimitOrders(res.orders)
    } catch {
      /* keep last */
    }
  }, [])

  useEffect(() => {
    if (!pageVisible || pageMode !== 'trade') return
    void loadLimitOrders()
  }, [loadLimitOrders, pageVisible, pageMode])

  // Real-time position and limit order updates driven by server events
  useEffect(() => {
    const socket = connectSocket()
    const onTrade = () => {
      void loadPositions()
      void loadLimitOrders()
    }
    const onRefresh = () => {
      void loadPositions()
    }

    socket.on('trade:executed', onTrade)
    socket.on('positions:refresh', onRefresh)
    return () => {
      socket.off('trade:executed', onTrade)
      socket.off('positions:refresh', onRefresh)
    }
  }, [loadPositions, loadLimitOrders])

  const sellPosition = useCallback(
    async (p: DexJupiterPosition, fraction: 'all' | 'half') => {
      setSellBusyMint(p.mint)
      try {
        const res = await dexJupiter.sellOpen({ binanceSymbol: p.binanceSymbol, fraction })
        if (res && typeof res === 'object' && 'clearedStale' in res && (res as { clearedStale?: boolean }).clearedStale) {
          const msg =
            typeof (res as { message?: string }).message === 'string'
              ? (res as { message: string }).message
              : `Cleared stale ${p.baseSymbol} position (no wallet balance).`
          toast.message(msg)
        } else {
          const signed = res as { txSignature: string }
          toast.success(
            `Sold ${fraction === 'half' ? '50%' : 'all'} ${p.baseSymbol} · ${signed.txSignature.slice(0, 12)}…`,
          )
        }
        void loadPositions()
        void loadPayTokens()
        window.dispatchEvent(new Event('dashboard:refresh'))
      } catch (e: unknown) {
        const ax = e as { response?: { data?: { error?: string } } }
        toast.error(ax.response?.data?.error ?? 'Sell failed')
      } finally {
        setSellBusyMint(null)
      }
    },
    [loadPositions, loadPayTokens],
  )

  /** Bank the profit slice into USDC — the position itself keeps running. */
  const skimPosition = useCallback(
    async (p: DexJupiterPosition) => {
      setSkimBusyMint(p.mint)
      try {
        const res = await dexJupiter.skimPosition(p.binanceSymbol)
        const banked = res.trade.pnl != null ? ` +$${res.trade.pnl.toFixed(2)}` : ''
        toast.success(`Skimmed ${p.baseSymbol} profit${banked} → USDC · ${res.txSignature.slice(0, 12)}…`)
        void loadPositions()
        void loadPayTokens()
        window.dispatchEvent(new Event('dashboard:refresh'))
      } catch (e: unknown) {
        const ax = e as { response?: { data?: { error?: string } } }
        toast.error(ax.response?.data?.error ?? 'Skim failed')
      } finally {
        setSkimBusyMint(null)
      }
    },
    [loadPositions, loadPayTokens],
  )

  const openExitEditor = useCallback((p: DexJupiterPosition) => {
    setExitEditMint(p.mint)
    setExitEditTp(String(p.takeProfitPct ?? ''))
    setExitEditSl(String(p.stopLossPct ?? ''))
    setExitEditTrail(p.trailingStop ?? false)
  }, [])

  /** Save per-position TP/SL — the exit watcher follows these from the next tick. */
  const saveExitOverrides = useCallback(
    async (p: DexJupiterPosition, reset = false) => {
      setExitEditBusy(true)
      try {
        const tp = Number.parseFloat(exitEditTp)
        const sl = Number.parseFloat(exitEditSl)
        await dexJupiter.setPositionExitOverrides(
          p.binanceSymbol,
          reset
            ? { takeProfitPct: null, stopLossPct: null, trailingStop: null }
            : {
                takeProfitPct: Number.isFinite(tp) ? tp : null,
                stopLossPct: Number.isFinite(sl) ? sl : null,
                trailingStop: exitEditTrail,
              },
        )
        toast.success(reset ? `${p.baseSymbol} back to global TP/SL` : `${p.baseSymbol} TP/SL updated — live from next tick`)
        setExitEditMint(null)
        void loadPositions()
      } catch (e: unknown) {
        const ax = e as { response?: { data?: { error?: string } } }
        toast.error(ax.response?.data?.error ?? 'Could not update TP/SL')
      } finally {
        setExitEditBusy(false)
      }
    },
    [exitEditTp, exitEditSl, exitEditTrail, loadPositions],
  )

  const blockTrade = quote?.blockTrade ?? false
  const quoteReady = Boolean(quote && quote.amountOutHuman > 0 && quote.tradable !== false)

  /** Poll lightweight route compare so the ticket shows which path will win. */
  useEffect(() => {
    if (!selected || pageMode !== 'trade') return
    const amt = Number.parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setRouteCompare(null)
      return
    }
    let cancelled = false
    const run = async () => {
      try {
        const res = await dexJupiter.executionCompare({
          side,
          binanceSymbol: selected,
          amount: amt,
          spendMint: side === 'BUY' ? payWith.mint : undefined,
          includeSecondary: false,
        })
        if (!cancelled) setRouteCompare(res)
      } catch {
        /* keep last compare — quote ticket still works from Jupiter quote */
      }
    }
    const t = window.setTimeout(() => void run(), 400)
    return () => {
      cancelled = true
      window.clearTimeout(t)
    }
  }, [selected, side, amount, payWith.mint, pageMode])

  const execute = async (
    override?: { side?: 'BUY' | 'SELL'; amount?: string; spendMint?: string },
    opts?: { skipQuoteGate?: boolean },
  ) => {
    const tradeSide = override?.side ?? side
    const amtStr = override?.amount ?? amount
    const spend = override?.spendMint ?? (tradeSide === 'BUY' ? payWith.mint : undefined)
    if (!selected) return
    const amt = Number.parseFloat(amtStr)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (tradable === false) {
      toast.error(resolveMsg ?? 'Pair not tradable on Solana')
      return
    }

    // A connected wallet signs its own swaps; the platform key is never involved,
    // and the resulting position is not auto-managed.
    if (walletView.source === 'browser') {
      setTradeBusy(true)
      try {
        const res = await browserSwap.swap({
          side: tradeSide,
          binanceSymbol: selected,
          amount: amt,
          slippageBps,
          spendMint: spend,
        })
        toast.success(`${tradeSide} from ${walletView.label} · ${res.txSignature.slice(0, 12)}…`)
        if (res.trade.status === 'OPEN') {
          toast.info('Self-custody position — take-profit and stop-loss are alerts, not automatic sells.')
        }
        setQuote(null)
        await walletView.refresh()
        void loadPositions()
      } catch (e: unknown) {
        const ax = e as { response?: { data?: { error?: string } }; message?: string }
        const msg = ax.response?.data?.error ?? ax.message ?? 'Swap failed'
        toast.error(
          /reject|denied|cancel/i.test(msg)
            ? 'Transaction cancelled in your wallet'
            : /busy|rate limit|429|api gateway/i.test(msg)
              ? 'Jupiter is busy — wait a moment and try again'
              : msg,
        )
      } finally {
        setTradeBusy(false)
      }
      return
    }

    if (!opts?.skipQuoteGate) {
      if (!quoteReady || blockTrade) {
        const msg = quote?.blockReason ?? quote?.message ?? resolveMsg ?? 'No executable route'
        toast.error(
          /busy|rate limit|429|api gateway/i.test(msg)
            ? 'Jupiter is busy — wait a moment and try again'
            : msg,
        )
        return
      }
    }
    setTradeBusy(true)
    try {
      const res = await dexJupiter.swap({
        side: tradeSide,
        binanceSymbol: selected,
        amount: amt,
        slippageBps,
        spendMint: spend,
      })
      toast.success(`${tradeSide} via Jupiter · ${res.txSignature.slice(0, 12)}…`)
      setQuote(null)
      void loadPositions()
      void loadPayTokens()
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      const swapErr = ax.response?.data?.error ?? 'Swap failed'
      toast.error(
        /busy|rate limit|429|api gateway/i.test(swapErr)
          ? 'Jupiter is busy — wait a moment and try again'
          : swapErr,
      )
    } finally {
      setTradeBusy(false)
    }
  }

  const baseSym = pairLabel(selected ?? '').split('/')[0] ?? 'TOKEN'
  const openOnSelected = useMemo(
    () => positions.find((p) => p.binanceSymbol === selected) ?? null,
    [positions, selected],
  )
  const jupiterMarks = useJupiterMarks(selected, 10_000)

  const loadLimitOrdersRef = useRef(loadLimitOrders)
  loadLimitOrdersRef.current = loadLimitOrders

  useEffect(() => {
    const onFilled = () => void loadLimitOrdersRef.current()
    window.addEventListener('dashboard:refresh', onFilled)
    return () => window.removeEventListener('dashboard:refresh', onFilled)
  }, [])

  const fallbackRefPrice = selectedRow?.lastPrice && selectedRow.lastPrice > 0 ? selectedRow.lastPrice : null
  const jupiterMid = jupiterMarks?.mid ?? fallbackRefPrice ?? null
  const orderBookBid =
    quote?.jupiterSellPrice ??
    openOnSelected?.liveSellPrice ??
    jupiterMarks?.bid ??
    (fallbackRefPrice != null ? fallbackRefPrice * 0.9995 : null)
  const orderBookAsk =
    quote?.jupiterBuyPrice ??
    quote?.executablePrice ??
    jupiterMarks?.ask ??
    (fallbackRefPrice != null ? fallbackRefPrice * 1.0005 : null)
  // Both Market Buy and Market Sell buttons display the current live market price
  const chartBuyPrice = jupiterMid ?? orderBookAsk ?? fallbackRefPrice
  const chartSellPrice = jupiterMid ?? orderBookBid ?? fallbackRefPrice

  // When you open/select a bag, start in Sell mode so the big chart price = Live price (bid).
  useEffect(() => {
    if (!selected || !openOnSelected) return
    setSide('SELL')
  }, [selected, openOnSelected?.mint])

  const onChartMarketBuy = () => {
    setSide('BUY')
    setPayWith(USDC_PAY)
    void execute({ side: 'BUY', amount, spendMint: USDC_MINT }, { skipQuoteGate: true })
  }

  const onChartMarketSell = () => {
    setSide('SELL')
    let sellAmt = amount
    const n = Number.parseFloat(amount)
    const px = chartSellPrice
    // Chart amount is often USDC from buy mode — convert to token qty at live bid.
    if (side === 'BUY' && Number.isFinite(n) && n > 0 && px != null && px > 0) {
      const factor = 10 ** 8
      sellAmt = String(Math.floor((n / px) * factor) / factor)
      setAmount(sellAmt)
    }
    void execute({ side: 'SELL', amount: sellAmt }, { skipQuoteGate: true })
  }

  const modeTabs = (
    <div className="flex gap-1 rounded-lg border border-white/10 bg-[#0a0a0f] p-0.5">
      {([
        ['trade', 'Trade'],
        ['router', 'Router'],
        ['predict', 'Predict'],
      ] as const).map(([mode, label]) => (
        <button
          key={mode}
          type="button"
          onClick={() => setPageMode(mode)}
          className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
            pageMode === mode
              ? mode === 'predict'
                ? 'bg-amber-600 text-white'
                : mode === 'router'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-violet-600 text-white'
              : 'text-zinc-400 hover:bg-white/5'
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  )

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-0 flex-col gap-1.5 overflow-hidden">
      {pageMode === 'predict' ? (
        <>
          <div className="flex shrink-0 items-center">{modeTabs}</div>
          <JupiterPredictionsPanel solAddress={solAddress} />
        </>
      ) : pageMode === 'router' ? (
        <>
          <div className="flex shrink-0 items-center">{modeTabs}</div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            <ExecutionEnginePanel
              binanceSymbol={selected ?? 'SOLUSDT'}
              side={side}
              amount={Number.parseFloat(amount) || 50}
              spendMint={side === 'BUY' ? payWith.mint : undefined}
            />
          </div>
        </>
      ) : (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5 overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2">
        {modeTabs}
        <div className="min-w-[11rem] flex-1">
          <JupiterTokenSearch
            rows={rows}
            selected={selected}
            onSelect={(sym) => {
              setSelected(sym)
              try {
                localStorage.setItem(CHART_SYMBOL_LS, sym)
              } catch {
                /* ignore */
              }
            }}
            tradableCount={tradableCount}
            discovering={meta?.discovering ?? false}
          />
        </div>
        {selected ? (
          <div className="min-w-0 flex-[1.3]">
            <JupiterTokenHeader symbol={selected} row={selectedRow} marks={jupiterMarks} />
          </div>
        ) : null}
        <div className="flex rounded-lg border border-white/10 bg-white/[0.03] p-0.5">
          {(
            [
              { id: 'auto', label: 'Super Machine' },
              { id: 'manual', label: 'Manual' },
            ] as const
          ).map((m) => (
            <button
              key={m.id}
              type="button"
              onClick={() => setTerminalMode(m.id)}
              className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                terminalMode === m.id ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              {m.label}
            </button>
          ))}
        </div>
      </div>

      {terminalMode === 'auto' ? <JupiterCouncilStrip watchSymbol={selected} /> : null}

      <div className="grid min-h-0 flex-1 grid-cols-1 grid-rows-[minmax(16rem,1fr)_12.5rem_auto] gap-1.5 lg:grid-cols-[minmax(0,1fr)_20rem] lg:grid-rows-[minmax(0,1fr)_12.5rem] xl:grid-cols-[200px_minmax(0,1fr)_20rem]">
          <div className="hidden min-h-0 xl:order-1 xl:block">
            <JupiterOrderBookPanel
              symbol={selected ?? 'SOLUSDT'}
              label={selected ? pairLabel(selected) : 'SOL/USDT'}
              depth={16}
              className="h-full"
              pollMs={3_500}
              fallbackMid={jupiterMid}
              fallbackBid={orderBookBid}
              fallbackAsk={orderBookAsk}
            />
          </div>
          <div className="h-full min-h-0 min-w-0 overflow-hidden lg:order-1 xl:order-2">
          {selected ? (
            <JupiterTradingChart
              symbol={selected}
              pairLabel={pairLabel(selected)}
              defaultInterval="1m"
              pollMs={20_000}
              fetchCandles={fetchJupiterCandles}
              fetchLivePrice={fetchJupiterLivePrice}
              referencePrice={jupiterMid}
              syncWithOrderBook
              footerLabel=""
              overlayLines={chartOverlays}
              chartTrade={{
                amount,
                onAmountChange: setAmount,
                buyPrice: chartBuyPrice,
                sellPrice: chartSellPrice,
                baseSymbol: side === 'BUY' ? payWith.symbol : baseSym,
                busy: tradeBusy,
                markMode: 'ask',
                onMarketBuy: onChartMarketBuy,
                onMarketSell: onChartMarketSell,
              }}
            />
          ) : (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-2 rounded-xl border border-white/10 bg-[#0a0a0f] px-4 text-center">
              <p className="text-sm text-zinc-400">Search a token above to open the chart</p>
              <p className="text-[11px] text-zinc-600">Press <kbd className="rounded border border-white/10 px-1">/</kbd> to focus search</p>
            </div>
          )}
          </div>

      <div className="flex h-[12.5rem] min-h-0 flex-col overflow-hidden rounded-lg border border-white/10 bg-[#0a0a0f] lg:order-3 lg:col-span-2 xl:order-4 xl:col-span-3">
          <div className="flex shrink-0 items-center justify-between border-b border-white/10 px-3 py-2">
            <div className="flex items-center gap-2">
              <h3 className="text-xs font-semibold text-white">Open positions</h3>
              {positionsLoading ? <span className="text-[10px] text-zinc-600">refreshing…</span> : null}
            </div>
            {positionsTotalPnl != null ? (
              <span className="flex items-center gap-2 text-[11px] text-zinc-400">
                {positionsBankedSkim > 0 ? (
                  <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-mono text-emerald-300">
                    Skimmed +{fmtUsd(positionsBankedSkim)}
                  </span>
                ) : null}
                Total est. net:{' '}
                <LiveNumber
                  value={positionsTotalPnl}
                  className={positionsTotalPnl >= 0 ? 'font-semibold text-emerald-400' : 'font-semibold text-amber-300'}
                >
                  {fmtUsd(positionsTotalPnl)}
                </LiveNumber>
              </span>
            ) : null}
          </div>
          {positions.length === 0 ? (
            <p className="px-3 py-3 text-[11px] text-zinc-600">No open positions.</p>
          ) : (
            <div className="min-h-0 flex-1 overflow-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-[#0a0a0f] text-zinc-500">
                  <tr className="border-b border-white/5">
                    <th className="px-3 py-1.5 font-medium">Token</th>
                    <th className="px-2 py-1.5 text-right font-medium">Entry</th>
                    <th className="px-2 py-1.5 text-right font-medium">Live</th>
                    <th className="px-2 py-1.5 text-right font-medium">Exit bid</th>
                    <th className="px-2 py-1.5 text-right font-medium">Break-even</th>
                    <th className="px-2 py-1.5 text-right font-medium">Est. net</th>
                    <th className="px-2 py-1.5 text-right font-medium">Skimmed</th>
                    <th className="px-3 py-1.5 text-right font-medium">Status</th>
                    <th className="px-2 py-1.5 text-right font-medium">Exit</th>
                  </tr>
                </thead>
                <tbody>
                  {positions.map((p) => (
                    <Fragment key={p.mint}>
                    <tr className="border-b border-white/5 hover:bg-white/5">
                      <td
                        className="cursor-pointer px-3 py-1.5"
                        onClick={() => {
                          setSelected(p.binanceSymbol)
                          setSide('SELL')
                        }}
                      >
                        <span className="font-medium text-zinc-200">{p.baseSymbol}</span>
                        <span className="ml-1 text-[9px] text-zinc-600">{fmtUsd(p.totalAllocUsd)}</span>
                      </td>
                      <td
                        className="cursor-pointer px-2 py-1.5 text-right font-mono text-zinc-400"
                        onClick={() => {
                          setSelected(p.binanceSymbol)
                          setSide('SELL')
                        }}
                      >
                        ${fmtPrice(p.avgEntry)}
                      </td>
                      <td
                        className="cursor-pointer px-2 py-1.5 text-right font-mono text-zinc-200"
                        onClick={() => {
                          setSelected(p.binanceSymbol)
                          setSide('SELL')
                        }}
                      >
                        {p.liveMidPrice != null
                          ? `$${fmtPrice(p.liveMidPrice)}`
                          : p.binanceSymbol === selected && jupiterMid != null
                            ? `$${fmtPrice(jupiterMid)}`
                            : '—'}
                      </td>
                      <td
                        className="cursor-pointer px-2 py-1.5 text-right font-mono text-amber-200/90"
                        onClick={() => {
                          setSelected(p.binanceSymbol)
                          setSide('SELL')
                        }}
                      >
                        {p.liveSellPrice != null ? `$${fmtPrice(p.liveSellPrice)}` : '—'}
                      </td>
                      <td
                        className="cursor-pointer px-2 py-1.5 text-right font-mono text-violet-200/90"
                        onClick={() => {
                          setSelected(p.binanceSymbol)
                          setSide('SELL')
                        }}
                      >
                        {p.breakEvenSellPrice != null ? `$${fmtPrice(p.breakEvenSellPrice)}` : '—'}
                      </td>
                      <td
                        className={`cursor-pointer px-2 py-1.5 text-right font-mono ${
                          (p.estNetPnlUsd ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                        onClick={() => {
                          setSelected(p.binanceSymbol)
                          setSide('SELL')
                        }}
                      >
                        {p.estNetPnlUsd != null ? fmtUsd(p.estNetPnlUsd) : '—'}
                      </td>
                      <td
                        className={`cursor-pointer px-2 py-1.5 text-right font-mono ${
                          (p.bankedSkimUsd ?? 0) > 0 ? 'text-emerald-400' : 'text-zinc-600'
                        }`}
                        onClick={() => {
                          setSelected(p.binanceSymbol)
                          setSide('SELL')
                        }}
                        title="Profit already sold to USDC in your Solana wallet (position still open)"
                      >
                        {(p.bankedSkimUsd ?? 0) > 0 ? `+${fmtUsd(p.bankedSkimUsd ?? 0)}` : '—'}
                      </td>
                      <td
                        className="cursor-pointer px-3 py-1.5 text-right"
                        onClick={() => {
                          setSelected(p.binanceSymbol)
                          setSide('SELL')
                        }}
                      >
                        {p.inProfit ? (
                          <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-medium text-emerald-400">
                            in profit ✓
                          </span>
                        ) : (
                          <span className="rounded bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300">
                            +{(p.upsideToBreakEvenPct ?? 0).toFixed(2)}% to go
                          </span>
                        )}
                        {p.takeProfitPct != null && p.stopLossPct != null ? (
                          <div className="mt-0.5 text-[8px] text-zinc-600" title={p.exitOverrides?.takeProfitPct != null || p.exitOverrides?.stopLossPct != null || p.exitOverrides?.trailingStop != null ? 'Custom for this position' : 'From global exit settings'}>
                            TP {p.takeProfitPct}% · SL {p.stopLossPct}%{p.trailingStop ? ' · trail' : ''}
                            {(p.exitOverrides?.takeProfitPct != null || p.exitOverrides?.stopLossPct != null || p.exitOverrides?.trailingStop != null) ? ' ✎' : ''}
                          </div>
                        ) : null}
                      </td>
                      <td className="px-2 py-1.5 text-right">
                        <div className="flex justify-end gap-1">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={skimBusyMint === p.mint || !p.inProfit}
                            title={
                              p.inProfit
                                ? 'Bank the profit slice into USDC now — position keeps running'
                                : 'Skim unlocks once the live sell price is above your fill'
                            }
                            className="h-6 border-amber-500/30 px-1.5 text-[9px] text-amber-300 hover:bg-amber-500/10"
                            onClick={(e) => {
                              e.stopPropagation()
                              void skimPosition(p)
                            }}
                          >
                            {skimBusyMint === p.mint ? '…' : 'Skim'}
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            title="Edit take-profit / stop-loss for this position"
                            className="h-6 border-sky-500/30 px-1.5 text-[9px] text-sky-300 hover:bg-sky-500/10"
                            onClick={(e) => {
                              e.stopPropagation()
                              if (exitEditMint === p.mint) setExitEditMint(null)
                              else openExitEditor(p)
                            }}
                          >
                            TP/SL
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={sellBusyMint === p.mint}
                            className="h-6 border-emerald-500/30 px-1.5 text-[9px] text-emerald-300 hover:bg-emerald-500/10"
                            onClick={(e) => {
                              e.stopPropagation()
                              void sellPosition(p, 'all')
                            }}
                          >
                            {sellBusyMint === p.mint ? '…' : 'Sell 100%'}
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {exitEditMint === p.mint ? (
                      <tr className="border-b border-white/5 bg-sky-500/[0.04]">
                        <td colSpan={9} className="px-3 py-2">
                          <div className="flex flex-wrap items-center gap-2 text-[10px] text-zinc-400">
                            <span className="font-medium text-sky-300">{p.baseSymbol} exit plan</span>
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
                              Trailing stop
                            </label>
                            <Button
                              type="button"
                              size="sm"
                              disabled={exitEditBusy}
                              className="h-6 px-2 text-[9px]"
                              onClick={() => void saveExitOverrides(p)}
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
                              onClick={() => void saveExitOverrides(p, true)}
                            >
                              Reset
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant="ghost"
                              className="h-6 px-2 text-[9px] text-zinc-500"
                              onClick={() => setExitEditMint(null)}
                            >
                              Cancel
                            </Button>
                            <span className="text-[9px] text-zinc-600">applies live from the next watcher tick (~15s)</span>
                          </div>
                        </td>
                      </tr>
                    ) : null}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      <aside className="flex min-h-0 w-full flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0f] lg:order-2 xl:order-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        {terminalMode === 'auto' ? (
        <div className="min-h-0 flex-1 overflow-y-auto border-b border-white/10 px-3 pb-2 pt-3">
          <h2 className="mb-2 text-sm font-semibold text-white">Super Machine</h2>
          <JupiterSuperMachinePanel
            watchSymbol={selected}
            onPreflightApply={(symbol, slippagePct) => {
              setSelected(symbol)
              setSlippagePct(String(slippagePct))
              if (slippagePct <= 0.5) setSlippagePreset('major')
              else if (slippagePct <= 1) setSlippagePreset('mid')
              else setSlippagePreset('meme')
            }}
          />
          <div className="mt-3 space-y-2">
            <JupiterProfitControls
              slippagePct={slippagePct}
              onSlippagePctChange={setSlippagePct}
              slippagePreset={slippagePreset}
              onSlippagePresetChange={setSlippagePreset}
            />
            <JupiterAutopilotPanel />
          </div>
        </div>
        ) : (
        <div className="min-h-0 flex-1 space-y-2 overflow-y-auto p-3">
        {!meta?.jupiterConfigured ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-xs text-amber-200">
            {meta?.setupHint ??
              'JUPITER_API_KEY missing on server. Add to .env then: docker compose up -d --build api'}
          </p>
        ) : null}
        <JupiterTradeModeTabs mode={tradeMode} onModeChange={setTradeMode} />
        <Dialog open={payPickerOpen} onOpenChange={setPayPickerOpen}>
          <DialogContent className="max-w-sm border-white/10 bg-[#0a0a0f]">
            <DialogHeader>
              <DialogTitle className="text-sm">Pay with</DialogTitle>
            </DialogHeader>
            <div className="max-h-[60vh] space-y-1 overflow-y-auto pr-1">
              {(() => {
                const held = new Map(payTokens.map((t) => [t.mint, t]))
                const base = [
                  held.get(USDC_MINT) ?? { mint: USDC_MINT, symbol: 'USDC', icon: null, amount: 0, decimals: 6, usdPrice: 1, usdValue: 0 },
                  held.get(SOL_MINT) ?? { mint: SOL_MINT, symbol: 'SOL', icon: null, amount: 0, decimals: 9, usdPrice: 0, usdValue: 0 },
                ]
                const rest = payTokens.filter((t) => t.mint !== USDC_MINT && t.mint !== SOL_MINT)
                const list = [...base, ...rest]
                return list.map((t) => (
                  <button
                    key={t.mint}
                    type="button"
                    onClick={() => {
                      setPayWith({ mint: t.mint, symbol: t.symbol, decimals: t.decimals })
                      setAmount(t.mint === USDC_MINT ? '50' : '')
                      setPayPickerOpen(false)
                    }}
                    className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left transition ${
                      payWith.mint === t.mint ? 'bg-violet-500/15 ring-1 ring-violet-400/40' : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-2">
                      {t.icon ? (
                        // Token icons are arbitrary remote/data URIs from the Jupiter
                        // registry, which next/image cannot be configured for.
                        <img src={t.icon} alt="" className="h-6 w-6 rounded-full" />
                      ) : (
                        <div className="flex h-6 w-6 items-center justify-center rounded-full bg-white/10 text-[10px] font-bold text-zinc-300">
                          {t.symbol.slice(0, 2)}
                        </div>
                      )}
                      <div>
                        <div className="text-xs font-semibold text-zinc-100">{t.symbol}</div>
                        <div className="font-mono text-[10px] text-zinc-500">
                          {t.amount > 0 ? t.amount.toPrecision(6) : '0'}
                        </div>
                      </div>
                    </div>
                    <div className="text-right text-[10px] text-zinc-400">
                      {t.usdValue > 0 ? fmtUsd(t.usdValue) : '—'}
                    </div>
                  </button>
                ))
              })()}
            </div>
          </DialogContent>
        </Dialog>

        {tradeMode === 'limit' ? (
          <div className="space-y-2 rounded-lg border border-violet-500/20 bg-violet-500/5 p-2.5">
            <label className="block text-[11px] text-zinc-400">
              Limit price (USD per token)
              <Input
                value={limitPrice}
                onChange={(e) => setLimitPrice(e.target.value)}
                placeholder={jupiterMid != null ? fmtPrice(jupiterMid) : '0.00'}
                className="mt-1 border-white/10 bg-black/40 font-mono"
              />
            </label>
            {limitOrders.length > 0 ? (
              <ul className="space-y-1 text-[10px] text-zinc-400">
                {limitOrders.map((o) => (
                  <li key={o.id} className="flex items-center justify-between rounded border border-white/10 px-2 py-1">
                    <span>
                      {o.side} {o.binanceSymbol.replace(/USDT$/i, '')} @ ${fmtPrice(o.limitPrice)}
                    </span>
                    <button
                      type="button"
                      className="text-rose-300 hover:text-rose-200"
                      onClick={() => void dexJupiter.cancelLimitOrder(o.id).then(() => loadLimitOrders())}
                    >
                      Cancel
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        ) : null}

        {tradeMode === 'recurring' ? (
          <div className="space-y-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2.5">
            <label className="block text-[11px] text-zinc-400">
              USD per buy
              <Input
                value={recurringUsd}
                onChange={(e) => setRecurringUsd(e.target.value)}
                className="mt-1 border-white/10 bg-black/40 font-mono"
              />
            </label>
            <div className="flex gap-1">
              {(['daily', 'weekly'] as const).map((iv) => (
                <button
                  key={iv}
                  type="button"
                  onClick={() => setRecurringEvery(iv)}
                  className={`flex-1 rounded-md py-1.5 text-[11px] capitalize ${
                    recurringEvery === iv ? 'bg-emerald-600 text-white' : 'bg-white/5 text-zinc-400'
                  }`}
                >
                  {iv}
                </button>
              ))}
            </div>
            <Button
              type="button"
              size="sm"
              className="w-full bg-emerald-600 text-xs hover:bg-emerald-500"
              disabled={!selected}
              onClick={async () => {
                if (!selected) return
                const usd = Number.parseFloat(recurringUsd) || 25
                try {
                  await dexJupiter.saveAutopilotSettings({
                    enabled: true,
                    maxBuyUsd: usd,
                    minLiquidityUsd: 150_000,
                    minSignal: 'rising',
                    maxOpenPositions: 3,
                    recurringInterval: recurringEvery,
                    watchSymbol: selected,
                  })
                  toast.success(`Recurring ${recurringEvery} · ~$${usd} on ${selected.replace(/USDT$/i, '')}`)
                } catch {
                  toast.error('Could not enable recurring buys')
                }
              }}
            >
              Enable recurring on chart pair
            </Button>
          </div>
        ) : null}

        {tradable === false ? (
          <p className="text-xs text-rose-300">{resolveMsg}</p>
        ) : resolveMsg ? (
          <p className="text-xs text-amber-300/90">{resolveMsg}</p>
        ) : tradable && quote && quote.amountOutHuman > 0 ? (
          <p className="text-xs text-violet-400/90">Jupiter route available</p>
        ) : quoteBusy ? (
          <p className="text-xs text-zinc-500">Fetching route…</p>
        ) : null}

        <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 p-0.5">
          {(['BUY', 'SELL'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`rounded-md py-2 text-sm font-medium ${
                side === s
                  ? s === 'BUY'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-rose-600 text-white'
                  : 'text-zinc-400'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {side === 'BUY' ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between">
              <span className="text-[11px] text-zinc-400">Pay with</span>
              <button
                type="button"
                onClick={() => {
                  setPayPickerOpen(true)
                  void loadPayTokens()
                }}
                className="flex items-center gap-1.5 rounded-md bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-zinc-200 ring-1 ring-white/10 transition hover:bg-white/10"
              >
                <span className="font-mono">{payWith.symbol}</span>
                <span className="text-zinc-500">▾</span>
              </button>
            </div>
            <label className="block text-[11px] text-zinc-400">
              {payWith.symbol} amount
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder={payWith.mint === USDC_MINT ? '50' : 'e.g. 0.25'}
                inputMode="decimal"
                className="mt-1 border-white/10 bg-black/40 font-mono"
              />
            </label>
          </div>
        ) : (
          <label className="text-[11px] text-zinc-400">
            {`Token amount (${pairLabel(selected ?? '').split('/')[0] ?? 'token'})`}
            <Input
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              className="mt-1 border-white/10 bg-black/40 font-mono"
            />
          </label>
        )}

        {quoteBusy ? <p className="text-xs text-zinc-500">Fetching best route…</p> : null}
        {quote ? (
          <div className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-2.5 text-xs">
            {/* Clear ticket — what you pay / get / which route executes */}
            <div className="rounded-md border border-emerald-500/25 bg-emerald-500/5 px-2.5 py-2">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-emerald-300/90">
                This trade will execute
              </p>
              <p className="mt-1 text-sm font-semibold text-white">
                {routeCompare?.best?.label ??
                  (quote.router ? `Jupiter · ${quote.router}` : 'Jupiter smart route')}
                {routeCompare?.best ? (
                  <span className="ml-2 font-mono text-[11px] font-normal text-emerald-300">
                    score {routeCompare.best.score.toFixed(0)}
                  </span>
                ) : null}
              </p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div>
                  <p className="text-[10px] text-zinc-500">You pay</p>
                  <p className="font-mono text-sm text-zinc-100">
                    {side === 'BUY'
                      ? `${amount} ${payWith.symbol}`
                      : `${amount} ${baseSym}`}
                  </p>
                </div>
                <div>
                  <p className="text-[10px] text-zinc-500">You get (est.)</p>
                  <p className="font-mono text-sm text-emerald-300">
                    {quote.amountOutHuman.toPrecision(5)}{' '}
                    {side === 'BUY' ? baseSym : 'USDC'}
                  </p>
                </div>
              </div>
              {quote.executablePrice != null ? (
                <p className="mt-1.5 font-mono text-[11px] text-zinc-300">
                  {side === 'BUY' ? 'Ask (you pay)' : 'Bid (you receive)'} ≈ ${fmtPrice(quote.executablePrice)}
                  <span className="text-zinc-600"> / {baseSym}</span>
                  {quote.jupiterBuyPrice != null && quote.jupiterSellPrice != null ? (
                    <span className="ml-2 text-zinc-500">
                      mid ${fmtPrice((quote.jupiterBuyPrice + quote.jupiterSellPrice) / 2)}
                    </span>
                  ) : null}
                  {quote.priceImpactPct != null ? (
                    <span className="ml-2 text-zinc-500">
                      impact {quote.priceImpactPct.toFixed(3)}%
                    </span>
                  ) : null}
                </p>
              ) : null}
            </div>

            {/* Route price board — short & readable */}
            {(routeCompare?.routes?.length ?? 0) > 0 ? (
              <div>
                <p className="mb-1 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                  Route prices (best highlighted)
                </p>
                <div className="max-h-28 overflow-y-auto rounded border border-white/5">
                  <table className="w-full text-left text-[10px]">
                    <thead className="sticky top-0 bg-[#12121a] text-zinc-500">
                      <tr>
                        <th className="px-2 py-1 font-medium">Route</th>
                        <th className="px-2 py-1 font-medium">You get</th>
                        <th className="px-2 py-1 font-medium">Speed</th>
                        <th className="px-2 py-1 font-medium">Score</th>
                      </tr>
                    </thead>
                    <tbody>
                      {routeCompare!.routes.slice(0, 6).map((r) => {
                        const isBest = routeCompare?.best?.router === r.router
                        return (
                          <tr
                            key={r.router}
                            className={`border-t border-white/5 ${isBest ? 'bg-emerald-500/10' : ''}`}
                          >
                            <td className="px-2 py-1 text-zinc-200">
                              {isBest ? '→ ' : ''}
                              {r.label}
                            </td>
                            <td className="px-2 py-1 font-mono text-zinc-300">
                              {r.executable ? r.outAmount.toPrecision(4) : '—'}
                            </td>
                            <td className="px-2 py-1 font-mono text-zinc-500">
                              {r.latencyMs ? `${r.latencyMs}ms` : '—'}
                            </td>
                            <td
                              className={`px-2 py-1 font-mono ${
                                isBest ? 'font-semibold text-emerald-400' : 'text-zinc-400'
                              }`}
                            >
                              {r.executable ? r.score.toFixed(0) : '—'}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : quote.router ? (
              <p className="text-[11px] text-zinc-400">
                Active route: <span className="font-medium text-zinc-200">{quote.router}</span>
              </p>
            ) : null}

            {/* Simple context — not jargon dump */}
            {quote.jupiterBuyPrice != null && quote.jupiterSellPrice != null ? (
              <p className="font-mono text-[11px] text-zinc-400">
                Ask ${fmtPrice(quote.jupiterBuyPrice)} · Bid ${fmtPrice(quote.jupiterSellPrice)}
              </p>
            ) : null}

            {side === 'SELL' && quote.openEntryPrice != null ? (
              <p className="text-[11px] text-zinc-400">
                Your entry ${fmtPrice(quote.openEntryPrice)}
                {quote.estNetPnlUsd != null ? (
                  <span className={quote.estNetPnlUsd >= 0 ? ' text-emerald-400' : ' text-rose-400'}>
                    {' '}
                    · est. net {quote.estNetPnlUsd >= 0 ? '+' : ''}
                    ${fmtPrice(Math.abs(quote.estNetPnlUsd))}
                  </span>
                ) : null}
              </p>
            ) : null}
            {side === 'SELL' && quote.breakEvenSellPrice != null ? (
              <p className="rounded border border-violet-500/20 bg-violet-500/5 px-2 py-1 text-[11px] text-violet-200">
                Break-even sell ${fmtPrice(quote.breakEvenSellPrice)}
                {quote.upsideToBreakEvenPct != null && quote.upsideToBreakEvenPct > 0
                  ? ` · needs +${quote.upsideToBreakEvenPct.toFixed(2)}%`
                  : quote.upsideToBreakEvenPct != null
                    ? ' · profitable now'
                    : ''}
              </p>
            ) : null}
            {blockTrade && quote.blockReason ? (
              <p className="text-rose-300/90">{quote.blockReason}</p>
            ) : null}
          </div>
        ) : null}

        <Button
          disabled={
            tradeBusy ||
            tradable === false ||
            !selected ||
            (tradeMode === 'market' &&
              walletView.source === 'platform' &&
              (!quoteReady || blockTrade)) ||
            (tradeMode === 'limit' && !limitPrice.trim())
          }
          onClick={async () => {
            if (tradeMode === 'limit') {
              if (!selected) return
              const lp = Number.parseFloat(limitPrice)
              const amt = Number.parseFloat(amount)
              if (!Number.isFinite(lp) || lp <= 0 || !Number.isFinite(amt) || amt <= 0) {
                toast.error('Enter limit price and amount')
                return
              }
              try {
                await dexJupiter.createLimitOrder({
                  binanceSymbol: selected,
                  side,
                  limitPrice: lp,
                  amount: amt,
                  spendMint: side === 'BUY' ? payWith.mint : undefined,
                })
                toast.success('Limit order placed — server will fill when price hits')
                void loadLimitOrders()
              } catch (e: unknown) {
                const ax = e as { response?: { data?: { error?: string } } }
                toast.error(ax.response?.data?.error ?? 'Limit order failed')
              }
              return
            }
            if (tradeMode === 'recurring') return
            void execute()
          }}
          className={side === 'BUY' ? 'bg-violet-600 hover:bg-violet-500' : 'bg-rose-600 hover:bg-rose-500'}
        >
          {tradeBusy
            ? browserSwap.stage === 'signing'
              ? 'Sign in your wallet…'
              : browserSwap.stage === 'quoting'
                ? 'Building route…'
                : 'Submitting…'
            : tradeMode === 'limit'
              ? `Place limit ${side}`
              : `${side} · ${
                walletView.source === 'browser'
                  ? (walletView.label.split(' ')[0] ?? 'Wallet')
                  : (routeCompare?.best?.label?.split(' ')[0] ?? quote?.router ?? 'Jupiter')
              }`}
        </Button>
        {/* Same exit engine as Super Machine — manual buys are watched by the server too. */}
        <JupiterProfitControls
          slippagePct={slippagePct}
          onSlippagePctChange={setSlippagePct}
          slippagePreset={slippagePreset}
          onSlippagePresetChange={setSlippagePreset}
        />
        </div>
        )}
        </div>
      </aside>
      </div>
      <div className="xl:hidden">
        <JupiterOrderBookPanel
          symbol={selected ?? 'SOLUSDT'}
          label={selected ? pairLabel(selected) : 'SOL/USDT'}
          depth={12}
          className="max-h-[240px]"
          pollMs={3_500}
          fallbackMid={jupiterMid}
          fallbackBid={orderBookBid}
          fallbackAsk={orderBookAsk}
        />
      </div>
    </div>
      )}
    </div>
  )
}

export default function DexJupiterPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">Loading Solana…</div>}>
      <DexJupiterContent />
    </Suspense>
  )
}
