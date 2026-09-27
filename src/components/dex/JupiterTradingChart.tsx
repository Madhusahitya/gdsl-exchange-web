'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type LiveCandle } from '@/lib/api'
import { connectSocket } from '@/lib/socket'

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const
type Interval = (typeof INTERVALS)[number]

export type ChartOverlayLine = {
  label: string
  price: number
  color: string
}

type FetchCandlesResult = {
  candles: LiveCandle[]
  footerExtra?: string
  stale?: boolean
  degraded?: boolean
  note?: string
}

type Props = {
  symbol: string
  pairLabel?: string
  defaultInterval?: Interval
  pollMs?: number
  fetchCandles: (symbol: string, interval: Interval, limit: number) => Promise<FetchCandlesResult>
  /** Fast live-price tick — mutates last candle like Binance. */
  fetchLivePrice?: (symbol: string) => Promise<number | null>
  footerLabel?: string
  overlayLines?: ChartOverlayLine[]
  /** Binance-style on-chart Market Buy / Amount / Market Sell. */
  chartTrade?: {
    amount: string
    onAmountChange: (v: string) => void
    buyPrice: number | null
    sellPrice: number | null
    baseSymbol: string
    busy?: boolean
    /** Primary chart mark: ask when buying, bid when selling / managing a position. */
    markMode?: 'ask' | 'bid'
    onMarketBuy: () => void
    onMarketSell: () => void
  }
  /** Jupiter mid — aligns chart with order book and open positions (same feed). */
  referencePrice?: number | null
  /** When true, chart headline tracks referencePrice (unified Jupiter mid). */
  syncWithOrderBook?: boolean
}

function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (value >= 1) return value.toFixed(4)
  return value.toPrecision(6)
}

