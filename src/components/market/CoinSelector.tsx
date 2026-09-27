'use client'

import { useEffect, useState } from 'react'
import { market } from '@/lib/api'

export type CoinSelectorOption = {
  /** Trading pair key used by callers, e.g. "BTC/USDT". */
  pairKey: string
  /** Binance symbol (e.g. "BTCUSDT") used for live ticker lookups. */
  binanceSymbol: string
  /** Human-friendly display label, e.g. "Bitcoin". */
  label: string
  /** Optional emoji / glyph fallback if no logo. */
  glyph?: string
  /** Optional remote logo URL. */
  logo?: string
}

type Props = {
  options: CoinSelectorOption[]
  value: string
  onChange: (pairKey: string) => void
  /** Polling interval for ticker refresh. */
  pollMs?: number
  /** Smaller variant used inside cards. */
  compact?: boolean
}

type MarketRow = {
  pair: string
  symbol: string
  lastPrice: number
  changePercent24h: number
}

function formatPrice(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '—'
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (value >= 1) return value.toFixed(2)
  return value.toFixed(6)
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

export function CoinSelector({ options, value, onChange, compact = false }: Props) {
  const [rows, setRows] = useState<Record<string, MarketRow>>({})

  // 1. Initial snapshot on mount
  useEffect(() => {
    let cancelled = false
    market.overview().then((data) => {
      if (cancelled) return
      const byPair: Record<string, MarketRow> = {}
      for (const r of data.rows ?? []) {
        byPair[r.pair] = {
          pair: r.pair,
          symbol: r.symbol,
          lastPrice: Number(r.lastPrice ?? 0),
          changePercent24h: Number(r.changePercent24h ?? 0),
        }
      }
      setRows(byPair)
    }).catch(() => {
      // best-effort snapshot
    })
    return () => {
      cancelled = true
    }
  }, [])

  // 2. Real-time WebSocket stream for all coin selector symbols
  useEffect(() => {
    if (typeof window === 'undefined' || options.length === 0) return

    let isDisposed = false
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null

    const validSymbols = Array.from(
      new Set(
        options
          .map((o) => o.binanceSymbol.toLowerCase().replace('/', ''))
          .filter((s) => s.length > 0),
      ),
    )
    if (validSymbols.length === 0) return

    const streams = validSymbols.map((s) => `${s}@miniTicker`).join('/')
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`

    const connect = () => {
      if (isDisposed) return
      try {
        ws = new WebSocket(url)

        ws.onmessage = (event) => {
          if (isDisposed) return
          try {
            const message = JSON.parse(event.data) as {
              data?: {
                s?: string
                c?: string
                o?: string
              }
            }
            const item = message.data
            if (!item?.s || !item.c) return
            const s = item.s
            const close = Number(item.c)
            const open = Number(item.o ?? 0)
            const change = open > 0 ? ((close - open) / open) * 100 : 0

            setRows((prev) => {
              const existing = prev[s]
              if (existing && existing.lastPrice === close && existing.changePercent24h === change) {
                return prev
              }
              return {
                ...prev,
                [s]: {
                  pair: s,
                  symbol: s,
                  lastPrice: close,
                  changePercent24h: change,
                },
              }
            })
          } catch {
            /* ignore */
          }
        }

        ws.onclose = () => {
          ws = null
          if (!isDisposed) {
            reconnectTimer = setTimeout(connect, 3_000)
          }
        }

        ws.onerror = () => {
          ws?.close()
        }
      } catch {
        if (!isDisposed) {
          reconnectTimer = setTimeout(connect, 5_000)
        }
      }
    }

    connect()

    return () => {
      isDisposed = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) {
        ws.close()
        ws = null
      }
    }
  }, [options])

  return (
    <div
      className={`grid gap-2 ${
        compact
          ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4'
          : 'grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7'
      }`}
    >
      {options.map((opt) => {
        const row = rows[opt.binanceSymbol]
        const change = row?.changePercent24h ?? 0
        const positive = change >= 0
        const isActive = value === opt.pairKey
        return (
          <button
            key={opt.pairKey}
            onClick={() => onChange(opt.pairKey)}
            type="button"
            className={`group flex flex-col items-start gap-1.5 rounded-xl border px-3 py-3 text-left transition ${
              isActive
                ? 'border-emerald-500/50 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(16,185,129,0.4)]'
                : 'border-white/10 bg-white/[0.02] hover:border-white/20 hover:bg-white/[0.04]'
            }`}
          >
            <div className="flex w-full items-center gap-2">
              {opt.logo ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={opt.logo}
                  alt={opt.label}
                  width={20}
                  height={20}
                  className="h-5 w-5 rounded-full bg-white/5"
                  loading="lazy"
                  onError={(e) => {
                    e.currentTarget.style.display = 'none'
                  }}
                />
              ) : (
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-white/5 text-[10px] font-mono text-zinc-200">
                  {opt.glyph ?? opt.label.slice(0, 1)}
                </span>
              )}
              <span className="flex-1 text-xs font-medium text-white">{opt.pairKey}</span>
              <span
                className={`text-[10px] font-mono ${positive ? 'text-emerald-400' : 'text-rose-400'}`}
              >
                {row ? formatPct(change) : '—'}
              </span>
            </div>
            <div className="flex w-full items-center justify-between gap-2">
              <span className="text-[10px] text-zinc-500">{opt.label}</span>
              <span className="text-xs font-mono text-zinc-200">
                {row ? `$${formatPrice(row.lastPrice)}` : '—'}
              </span>
            </div>
          </button>
        )
      })}
    </div>
  )
}
