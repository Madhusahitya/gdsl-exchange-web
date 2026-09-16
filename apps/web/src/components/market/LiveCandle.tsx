'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { candles, type LiveCandle as Candle } from '@/lib/api'

const INTERVALS = ['1m', '5m', '15m', '1h', '4h', '1d'] as const
type Interval = (typeof INTERVALS)[number]

type Props = {
  /** Binance symbol to track, e.g. "BTCUSDT". */
  symbol: string
  /** Default interval. */
  defaultInterval?: Interval
  /** Polling interval for the latest candle in ms. Defaults to 5s. */
  pollMs?: number
  /** Optional pretty pair label like "BTC/USDT". */
  pairLabel?: string
}

function fmtPrice(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (value >= 1) return value.toFixed(2)
  return value.toFixed(6)
}

function fmtPct(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function fmtVolume(value: number, asset: string): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1e6) return `${(value / 1e6).toFixed(2)}M ${asset}`
  if (value >= 1e3) return `${(value / 1e3).toFixed(2)}K ${asset}`
  return `${value.toFixed(2)} ${asset}`
}

export function LiveCandle({ symbol, defaultInterval = '1m', pollMs = 5_000, pairLabel }: Props) {
  const [interval, setIntervalState] = useState<Interval>(defaultInterval)
  const [data, setData] = useState<Candle[]>([])
  const [updatedAt, setUpdatedAt] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!symbol) return
    setLoading(true)
    setErr(null)
    try {
      const result = await candles.fetch(symbol, interval, 60)
      setData(result.candles)
      setUpdatedAt(result.updatedAt)
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not load candles')
    } finally {
      setLoading(false)
    }
  }, [symbol, interval])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), pollMs)
    return () => window.clearInterval(id)
  }, [refresh, pollMs])

  const last = data[data.length - 1]
  const prev = data[data.length - 2]
  const changePct =
    last && prev && prev.close > 0 ? ((last.close - prev.close) / prev.close) * 100 : null

  const closes = data.map((c) => c.close)
  const min = closes.length ? Math.min(...closes) : 0
  const max = closes.length ? Math.max(...closes) : 0

  const baseAsset = symbol.replace(/USDT|USDC|BUSD|FDUSD$/, '')

  return (
    <Card className="border-white/10 bg-[#0a0a0f]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle className="text-base font-medium text-white">
            Live candles · {pairLabel ?? symbol}
          </CardTitle>
          <div className="flex items-center gap-1 rounded-md border border-white/10 bg-white/5 p-0.5">
            {INTERVALS.map((iv) => (
              <button
                type="button"
                key={iv}
                onClick={() => setIntervalState(iv)}
                className={`px-2 py-0.5 text-[11px] font-mono ${
                  iv === interval
                    ? 'rounded bg-emerald-500/20 text-emerald-200'
                    : 'text-zinc-400 hover:text-white'
                }`}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>
        <p className="text-[11px] text-zinc-500">
          Streaming from Binance public klines · updates every {(pollMs / 1000).toFixed(0)}s
          {updatedAt ? ` · last sync ${new Date(updatedAt).toLocaleTimeString()}` : ''}
        </p>
      </CardHeader>
      <CardContent className="space-y-3">
        {err ? <p className="text-xs text-amber-300">{err}</p> : null}
        {!last ? (
          <p className="text-xs text-zinc-500">{loading ? 'Loading…' : 'No data'}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Metric label="Last" value={`$${fmtPrice(last.close)}`} />
              <Metric
                label={`Δ vs prev ${interval}`}
                value={changePct !== null ? fmtPct(changePct) : '—'}
                valueClass={
                  changePct !== null
                    ? changePct >= 0
                      ? 'text-emerald-400'
                      : 'text-rose-400'
                    : 'text-zinc-200'
                }
              />
              <Metric label="High" value={`$${fmtPrice(last.high)}`} />
              <Metric label="Low" value={`$${fmtPrice(last.low)}`} />
              <Metric label="Open" value={`$${fmtPrice(last.open)}`} />
              <Metric label="Volume" value={fmtVolume(last.volume, baseAsset)} />
              <Metric
                label={`Range (last ${data.length} ${interval})`}
                value={`$${fmtPrice(min)} – $${fmtPrice(max)}`}
              />
              <Metric
                label="Open time"
                value={new Date(last.openTime).toLocaleTimeString()}
              />
            </div>
            <Sparkline values={closes} positive={(changePct ?? 0) >= 0} />
          </>
        )}
      </CardContent>
    </Card>
  )
}

function Metric({
  label,
  value,
  valueClass = 'text-white',
}: {
  label: string
  value: string
  valueClass?: string
}) {
  return (
    <div className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className={`mt-0.5 font-mono text-sm ${valueClass}`}>{value}</p>
    </div>
  )
}

function Sparkline({ values, positive }: { values: number[]; positive: boolean }) {
  if (values.length < 2) return null
  const min = Math.min(...values)
  const max = Math.max(...values)
  const span = max - min || 1
  const width = 480
  const height = 56
  const stepX = width / (values.length - 1)
  const points = values
    .map((v, idx) => {
      const x = idx * stepX
      const y = height - ((v - min) / span) * height
      return `${x.toFixed(2)},${y.toFixed(2)}`
    })
    .join(' ')
  const stroke = positive ? '#34d399' : '#f87171'
  return (
    <div className="rounded-md border border-white/10 bg-black/40 p-3">
      <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full">
        <polyline fill="none" stroke={stroke} strokeWidth={1.5} points={points} />
      </svg>
    </div>
  )
}
