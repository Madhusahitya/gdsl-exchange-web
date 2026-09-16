'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { dexJupiter, type JupiterDepthLevel } from '@/lib/api'
import { usePageVisible } from '@/hooks/usePageVisible'

function fmtPx(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(4)
  return n.toFixed(6)
}

function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`
  if (n >= 1000) return `${(n / 1000).toFixed(2)}K`
  if (n >= 1) return n.toFixed(3)
  return n.toFixed(6)
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return `$${(n / 1000).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

type LevelRow = JupiterDepthLevel & { cumQty: number; cumUsd: number }

function withCumulative(levels: JupiterDepthLevel[], side: 'bid' | 'ask'): LevelRow[] {
  let cumQty = 0
  let cumUsd = 0
  const ordered = side === 'bid' ? [...levels].sort((a, b) => b.price - a.price) : [...levels].sort((a, b) => a.price - b.price)
  return ordered.map((l) => {
    cumQty += l.qty
    cumUsd += l.notionalUsd
    return { ...l, cumQty, cumUsd }
  })
}

type Props = {
  symbol: string
  label?: string
  depth?: number
  className?: string
  pollMs?: number
}

export function JupiterOrderBookPanel({
  symbol,
  label,
  depth = 12,
  className = '',
  pollMs = 2_000,
}: Props) {
  const [bids, setBids] = useState<JupiterDepthLevel[]>([])
  const [asks, setAsks] = useState<JupiterDepthLevel[]>([])
  const [mid, setMid] = useState<number | null>(null)
  const [bid, setBid] = useState<number | null>(null)
  const [ask, setAsk] = useState<number | null>(null)
  const [spreadBps, setSpreadBps] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const visible = usePageVisible()

  const refresh = useCallback(async () => {
    if (!symbol) return
    try {
      const d = await dexJupiter.depth(symbol, depth)
      setBids(d.bids.slice(0, depth))
      setAsks(d.asks.slice(0, depth))
      setMid(d.mid)
      setBid(d.bid)
      setAsk(d.ask)
      setSpreadBps(d.spreadBps)
    } catch {
      /* keep last good book */
    } finally {
      setLoading(false)
    }
  }, [symbol, depth])

  useEffect(() => {
    setLoading(true)
    void refresh()
    if (!symbol || !visible) return
    const id = window.setInterval(() => void refresh(), pollMs)
    return () => window.clearInterval(id)
  }, [refresh, symbol, pollMs, visible])

  const bidRows = useMemo(() => withCumulative(bids, 'bid'), [bids])
  const askRows = useMemo(() => withCumulative(asks, 'ask'), [asks])
  const maxCumUsd = Math.max(...bidRows.map((b) => b.cumUsd), ...askRows.map((a) => a.cumUsd), 1)

  return (
    <div
      className={`flex min-h-0 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#050508] ${className}`}
    >
      <div className="border-b border-white/10 px-3 py-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs font-semibold text-white">{label ?? symbol}</p>
        </div>
        <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5 font-mono text-[10px] tabular-nums">
          {bid != null ? (
            <span>
              <span className="text-zinc-500">Bid </span>
              <span className="text-emerald-400">${fmtPx(bid)}</span>
            </span>
          ) : null}
          {ask != null ? (
            <span>
              <span className="text-zinc-500">Ask </span>
              <span className="text-rose-400">${fmtPx(ask)}</span>
            </span>
          ) : null}
          {mid != null ? (
            <span className="text-zinc-300">${fmtPx(mid)} mid</span>
          ) : null}
          {spreadBps != null ? (
            <span className="text-zinc-500">{(spreadBps / 100).toFixed(2)}% spread</span>
          ) : null}
        </div>
        <p className="mt-0.5 text-[9px] text-zinc-600">
          {loading && bids.length === 0 ? 'Loading Jupiter depth…' : 'Live · refreshes every 2s'}
        </p>
      </div>

      <div className="grid shrink-0 grid-cols-[1fr_1fr_1fr] gap-1 border-b border-white/5 px-2 py-1 text-[9px] uppercase tracking-wide text-zinc-600">
        <span>Price</span>
        <span className="text-right">Size</span>
        <span className="text-right">Total</span>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto text-[10px]">
        {/* Asks — lowest at bottom near mid */}
        <div className="flex flex-col-reverse">
          {askRows.length === 0 ? (
            <p className="px-2 py-2 text-zinc-600">No ask quotes yet</p>
          ) : (
            askRows.map((a, i) => (
              <div key={`a-${i}`} className="relative grid grid-cols-[1fr_1fr_1fr] px-2 py-0.5 font-mono tabular-nums">
                <div
                  className="absolute inset-y-0 right-0 bg-rose-500/8"
                  style={{ width: `${Math.min(100, (a.cumUsd / maxCumUsd) * 100)}%` }}
                />
                <span className="relative z-10 text-rose-400">{fmtPx(a.price)}</span>
                <span className="relative z-10 text-right text-zinc-400">{fmtQty(a.qty)}</span>
                <span className="relative z-10 text-right text-zinc-500">{fmtUsd(a.cumUsd)}</span>
              </div>
            ))
          )}
        </div>

        <div className="sticky z-10 border-y border-white/10 bg-[#0a0a12] px-2 py-1 text-center font-mono text-[11px] text-zinc-200">
          {mid != null ? fmtPx(mid) : '—'}
        </div>

        {bidRows.length === 0 ? (
          <p className="px-2 py-2 text-zinc-600">No bid quotes yet</p>
        ) : (
          bidRows.map((b, i) => (
            <div key={`b-${i}`} className="relative grid grid-cols-[1fr_1fr_1fr] px-2 py-0.5 font-mono tabular-nums">
              <div
                className="absolute inset-y-0 right-0 bg-emerald-500/8"
                style={{ width: `${Math.min(100, (b.cumUsd / maxCumUsd) * 100)}%` }}
              />
              <span className="relative z-10 text-emerald-400">{fmtPx(b.price)}</span>
              <span className="relative z-10 text-right text-zinc-400">{fmtQty(b.qty)}</span>
              <span className="relative z-10 text-right text-zinc-500">{fmtUsd(b.cumUsd)}</span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}