function fmtTime(ms: number): string {
  return new Date(ms).toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

function candleChangePct(c: LiveCandle): number {
  if (c.open <= 0) return 0
  return ((c.close - c.open) / c.open) * 100
}

type Guidance = {
  tone: 'buy-ok' | 'wait' | 'caution'
  title: string
  detail: string
}

function buildGuidance(data: LiveCandle[], interval: Interval): Guidance | null {
  if (data.length < 4) return null
  const first = data[0]!
  const last = data[data.length - 1]!
  const periodPct = first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0
  const recent = data.slice(-5)
  const green = recent.filter((c) => c.close >= c.open).length
  const red = recent.length - green

  if (periodPct >= 1.5 && green >= 3) {
    return {
      tone: 'buy-ok',
      title: 'Momentum rising',
      detail: `Up ${periodPct.toFixed(1)}% over this ${interval} window · ${green}/5 recent candles green. OK to look for a buy — still check spread & break-even before clicking BUY.`,
    }
  }
  if (periodPct <= -2 || red >= 4) {
    return {
      tone: 'caution',
      title: 'Price falling — patience helps',
      detail: `Down ${Math.abs(periodPct).toFixed(1)}% this period · mostly red candles. Waiting for a turn often beats chasing.`,
    }
  }
  if (Math.abs(periodPct) < 0.4) {
    return {
      tone: 'wait',
      title: 'Sideways — no clear edge',
      detail: 'Price is flat. Many traders wait for a clearer green or red move before sizing in.',
    }
  }
  if (periodPct > 0) {
    return {
      tone: 'buy-ok',
      title: 'Mild uptrend',
      detail: `+${periodPct.toFixed(1)}% this period. Fine to trade if entry spread is tight — use the quote panel gate.`,
    }
  }
  return {
    tone: 'wait',
    title: 'Mixed / weak trend',
    detail: `Period ${periodPct >= 0 ? '+' : ''}${periodPct.toFixed(1)}%. Consider waiting for stronger momentum or a green candle cluster.`,
  }
}

export function JupiterTradingChart({
  symbol,
  pairLabel,
  defaultInterval = '15m',
  pollMs = 10_000,
  fetchCandles,
  fetchLivePrice,
  footerLabel,
  overlayLines = [],
  chartTrade,
  referencePrice = null,
  syncWithOrderBook = false,
}: Props) {
  const [interval, setIntervalState] = useState<Interval>(defaultInterval)
  const [data, setData] = useState<LiveCandle[]>([])
  const [footerExtra, setFooterExtra] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [degraded, setDegraded] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [connIssue, setConnIssue] = useState(false)
  const [retryIn, setRetryIn] = useState(0)
  const [loading, setLoading] = useState(false)
  const [hoverIdx, setHoverIdx] = useState<number | null>(null)
  const [lastRefresh, setLastRefresh] = useState<number>(Date.now())
  const [priceFlash, setPriceFlash] = useState<'up' | 'down' | null>(null)
  const [livePrice, setLivePrice] = useState<number | null>(null)
  const flashTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const prevPriceRef = useRef<number | null>(null)
  const dataRef = useRef<LiveCandle[]>([])
  dataRef.current = data

  const flashPrice = useCallback((next: number) => {
    const prev = prevPriceRef.current
    prevPriceRef.current = next
    if (prev == null || prev === next) return
    setPriceFlash(next > prev ? 'up' : 'down')
    if (flashTimer.current) clearTimeout(flashTimer.current)
    flashTimer.current = setTimeout(() => setPriceFlash(null), 700)
  }, [])

  const refresh = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    try {
      const result = await fetchCandles(symbol, interval, 72)
      setData(result.candles)
      setFooterExtra(result.footerExtra ?? null)
      setNote(result.note ?? null)
      setDegraded(Boolean(result.degraded))
      setLastRefresh(Date.now())
      setErr(null)
      setConnIssue(false)
      const last = result.candles[result.candles.length - 1]
      if (last) flashPrice(last.close)
    } catch (e) {
      // Never blank an already-rendered chart — show a reconnecting badge instead.
      if (dataRef.current.length > 0) {
        setConnIssue(true)
      } else {
        setErr(e instanceof Error ? e.message : 'Could not load candles')
        setRetryIn(Math.ceil(pollMs / 1000))
      }
    } finally {
      setLoading(false)
    }
  }, [symbol, interval, fetchCandles, pollMs, flashPrice])

  // Reset when switching tokens so the old chart doesn't linger.
  useEffect(() => {
    setData([])
    setErr(null)
    setConnIssue(false)
    setNote(null)
    setDegraded(false)
    setLivePrice(null)
    prevPriceRef.current = null
  }, [symbol])

  // Load candles once on mount or when symbol/interval changes — NO recurring HTTP polling!
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Retry countdown for the empty-error state.
  useEffect(() => {
    if (!err) return
    const id = window.setInterval(() => setRetryIn((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => window.clearInterval(id)
  }, [err])

  // Real-time candle updates: when parent drives referencePrice
  useEffect(() => {
    if (referencePrice == null || referencePrice <= 0) return
    setLivePrice(referencePrice)
    flashPrice(referencePrice)
    setData((prev) => {
      if (prev.length === 0) return prev
      const next = [...prev]
      const last = { ...next[next.length - 1]! }
      last.close = referencePrice
      last.high = Math.max(last.high, referencePrice)
      last.low = Math.min(last.low, referencePrice)
      next[next.length - 1] = last
      return next
    })
  }, [referencePrice, flashPrice])

  // Real-time price and candlestick updates directly via WebSocket (Socket.IO jupiter:ticker)
  useEffect(() => {
    if (!symbol) return
    const socket = connectSocket()

    const onTicker = (ticks: Array<{ symbol: string; lastPrice: number }>) => {
      if (!Array.isArray(ticks) || ticks.length === 0) return
      const match = ticks.find((t) => t.symbol === symbol)
      if (!match || match.lastPrice == null || match.lastPrice <= 0) return

      const p = match.lastPrice
      setLivePrice(p)
      flashPrice(p)

      setData((prev) => {
        if (prev.length === 0) return prev
        const next = [...prev]
        const last = { ...next[next.length - 1]! }
        last.close = p
        last.high = Math.max(last.high, p)
        last.low = Math.min(last.low, p)
        next[next.length - 1] = last
        return next
      })
    }

    socket.on('jupiter:ticker', onTicker)
    return () => {
      socket.off('jupiter:ticker', onTicker)
    }
  }, [symbol, flashPrice])

  const tradeMark = useMemo(() => {
    const mode = chartTrade?.markMode ?? 'ask'
    const ask = chartTrade?.buyPrice
    const bid = chartTrade?.sellPrice
    if (mode === 'bid' && bid != null && bid > 0) return bid
    if (mode === 'ask' && ask != null && ask > 0) return ask
    if (ask != null && bid != null && ask > 0 && bid > 0) return (ask + bid) / 2
    return null
  }, [chartTrade?.buyPrice, chartTrade?.sellPrice, chartTrade?.markMode])

  useEffect(() => () => {
    if (flashTimer.current) clearTimeout(flashTimer.current)
  }, [])

  const stats = useMemo(() => {
    if (data.length === 0) return null
    const highs = data.map((c) => c.high)
    const lows = data.map((c) => c.low)
    const first = data[0]!
    const last = data[data.length - 1]!
    const periodPct = first.open > 0 ? ((last.close - first.open) / first.open) * 100 : 0
    return {
      high: Math.max(...highs),
      low: Math.min(...lows),
      periodPct,
      last,
    }
  }, [data])

  const guidance = useMemo(() => buildGuidance(data, interval), [data, interval])

  const { min, max } = useMemo(() => {
    if (data.length === 0) return { min: 0, max: 1 }
    const lows = data.map((c) => c.low)
    const highs = data.map((c) => c.high)
    let minV = Math.min(...lows)
    let maxV = Math.max(...highs)
    for (const line of overlayLines) {
      if (line.price > 0) {
        minV = Math.min(minV, line.price)
        maxV = Math.max(maxV, line.price)
      }
    }
    const pad = (maxV - minV) * 0.08 || maxV * 0.01
    return { min: minV - pad, max: maxV + pad }
  }, [data, overlayLines])

  const maxVol = useMemo(() => Math.max(...data.map((c) => c.volume), 1), [data])

  const span = max - min || 1
  const chartW = 800
  const chartH = 480
  const volH = 48
  const priceH = chartH - volH
  const candleW = data.length > 0 ? chartW / data.length : 8

  const activeIdx = hoverIdx ?? data.length - 1
  const activeCandle = activeIdx >= 0 && activeIdx < data.length ? data[activeIdx] : null
  /** Chart headline: Binance mid when synced with order book; else Jupiter executable mark. */
  const lastClose =
    syncWithOrderBook && referencePrice != null && referencePrice > 0
      ? referencePrice
      : tradeMark ?? stats?.last.close ?? livePrice ?? null
  const markMode = chartTrade?.markMode ?? 'ask'
  const displayBuyPrice = lastClose ?? chartTrade?.buyPrice ?? livePrice ?? null
  const displaySellPrice = lastClose ?? chartTrade?.sellPrice ?? livePrice ?? null

  const guidanceStyles = {
    'buy-ok': 'border-emerald-500/30 bg-emerald-500/10 text-emerald-100',
    wait: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    caution: 'border-rose-500/30 bg-rose-500/10 text-rose-100',
  }

  const priceFlashCls =
    priceFlash === 'up'
      ? 'bg-emerald-500/20 text-emerald-300'
      : priceFlash === 'down'
        ? 'bg-rose-500/20 text-rose-300'
        : 'text-white'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0f]">
      <div className="flex shrink-0 flex-wrap items-start justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-sm font-semibold text-white">{pairLabel ?? symbol}</p>
            {connIssue ? (
              <span className="flex items-center gap-1 rounded-full border border-amber-500/40 bg-amber-500/10 px-2 py-0.5 text-[9px] font-medium text-amber-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
                reconnecting…
              </span>
            ) : (
              <span className="flex items-center gap-1 rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[9px] font-semibold tracking-wider text-emerald-300">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                LIVE
              </span>
            )}
          </div>
          {lastClose != null ? (
            <div className="mt-0.5 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
              <span
                className={`rounded px-1 font-mono text-lg tabular-nums transition-colors duration-500 ${priceFlashCls}`}
              >
                ${fmtPrice(lastClose)}
              </span>
              {chartTrade?.buyPrice != null &&
              chartTrade?.sellPrice != null &&
              chartTrade.buyPrice !== chartTrade.sellPrice ? (
                <span className="font-mono text-[11px] text-zinc-400">
                  <span className={markMode === 'ask' ? 'font-semibold text-emerald-300' : 'text-emerald-400/80'}>
                    Ask ${fmtPrice(chartTrade.buyPrice)}
                  </span>
                  <span className="mx-1 text-zinc-600">·</span>
                  <span className={markMode === 'bid' ? 'font-semibold text-rose-300' : 'text-rose-400/80'}>
                    Bid ${fmtPrice(chartTrade.sellPrice)}
                  </span>
                </span>
              ) : null}
              {stats ? (
                <>
                  <span
                    className={`font-mono text-sm font-medium ${
                      stats.periodPct >= 0 ? 'text-emerald-400' : 'text-rose-400'
                    }`}
                  >
                    {stats.periodPct >= 0 ? '+' : ''}
                    {stats.periodPct.toFixed(2)}% ({interval})
                  </span>
                  <span className="text-[10px] text-zinc-500">
                    H ${fmtPrice(stats.high)} · L ${fmtPrice(stats.low)}
                  </span>
                </>
              ) : null}
            </div>
          ) : (
            <p className="text-xs text-zinc-500">{loading ? 'Loading…' : '—'}</p>
          )}

        </div>
        <div className="flex flex-wrap gap-1 rounded-md border border-white/10 bg-white/5 p-0.5">
          {INTERVALS.map((iv) => (
            <button
              key={iv}
              type="button"
              onClick={() => setIntervalState(iv)}
              className={`rounded px-2 py-0.5 font-mono text-[11px] transition-colors ${
                iv === interval ? 'bg-violet-600/40 text-violet-100' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {iv}
            </button>
          ))}
        </div>
      </div>

      {note ? (
        <div className="mx-3 mt-2 shrink-0 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1 text-[10px] text-amber-200/90">
          {note}
        </div>
      ) : null}

      {activeCandle ? (
        <div className="mx-3 mt-2 flex shrink-0 flex-wrap gap-x-4 gap-y-1 rounded-md border border-white/5 bg-black/30 px-2.5 py-1.5 font-mono text-[10px] text-zinc-400">
          <span className="text-zinc-500">{fmtTime(activeCandle.openTime)}</span>
          <span>
            O <span className="text-zinc-200">{fmtPrice(activeCandle.open)}</span>
          </span>
          <span>
            H <span className="text-emerald-300">{fmtPrice(activeCandle.high)}</span>
          </span>
          <span>
            L <span className="text-rose-300">{fmtPrice(activeCandle.low)}</span>
          </span>
          <span>
            C{' '}
            <span className={activeCandle.close >= activeCandle.open ? 'text-emerald-300' : 'text-rose-300'}>
              {fmtPrice(activeCandle.close)}
            </span>
          </span>
          <span className={candleChangePct(activeCandle) >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
            {candleChangePct(activeCandle) >= 0 ? '+' : ''}
            {candleChangePct(activeCandle).toFixed(2)}%
          </span>
          {activeCandle.volume > 0 ? (
            <span>Vol {activeCandle.volume.toLocaleString(undefined, { maximumFractionDigits: 0 })}</span>
          ) : null}
        </div>
      ) : null}

      <div className={`relative mx-2 mt-2 min-h-[240px] flex-1 overflow-hidden rounded-lg border border-white/5 bg-black/40 p-1 ${chartTrade ? 'pt-14' : ''}`}>
        {chartTrade ? (
          <div className="absolute left-1/2 top-2 z-20 flex w-[min(100%,420px)] -translate-x-1/2 items-stretch gap-1 rounded-lg border border-white/15 bg-[#0b0b12]/95 p-1 shadow-lg backdrop-blur-sm">
            <button
              type="button"
              disabled={chartTrade.busy}
              onClick={chartTrade.onMarketBuy}
              className="min-w-[5.5rem] flex-1 rounded-md bg-emerald-600 px-2 py-1.5 text-left transition hover:bg-emerald-500 disabled:opacity-50"
            >
              <div className="text-[9px] font-semibold uppercase tracking-wide text-emerald-100">Market Buy</div>
              <div className="font-mono text-[11px] font-bold text-white">
                {displayBuyPrice != null ? fmtPrice(displayBuyPrice) : '—'}
              </div>
            </button>
            <div className="flex min-w-[7rem] flex-[1.2] flex-col justify-center rounded-md border border-white/10 bg-black/50 px-2 py-1">
              <label className="text-[9px] uppercase tracking-wide text-zinc-500">
                Amount ({chartTrade.baseSymbol === 'USDC' ? 'USDC' : chartTrade.baseSymbol})
              </label>
              <input
                value={chartTrade.amount}
                onChange={(e) => chartTrade.onAmountChange(e.target.value)}
                inputMode="decimal"
                placeholder="Enter amount"
                className="w-full bg-transparent font-mono text-sm text-white outline-none placeholder:text-zinc-600"
              />
            </div>
            <button
              type="button"
              disabled={chartTrade.busy}
              onClick={chartTrade.onMarketSell}
              className="min-w-[5.5rem] flex-1 rounded-md bg-rose-600 px-2 py-1.5 text-left transition hover:bg-rose-500 disabled:opacity-50"
            >
              <div className="text-[9px] font-semibold uppercase tracking-wide text-rose-100">Market Sell</div>
              <div className="font-mono text-[11px] font-bold text-white">
                {displaySellPrice != null ? fmtPrice(displaySellPrice) : '—'}
              </div>
            </button>
          </div>
        ) : null}
        {err && data.length === 0 ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-2 px-4 text-center">
            <p className="text-xs font-medium text-amber-300">Chart unavailable</p>
            <button
              type="button"
              onClick={() => void refresh()}
              className="rounded-md border border-violet-500/40 bg-violet-500/10 px-3 py-1 text-[11px] text-violet-200 transition-colors hover:bg-violet-500/20"
            >
              Retry now
            </button>
          </div>
        ) : degraded && data.length < 2 ? (
          <div className="flex h-full min-h-[180px] flex-col items-center justify-center gap-1.5 px-4 text-center">
            {livePrice != null ? (
              <span className={`rounded px-2 font-mono text-2xl tabular-nums transition-colors duration-500 ${priceFlashCls}`}>
                ${fmtPrice(livePrice)}
              </span>
            ) : null}
            <p className="text-[11px] text-zinc-500">
              Live Jupiter price streaming · candle history not available for this token yet
            </p>
          </div>
        ) : data.length < 2 ? (
          <p className="flex h-full min-h-[180px] items-center justify-center text-xs text-zinc-500">
            {loading ? 'Loading candles…' : 'No data'}
          </p>
        ) : (
          <svg
            viewBox={`0 0 ${chartW} ${chartH}`}
            preserveAspectRatio="none"
            className="block h-full min-h-[180px] w-full"
            onMouseLeave={() => setHoverIdx(null)}
          >
            {[0.25, 0.5, 0.75].map((f) => {
              const y = priceH * (1 - f)
              const price = min + span * f
              return (
                <g key={f}>
                  <line x1={0} y1={y} x2={chartW} y2={y} stroke="#ffffff0a" strokeDasharray="4 4" />
                  <text x={4} y={y - 2} fill="#71717a" fontSize={9}>
                    {fmtPrice(price)}
                  </text>
                </g>
              )
            })}

            {overlayLines.map((line) => {
              if (line.price <= 0) return null
              const y = priceH - ((line.price - min) / span) * priceH
              return (
                <g key={line.label}>
                  <line x1={0} y1={y} x2={chartW} y2={y} stroke={line.color} strokeWidth={1} strokeDasharray="6 4" opacity={0.85} />
                  <text x={chartW - 4} y={y - 3} fill={line.color} fontSize={9} textAnchor="end">
                    {line.label} {fmtPrice(line.price)}
                  </text>
                </g>
              )
            })}

            {/* Live last-price line — moves with every 4s tick like Binance. */}
            {lastClose != null && lastClose >= min && lastClose <= max ? (
              <g style={{ transition: 'transform 400ms ease-out' }}>
                <line
                  x1={0}
                  y1={priceH - ((lastClose - min) / span) * priceH}
                  x2={chartW}
                  y2={priceH - ((lastClose - min) / span) * priceH}
                  stroke={priceFlash === 'down' ? '#f87171' : '#34d399'}
                  strokeWidth={0.8}
                  strokeDasharray="2 3"
                  opacity={0.9}
                />
                <rect
                  x={chartW - 74}
                  y={priceH - ((lastClose - min) / span) * priceH - 7}
                  width={72}
                  height={13}
                  rx={2}
                  fill={priceFlash === 'down' ? '#7f1d1d' : '#064e3b'}
                  opacity={0.95}
                />
                <text
                  x={chartW - 38}
                  y={priceH - ((lastClose - min) / span) * priceH + 3}
                  fill="#fff"
                  fontSize={9}
                  textAnchor="middle"
                  fontFamily="monospace"
                >
                  {fmtPrice(lastClose)}
                </text>
              </g>
            ) : null}

            {data.map((c, i) => {
              const x = i * candleW + candleW / 2
              const yPrice = (v: number) => priceH - ((v - min) / span) * priceH
              const up = c.close >= c.open
              const color = up ? '#22c55e' : '#ef4444'
              const wickColor = up ? '#4ade80' : '#f87171'
              const bodyTop = yPrice(Math.max(c.open, c.close))
              const bodyBot = yPrice(Math.min(c.open, c.close))
              const bodyH = Math.max(2, bodyBot - bodyTop)
              const volBarH = (c.volume / maxVol) * (volH - 4)
              const isHover = hoverIdx === i
              const isLast = i === data.length - 1
              return (
                <g
                  key={c.openTime}
                  onMouseEnter={() => setHoverIdx(i)}
                  style={{ cursor: 'crosshair' }}
                >
                  <rect x={i * candleW} y={0} width={candleW} height={chartH} fill="transparent" />
                  <line x1={x} y1={yPrice(c.high)} x2={x} y2={yPrice(c.low)} stroke={wickColor} strokeWidth={1.6} />
                  <rect
                    x={x - candleW * 0.38}
                    y={bodyTop}
                    width={Math.max(2, candleW * 0.76)}
                    height={bodyH}
                    fill={up ? color : 'transparent'}
                    stroke={color}
                    strokeWidth={up ? 0 : 1.2}
                    opacity={isHover ? 1 : isLast ? 1 : 0.92}
                  >
                    {isLast ? (
                      <animate attributeName="opacity" values="0.98;0.7;0.98" dur="2s" repeatCount="indefinite" />
                    ) : null}
                  </rect>
                  <rect
                    x={x - candleW * 0.28}
                    y={priceH + volH - volBarH}
                    width={candleW * 0.56}
                    height={volBarH}
                    fill={up ? '#22c55e44' : '#ef444444'}
                  />
                </g>
              )
            })}
          </svg>
        )}
      </div>

      <div className="mt-auto flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-white/10 px-3 py-1.5 text-[10px] text-zinc-500">
        <span>
          {interval} · {(pollMs / 1000).toFixed(0)}s refresh
        </span>
        <span className="text-zinc-600">Updated {new Date(lastRefresh).toLocaleTimeString()}</span>
      </div>
    </div>
  )
}
