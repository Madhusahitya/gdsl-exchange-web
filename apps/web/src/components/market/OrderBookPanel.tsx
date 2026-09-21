'use client'

import { useEffect } from 'react'
import { useCexMarketStream, type DepthLevel } from '@/hooks/useCexMarketStream'

function fmtPx(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(4)
  return n.toFixed(6)
}

function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toFixed(2)
  if (n >= 1) return n.toFixed(4)
  return n.toFixed(6)
}

export type CexPriceUpdate = {
  bestBid: number | null
  bestAsk: number | null
  mid: number | null
  spreadBps: number | null
}

type Props = {
  symbol: string
  /** Shown in the header — defaults to symbol. */
  label?: string
  /** Reference note under the header (e.g. "Binance spot depth for chart pair"). */
  hint?: string
  depth?: number
  className?: string
  showMarketTrades?: boolean
  onMidChange?: (mid: number | null, spreadBps: number | null) => void
  onPricesChange?: (prices: CexPriceUpdate) => void
}

/**
 * Binance spot order book + recent prints. Jupiter pairs use the same
 * binanceSymbol for charting, so this gives a familiar CEX-style depth view.
 * Streams real-time depth and trades over WebSocket with zero HTTP polling.
 */
export function OrderBookPanel({
  symbol,
  label,
  hint,
  depth = 14,
  className = '',
  showMarketTrades = true,
  onMidChange,
  onPricesChange,
}: Props) {
  const { bids, asks, bestBid, bestAsk, mid, spreadBps, trades } = useCexMarketStream(symbol, depth)

  useEffect(() => {
    onMidChange?.(mid, spreadBps)
    onPricesChange?.({ bestBid, bestAsk, mid, spreadBps })
  }, [bestBid, bestAsk, mid, spreadBps, onMidChange, onPricesChange])

  const maxAskQty = Math.max(...asks.map((a) => a.qty), 1e-9)
  const maxBidQty = Math.max(...bids.map((b) => b.qty), 1e-9)

  return (
    <div className={`flex max-h-[640px] flex-col gap-3 ${className}`}>
      <div className="flex min-h-0 flex-[1.4] flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0f]">
        <div className="border-b border-white/10 px-2 py-1.5">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">
            Order book · {label ?? symbol}
          </p>
          {hint ? <p className="mt-0.5 text-[9px] leading-snug text-zinc-600">{hint}</p> : null}
        </div>
        <div className="grid grid-cols-3 gap-1 px-2 py-1 text-[9px] text-zinc-600">
          <span>Price</span>
          <span className="text-right">Amount</span>
          <span className="text-right">Total</span>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-1">
          {asks.map((a) => (
            <div key={`a-${a.price}`} className="relative grid grid-cols-3 gap-1 px-1 py-0.5 font-mono text-[10px]">
              <div
                className="absolute inset-y-0 right-0 bg-rose-500/10"
                style={{ width: `${Math.min(100, (a.qty / maxAskQty) * 100)}%` }}
              />
              <span className="relative text-rose-300">{fmtPx(a.price)}</span>
              <span className="relative text-right text-zinc-400">{fmtQty(a.qty)}</span>
              <span className="relative text-right text-zinc-600">{fmtQty(a.price * a.qty)}</span>
            </div>
          ))}
          <div className="my-1 border-y border-white/10 py-1 text-center font-mono text-xs text-emerald-300">
            {mid != null ? fmtPx(mid) : '—'}
            {spreadBps != null ? (
              <span className="ml-1 text-[9px] text-zinc-500">{spreadBps.toFixed(1)} bps</span>
            ) : null}
          </div>
          {bids.map((b) => (
            <div key={`b-${b.price}`} className="relative grid grid-cols-3 gap-1 px-1 py-0.5 font-mono text-[10px]">
              <div
                className="absolute inset-y-0 right-0 bg-emerald-500/10"
                style={{ width: `${Math.min(100, (b.qty / maxBidQty) * 100)}%` }}
              />
              <span className="relative text-emerald-300">{fmtPx(b.price)}</span>
              <span className="relative text-right text-zinc-400">{fmtQty(b.qty)}</span>
              <span className="relative text-right text-zinc-600">{fmtPx(b.price * b.qty)}</span>
            </div>
          ))}
        </div>
      </div>

      {showMarketTrades ? (
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-white/10 bg-[#0a0a0f]">
          <div className="border-b border-white/10 px-2 py-1.5 text-[10px] uppercase tracking-wide text-zinc-500">
            Market trades
          </div>
          <div className="grid grid-cols-3 gap-1 px-2 py-1 text-[9px] text-zinc-600">
            <span>Price</span>
            <span className="text-right">Amount</span>
            <span className="text-right">Time</span>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1">
            {trades.map((t) => (
              <div key={t.id} className="grid grid-cols-3 gap-1 px-1 py-0.5 font-mono text-[10px]">
                <span className={t.isBuyerMaker ? 'text-rose-300' : 'text-emerald-300'}>
                  {fmtPx(t.price)}
                </span>
                <span className="text-right text-zinc-400">{fmtQty(t.qty)}</span>
                <span className="text-right text-zinc-600">
                  {new Date(t.time).toLocaleTimeString([], { hour12: false })}
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}
