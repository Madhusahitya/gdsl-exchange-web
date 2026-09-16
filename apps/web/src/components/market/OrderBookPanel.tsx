'use client'

import { useCallback, useEffect, useState } from 'react'
import { engine } from '@/lib/api'

type DepthLevel = { price: number; qty: number }

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

type Props = {
  symbol: string
  /** Shown in the header — defaults to symbol. */
  label?: string
  /** Reference note under the header (e.g. "Binance spot depth for chart pair"). */
  hint?: string
  depth?: number
  className?: string
  showMarketTrades?: boolean
}

/**
 * Binance spot order book + recent prints. Jupiter pairs use the same
 * binanceSymbol for charting, so this gives a familiar CEX-style depth view.
 */
export function OrderBookPanel({
  symbol,
  label,
  hint,
  depth = 14,
  className = '',
  showMarketTrades = true,
}: Props) {
  const [bids, setBids] = useState<DepthLevel[]>([])
  const [asks, setAsks] = useState<DepthLevel[]>([])
  const [mid, setMid] = useState<number | null>(null)
  const [spreadBps, setSpreadBps] = useState<number | null>(null)
  const [trades, setTrades] = useState<
    Array<{ id: number; price: number; qty: number; time: number; isBuyerMaker: boolean }>
  >([])

  const refreshBook = useCallback(async () => {
    try {
      const d = await engine.orderBook(symbol, depth)
      setBids(d.bids.slice(0, depth))
      setAsks([...d.asks].slice(0, depth).reverse())
      setMid(d.mid)
      setSpreadBps(d.spreadBps)
    } catch {
      /* optional feed */
    }
  }, [symbol, depth])

  const refreshTrades = useCallback(async () => {
    if (!showMarketTrades) return
    try {
      const res = await fetch(
        `https://api.binance.com/api/v3/trades?symbol=${encodeURIComponent(symbol)}&limit=20`,
      )
      if (!res.ok) return
      const rows = (await res.json()) as Array<{
        id: number
        price: string
        qty: string
        time: number
        isBuyerMaker: boolean
      }>
      setTrades(
        rows.map((r) => ({
          id: r.id,
          price: Number(r.price),
          qty: Number(r.qty),
          time: r.time,
          isBuyerMaker: r.isBuyerMaker,
        })),
      )
    } catch {
      /* public feed optional */
    }
  }, [symbol, showMarketTrades])

  useEffect(() => {
    void refreshBook()
    void refreshTrades()
    const id = window.setInterval(() => {
      void refreshBook()
      void refreshTrades()
    }, 2_000)
    return () => window.clearInterval(id)
  }, [refreshBook, refreshTrades])

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
