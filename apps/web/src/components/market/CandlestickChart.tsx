'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { candles, type LiveCandle } from '@/lib/api'

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const
type Interval = (typeof INTERVALS)[number]

type Props = {
  symbol: string
  pairLabel?: string
  defaultInterval?: Interval
  pollMs?: number
  /** Custom candle fetcher (e.g. Jupiter live on Solana). Defaults to Binance klines. */
  fetchCandles?: (
    symbol: string,
    interval: Interval,
    limit: number,
  ) => Promise<{ candles: LiveCandle[]; footerExtra?: string }>
  footerLabel?: string
}

function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (value >= 1) return value.toFixed(4)
  return value.toPrecision(6)
}

export function CandlestickChart({
  symbol,
  pairLabel,
  defaultInterval = '15m',
  pollMs = 4_000,
  fetchCandles,
  footerLabel,
}: Props) {
  const [interval, setIntervalState] = useState<Interval>(defaultInterval)
  const [data, setData] = useState<LiveCandle[]>([])
  const [footerExtra, setFooterExtra] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    setErr(null)
    try {
      if (fetchCandles) {
        const result = await fetchCandles(symbol, interval, 72)
        setData(result.candles)
        setFooterExtra(result.footerExtra ?? null)
      } else {
        const result = await candles.fetch(symbol, interval, 72)
        setData(result.candles)
        setFooterExtra(null)
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load candles')
    } finally {
      setLoading(false)
    }
  }, [symbol, interval, fetchCandles])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), pollMs)
    return () => window.clearInterval(id)
  }, [refresh, pollMs])

  const { min, max } = useMemo(() => {
    if (data.length === 0) return { min: 0, max: 1 }
    const lows = data.map((c) => c.low)
    const highs = data.map((c) => c.high)
    const minV = Math.min(...lows)
    const maxV = Math.max(...highs)
    const pad = (maxV - minV) * 0.06 || maxV * 0.01
    return { min: minV - pad, max: maxV + pad }
  }, [data])

  const last = data[data.length - 1]
  const prev = data[data.length - 2]
  const tickChange =
    last && prev && prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : null

  const span = max - min || 1
  const chartW = 640
  const chartH = 280
  const candleW = data.length > 0 ? chartW / data.length : 8

  return (
    <div className="flex h-full min-h-0 flex-col rounded-xl border border-white/10 bg-[#0a0a0f]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-white/10 px-3 py-2">
        <div>
          <p className="text-sm font-semibold text-white">{pairLabel ?? symbol}</p>
          {last ? (
            <p className="font-mono text-lg text-white">
              ${fmtPrice(last.close)}
              {tickChange !== null ? (
                <span
                  className={`ml-2 text-sm ${tickChange >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                >
                  {tickChange >= 0 ? '+' : ''}
                  {tickChange.toFixed(2)}%
                </span>
              ) : null}
            </p>
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
              className={`rounded px-2 py-0.5 font-mono text-[11px] ${
                iv === interval ? 'bg-emerald-500/25 text-emerald-200' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {iv}
            </button>
          ))}
        </div>
      </div>

      <div className="relative flex-1 overflow-hidden p-2">
        {err ? (
          <p className="flex h-full items-center justify-center text-xs text-amber-300">{err}</p>
        ) : data.length < 2 ? (
          <p className="flex h-full items-center justify-center text-xs text-zinc-500">
            {loading ? 'Loading candles…' : 'No data'}
          </p>
        ) : (
          <svg viewBox={`0 0 ${chartW} ${chartH}`} className="h-full w-full min-h-[220px]">
            {[0.25, 0.5, 0.75].map((f) => {
              const y = chartH * (1 - f)
              const price = min + span * f
              return (
                <g key={f}>
                  <line x1={0} y1={y} x2={chartW} y2={y} stroke="#ffffff08" />
                  <text x={4} y={y - 2} fill="#52525b" fontSize={9}>
                    {fmtPrice(price)}
                  </text>
                </g>
              )
            })}
            {data.map((c, i) => {
              const x = i * candleW + candleW / 2
              const y = (v: number) => chartH - ((v - min) / span) * chartH
              const up = c.close >= c.open
              const color = up ? '#34d399' : '#f87171'
              const bodyTop = y(Math.max(c.open, c.close))
              const bodyBot = y(Math.min(c.open, c.close))
              const bodyH = Math.max(1, bodyBot - bodyTop)
              return (
                <g key={c.openTime}>
                  <line x1={x} y1={y(c.high)} x2={x} y2={y(c.low)} stroke={color} strokeWidth={1} />
                  <rect
                    x={x - candleW * 0.32}
                    y={bodyTop}
                    width={candleW * 0.64}
                    height={bodyH}
                    fill={color}
                    opacity={0.85}
                  />
                </g>
              )
            })}
          </svg>
        )}
      </div>
      <p className="border-t border-white/10 px-3 py-1.5 text-[10px] text-zinc-500">
        {footerLabel ?? 'Live scanner · Binance klines'} · {(pollMs / 1000).toFixed(0)}s refresh · {interval}
        {footerExtra ? ` · ${footerExtra}` : ''}
      </p>
    </div>
  )
}
