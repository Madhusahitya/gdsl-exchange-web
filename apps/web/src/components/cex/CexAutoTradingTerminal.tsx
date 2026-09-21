'use client'

/**
 * Binance CEX Auto Trading terminal — Super Machine toggle + chart + order book
 * + recommendations. Replaces the banner-heavy legacy /trading page layout.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import axios from 'axios'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { engine } from '@/lib/api'
import { TradingViewEmbed } from '@/components/trading/TradingViewEmbed'
import { MaxTradeSelect } from '@/components/trading/MaxTradeSelect'
import { CexProfitControls } from '@/components/cex/CexProfitControls'
import { CexMarketTradePanel } from '@/components/cex/CexMarketTradePanel'
import { CexChartMarketBar } from '@/components/cex/CexChartMarketBar'
import { CexBinanceAccountPanel } from '@/components/cex/CexBinanceAccountPanel'
import { CexCouncilStrip } from '@/components/cex/CexCouncilStrip'
import { useCexMarketTrade } from '@/hooks/useCexMarketTrade'
import { useSocket } from '@/hooks/useSocket'
import { LivePulse, LiveNumber } from '@/components/ui/LiveNumber'
import { OrderBookPanel } from '@/components/market/OrderBookPanel'
const CORE_PAIRS = [
  { symbol: 'BTCUSDT', label: 'BTC/USDT' },
  { symbol: 'ETHUSDT', label: 'ETH/USDT' },
  { symbol: 'BNBUSDT', label: 'BNB/USDT' },
  { symbol: 'SOLUSDT', label: 'SOL/USDT' },
  { symbol: 'XRPUSDT', label: 'XRP/USDT' },
] as const

type BoardRow = {
  symbol: string
  lastPrice: number
  priceChangePercent: number
  quoteVolume: number
}

function fmtPx(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(4)
  return n.toFixed(6)
}

type DeskMode = 'auto' | 'manual'

export function CexAutoTradingTerminal() {
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [mode, setMode] = useState<DeskMode>('auto')
  const modeRef = useRef<DeskMode>('auto')
  const [availableUsdt, setAvailableUsdt] = useState(0)
  const [connId, setConnId] = useState<string | null>(null)
  const [ready, setReady] = useState(false)
  const [blockers, setBlockers] = useState<string[]>([])
  const [smEnabled, setSmEnabled] = useState(false)
  const [smRunning, setSmRunning] = useState(false)
  const [smBusy, setSmBusy] = useState(false)
  const [maxTradeUsd, setMaxTradeUsd] = useState(25)
  /** Operator per-order cap (CEX_LIVE_MAX_ORDER_USDT); the server clamps to it. */
  const [maxTradeCap, setMaxTradeCap] = useState(500)
  const [maxTradeBusy, setMaxTradeBusy] = useState(false)
  const [openPos, setOpenPos] = useState<Awaited<ReturnType<typeof engine.cexSuperMachine>>['openPosition']>(null)
  const [skimBusy, setSkimBusy] = useState(false)
  const [exitEditOpen, setExitEditOpen] = useState(false)
  const [exitEditTp, setExitEditTp] = useState('')
  const [exitEditSl, setExitEditSl] = useState('')
  const [exitEditTrail, setExitEditTrail] = useState(false)
  const [exitEditBusy, setExitEditBusy] = useState(false)
  const [lastDecision, setLastDecision] = useState<{
    action: string
    consensus: number
    symbol: string | null
    reasons: string[]
  } | null>(null)
  const [mid, setMid] = useState<number | null>(null)
  const [spreadBps, setSpreadBps] = useState<number | null>(null)
  const [liveBid, setLiveBid] = useState<number | null>(null)
  const [liveAsk, setLiveAsk] = useState<number | null>(null)
  const [board, setBoard] = useState<BoardRow[]>([])
  const [boardTotal, setBoardTotal] = useState(0)
  const [boardFilter, setBoardFilter] = useState('')

  const onPricesChange = useCallback(
    (prices: {
      bestBid: number | null
      bestAsk: number | null
      mid: number | null
      spreadBps: number | null
    }) => {
      if (prices.bestBid != null) setLiveBid(prices.bestBid)
      if (prices.bestAsk != null) setLiveAsk(prices.bestAsk)
      if (prices.mid != null) setMid(prices.mid)
      if (prices.spreadBps != null) setSpreadBps(prices.spreadBps)
    },
    [],
  )

  const trade = useCexMarketTrade(
    symbol,
    () => {
      void refreshSm()
      window.dispatchEvent(new Event('dashboard:refresh'))
    },
    { buyPrice: liveAsk, sellPrice: liveBid },
  )

  const activeSymbol = trade.desk?.tradeSymbol ?? symbol
  const tvSymbol = `BINANCE:${activeSymbol}`

  const onBinanceReady = useCallback(
    (isReady: boolean, id: string | null, blockersList: string[]) => {
      setConnId(id)
      setReady(isReady)
      setBlockers(blockersList)
    },
    [],
  )

  const onBinanceUsdt = useCallback((usdt: number) => {
    setAvailableUsdt(usdt)
  }, [])

  const refreshSm = useCallback(async () => {
    try {
      const s = await engine.cexSuperMachine()
      setSmEnabled(s.settings.enabled)
      setSmRunning(s.running)
      setMaxTradeUsd(s.settings.maxTradeUsd)
      setOpenPos(s.openPosition)
      const d = s.lastDecisions?.[0]
      setLastDecision(
        d
          ? {
              action: d.action,
              consensus: d.consensus,
              symbol: d.symbol,
              reasons: d.reasons ?? [],
            }
          : null,
      )
      // On the manual desk the user drives the symbol, so don't snap it back to
      // whatever the machine is watching on the next poll.
      if (s.settings.watchSymbol && modeRef.current === 'auto') {
        setSymbol(s.settings.watchSymbol.replace('/', '').toUpperCase())
      }
    } catch {
      /* ignore */
    }
  }, [])

  const refreshBoard = useCallback(async () => {
    try {
      const b = await engine.marketBoard(500)
      const majors = new Set<string>(CORE_PAIRS.map((p) => p.symbol))
      const sorted = [...b.rows].sort((a, c) => c.quoteVolume - a.quoteVolume)
      setBoardTotal(sorted.length)
      setBoard([
        ...sorted.filter((r) => majors.has(r.symbol)),
        ...sorted.filter((r) => !majors.has(r.symbol)),
      ])
    } catch {
      /* ignore */
    }
  }, [])

  useEffect(() => {
    void refreshSm()
    void refreshBoard()
  }, [refreshSm, refreshBoard])

  useSocket({
    onTradeExecuted: () => {
      void refreshSm()
    },
  })

  useEffect(() => {
    const onRefresh = () => void refreshSm()
    window.addEventListener('dashboard:refresh', onRefresh)
    return () => window.removeEventListener('dashboard:refresh', onRefresh)
  }, [refreshSm])

  useEffect(() => {
    engine
      .cexExit()
      .then((r) => {
        const cap = r.defaults?.maxOrderUsdt
        if (Number.isFinite(cap) && cap >= 5) setMaxTradeCap(cap)
      })
      .catch(() => {
        /* keep route-level default */
      })
  }, [])

  const saveMaxTrade = async (usd: number) => {
    setMaxTradeBusy(true)
    const prev = maxTradeUsd
    setMaxTradeUsd(usd)
    try {
      await engine.setCexSuperMachine({ maxTradeUsd: usd })
      await refreshSm()
    } catch (e) {
      setMaxTradeUsd(prev)
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error as string) || e.message : 'Failed to save max trade'
      toast.error(msg)
    } finally {
      setMaxTradeBusy(false)
    }
  }

  const pickSymbol = async (sym: string) => {
    const next = sym.replace('/', '').toUpperCase()
    setSymbol(next)
    setLiveBid(null)
    setLiveAsk(null)
    // Browsing pairs on the manual desk must not retarget the Super Machine.
    if (mode === 'manual') return
    try {
      await engine.setCexSuperMachine({ watchSymbol: next })
      await refreshSm()
    } catch {
      /* still allow chart switch */
    }
  }

  const toggleSm = async () => {
    setSmBusy(true)
    try {
      const turningOn = !smEnabled
      if (turningOn) {
        window.dispatchEvent(new Event('cex-sm:preflight'))
      }
      // The user's max-trade choice persists across on/off; the council already
      // sizes each entry down to free USDT, so no auto-resize is needed here.
      await engine.setCexSuperMachine({
        enabled: turningOn,
        exchangeConnectionId: connId,
        watchSymbol: symbol,
      })
      await refreshSm()
      toast.success(turningOn ? 'CEX Super Machine ON — council gating entries' : 'CEX Super Machine OFF')
    } catch (e) {
      const msg = axios.isAxiosError(e)
        ? (e.response?.data?.error as string) || e.message
        : 'Failed to update Super Machine'
      toast.error(msg)
    } finally {
      setSmBusy(false)
    }
  }

  const filteredBoard = useMemo(() => {
    const q = boardFilter.trim().toUpperCase()
    if (!q) return board
    return board.filter((r) => r.symbol.includes(q))
  }, [board, boardFilter])

  /** Bank the profit slice into USDT — the position keeps running. */
  const skimOpenPosition = useCallback(async () => {
    if (!openPos) return
    setSkimBusy(true)
    try {
      const res = await engine.skimCexPosition()
      toast.success(
        `Skimmed ${res.pair} profit → USDT · +$${(res.skimmedUsdTotal).toFixed(2)} banked total`,
      )
      await refreshSm()
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      const msg = axios.isAxiosError(e)
        ? (e.response?.data?.error as string) || e.message
        : 'Skim failed'
      toast.error(msg)
    } finally {
      setSkimBusy(false)
    }
  }, [openPos, refreshSm])

  const openExitEditor = useCallback(() => {
    if (!openPos) return
    setExitEditTp(String(openPos.effectiveTakeProfitPct ?? ''))
    setExitEditSl(String(openPos.effectiveStopLossPct ?? ''))
    setExitEditTrail(openPos.effectiveTrailingStop ?? false)
    setExitEditOpen(true)
  }, [openPos])

  /** Save per-position TP/SL — the watcher follows these from the next tick. */
  const saveExitOverrides = useCallback(
    async (reset = false) => {
      setExitEditBusy(true)
      try {
        const tp = Number.parseFloat(exitEditTp)
        const sl = Number.parseFloat(exitEditSl)
        await engine.setCexPositionExitOverrides(
          reset
            ? { takeProfitPct: null, stopLossPct: null, trailingStop: null }
            : {
                takeProfitPct: Number.isFinite(tp) ? tp : null,
                stopLossPct: Number.isFinite(sl) ? sl : null,
                trailingStop: exitEditTrail,
              },
        )
        toast.success(reset ? 'Back to global TP/SL' : 'Position TP/SL updated — live from next tick')
        setExitEditOpen(false)
        await refreshSm()
      } catch (e) {
        const msg = axios.isAxiosError(e)
          ? (e.response?.data?.error as string) || e.message
          : 'Could not update TP/SL'
        toast.error(msg)
      } finally {
        setExitEditBusy(false)
      }
    },
    [exitEditTp, exitEditSl, exitEditTrail, refreshSm],
  )

  return (
    <div className="flex min-h-[calc(100vh-5rem)] flex-col gap-3 p-3 lg:p-4">
      {/* Top bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-white">Binance</h1>
        </div>
        <div className="flex flex-wrap items-center gap-3">
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
                onClick={() => {
                  setMode(m.id)
                  modeRef.current = m.id
                }}
                className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
                  mode === m.id ? 'bg-white/15 text-white' : 'text-zinc-400 hover:text-zinc-200'
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
          <CexBinanceAccountPanel
            symbol={symbol}
            onReadyChange={onBinanceReady}
            onUsdtChange={onBinanceUsdt}
          />
          <label className="flex cursor-pointer items-center gap-2 rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-2">
            <span className="text-xs font-medium text-sky-100">Super Machine</span>
            <button
              type="button"
              role="switch"
              aria-checked={smEnabled}
              disabled={smBusy}
              onClick={() => {
                if (!smEnabled && !ready) {
                  toast.error(blockers[0] ?? 'Connect Binance first. Enable risk in Settings if asked.')
                  return
                }
                void toggleSm()
              }}
              className={`relative h-6 w-11 rounded-full transition ${
                smEnabled ? 'bg-emerald-500' : 'bg-zinc-600'
              } disabled:opacity-40`}
            >
              <span
                className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${
                  smEnabled ? 'left-5' : 'left-0.5'
                }`}
              />
            </button>
            {/*
              Three distinct states, not two. The machine stays enabled until the
              user switches it off; when it is enabled but Binance is not ready it
              is paused, not off. Showing "OFF" there made it look like the toggle
              had turned itself off.
            */}
            <span
              className={`font-mono text-[10px] ${
                !smEnabled ? 'text-zinc-400' : smRunning ? 'text-emerald-300' : 'text-amber-300'
              }`}
              title={
                smEnabled && !smRunning
                  ? (blockers[0] ?? 'Enabled — waiting on the Binance connection.')
                  : undefined
              }
            >
              {smBusy ? '…' : !smEnabled ? 'OFF' : smRunning ? 'ON' : 'PAUSED'}
            </span>
          </label>
        </div>
      </div>

      {mode === 'auto' ? (
        <CexCouncilStrip watchSymbol={symbol} smEnabled={smEnabled} smRunning={smRunning} />
      ) : null}

      {/* Pair strip */}
      <div className="flex flex-wrap items-center gap-2">
        {CORE_PAIRS.map((p) => (
          <button
            key={p.symbol}
            type="button"
            onClick={() => void pickSymbol(p.symbol)}
            className={`rounded-md px-2.5 py-1 font-mono text-xs ${
              symbol === p.symbol
                ? 'bg-white/15 text-white'
                : 'bg-white/5 text-zinc-400 hover:bg-white/10 hover:text-zinc-200'
            }`}
          >
            {p.label}
          </button>
        ))}
        <span className="ml-auto font-mono text-sm text-white">
          <LiveNumber value={mid}>{mid != null ? fmtPx(mid) : '—'}</LiveNumber>
          {trade.desk?.quoteAsset === 'USDC' ? (
            <span className="ml-2 text-[10px] text-sky-400">{trade.desk.pair}</span>
          ) : null}
          {spreadBps != null ? (
            <span className="ml-2 text-[10px] text-zinc-500">{spreadBps.toFixed(1)} bps</span>
          ) : null}
        </span>
      </div>

      {/* Main grid: order book | chart | recommendations */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 xl:grid-cols-[260px_minmax(0,1fr)_280px]">
        <OrderBookPanel
          symbol={activeSymbol}
          className="max-h-[640px]"
          onMidChange={(nextMid, nextSpread) => {
            if (nextMid != null) setMid(nextMid)
            if (nextSpread != null) setSpreadBps(nextSpread)
          }}
          onPricesChange={onPricesChange}
        />

        {/* Chart + instant market buy/sell */}
        <div className="relative flex min-h-[420px] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0f]">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-1.5">
            <span className="text-[10px] uppercase tracking-wide text-zinc-500">
              Live chart · {trade.desk?.pair ?? symbol}
            </span>
            <LivePulse />
          </div>
          <div className="relative min-h-0 flex-1">
            <CexChartMarketBar
              amount={trade.amount}
              onAmountChange={trade.setAmount}
              quoteAsset={trade.quoteAsset}
              baseAsset={trade.baseAsset}
              buyPrice={liveAsk ?? trade.buyPrice ?? mid}
              sellPrice={liveBid ?? trade.sellPrice ?? mid}
              busy={trade.busy}
              onMarketBuy={() => void trade.marketBuy()}
              onMarketSell={() => void trade.marketSell()}
            />
            <TradingViewEmbed symbol={tvSymbol} height={480} />
          </div>
        </div>

        {/* Market ticket + Super Machine / board */}
        <div className="flex max-h-[720px] flex-col gap-3 overflow-y-auto">
          <CexMarketTradePanel trade={trade} />

          <CexProfitControls />

          <div className={`rounded-xl border border-white/10 bg-[#0a0a0f] p-3 ${mode === 'manual' ? 'hidden' : ''}`}>
            <p className="text-[10px] uppercase tracking-wide text-zinc-500">Council / position</p>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[11px] text-zinc-500">Max trade</span>
              <div className="flex items-center gap-2">
                <MaxTradeSelect
                  value={maxTradeUsd}
                  onChange={(usd) => void saveMaxTrade(usd)}
                  min={5}
                  max={maxTradeCap}
                  disabled={maxTradeBusy}
                />
                {availableUsdt > 0 ? (
                  <span className="font-mono text-[9px] text-zinc-500">({availableUsdt.toFixed(0)} USDT)</span>
                ) : null}
              </div>
            </div>
            <p className="mt-1 font-mono text-xs text-zinc-300">strategy: AI council (majors)</p>
            {openPos ? (
              <div className="mt-2 rounded-lg border border-emerald-500/20 bg-emerald-500/5 p-2">
                <div className="flex items-center justify-between gap-2">
                  <p className="font-mono text-xs text-emerald-200">
                    Open {openPos.pair} · ${openPos.entryPrice.toFixed(2)} · cost ${openPos.quoteSpent.toFixed(2)}
                  </p>
                  {openPos.pnlPct != null ? (
                    <span
                      className={`font-mono text-[11px] font-semibold ${
                        openPos.pnlPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {openPos.pnlPct >= 0 ? '+' : ''}
                      {openPos.pnlPct.toFixed(2)}%
                      {openPos.pnlUsd != null ? ` · ${openPos.pnlUsd >= 0 ? '+' : ''}$${openPos.pnlUsd.toFixed(2)}` : ''}
                    </span>
                  ) : null}
                </div>
                <p className="mt-1 font-mono text-[9px] text-zinc-500">
                  TP {openPos.effectiveTakeProfitPct}% · SL {openPos.effectiveStopLossPct}%
                  {openPos.effectiveTrailingStop ? ' · trailing' : ''}
                  {openPos.takeProfitPct != null || openPos.stopLossPct != null || openPos.trailingStop != null
                    ? ' · custom ✎'
                    : ''}
                  {openPos.skimmedUsd > 0 ? ` · skimmed +$${openPos.skimmedUsd.toFixed(2)}` : ''}
                </p>
                <div className="mt-2 flex items-center gap-1.5">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={skimBusy || (openPos.pnlUsd ?? 0) <= 0}
                    title={
                      (openPos.pnlUsd ?? 0) > 0
                        ? 'Bank the profit slice into USDT now — position keeps running'
                        : 'Skim unlocks once the position is in profit'
                    }
                    className="h-6 border-amber-500/30 px-2 text-[9px] text-amber-300 hover:bg-amber-500/10"
                    onClick={() => void skimOpenPosition()}
                  >
                    {skimBusy ? '…' : 'Skim'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    title="Edit take-profit / stop-loss for this position"
                    className="h-6 border-sky-500/30 px-2 text-[9px] text-sky-300 hover:bg-sky-500/10"
                    onClick={() => (exitEditOpen ? setExitEditOpen(false) : openExitEditor())}
                  >
                    TP/SL
                  </Button>
                </div>
                {exitEditOpen ? (
                  <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-white/5 pt-2 text-[10px] text-zinc-400">
                    <label className="flex items-center gap-1">
                      TP %
                      <input
                        type="number"
                        min="0.2"
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
                        min="0.2"
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
                      onClick={() => void saveExitOverrides()}
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
                      onClick={() => void saveExitOverrides(true)}
                    >
                      Reset
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-6 px-2 text-[9px] text-zinc-500"
                      onClick={() => setExitEditOpen(false)}
                    >
                      Cancel
                    </Button>
                  </div>
                ) : null}
              </div>
            ) : (
              <p className="mt-2 text-[11px] text-zinc-500">No open Super Machine position</p>
            )}
            {lastDecision ? (
              <p className="mt-2 text-[11px] text-zinc-400">
                Last:{' '}
                <span className="text-white">{lastDecision.action}</span> ·{' '}
                {(lastDecision.consensus * 100).toFixed(0)}% · {lastDecision.symbol ?? '—'}
                <span className="mt-0.5 block text-zinc-600">{lastDecision.reasons[0]}</span>
              </p>
            ) : null}
            <Button type="button" size="sm" variant="outline" className="mt-2 h-7 text-[10px]" asChild>
              <Link href="/agents">AI Agents</Link>
            </Button>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0f]">
            <div className="border-b border-white/10 px-2 py-1.5">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                All Binance USDT markets
                {boardTotal > 0 ? (
                  <span className="ml-1 normal-case text-zinc-600">· {boardTotal} pairs</span>
                ) : null}
              </p>
              <input
                value={boardFilter}
                onChange={(e) => setBoardFilter(e.target.value)}
                placeholder="Search…"
                className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1 text-xs text-white outline-none focus:border-sky-500/50"
              />
            </div>
            <div className="grid grid-cols-3 gap-1 px-2 py-1 text-[9px] text-zinc-600">
              <span>Pair</span>
              <span className="text-right">Price</span>
              <span className="text-right">24h</span>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto">
              {filteredBoard.map((r) => (
                <button
                  key={r.symbol}
                  type="button"
                  onClick={() => void pickSymbol(r.symbol)}
                  className={`grid w-full grid-cols-3 gap-1 px-2 py-1.5 text-left font-mono text-[10px] hover:bg-white/5 ${
                    symbol === r.symbol ? 'bg-white/10' : ''
                  }`}
                >
                  <span className="truncate text-zinc-200">{r.symbol.replace('USDT', '')}/USDT</span>
                  <span className="text-right text-zinc-300">{fmtPx(r.lastPrice)}</span>
                  <span
                    className={`text-right ${
                      r.priceChangePercent >= 0 ? 'text-emerald-300' : 'text-rose-300'
                    }`}
                  >
                    {r.priceChangePercent >= 0 ? '+' : ''}
                    {r.priceChangePercent.toFixed(2)}%
                  </span>
                </button>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
