'use client'

/**
 * Solana × Jupiter markets overview — Binance Markets-style Hot / Gainers / Volume cards
 * + full coin table. Prices flash on update like a live terminal.
 * Real-time updates via Socket.IO push (no polling).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { type MarketBoardRow } from '@/lib/api'
import { cn } from '@/lib/utils'
import { useOverviewSocket } from '@/hooks/useOverviewSocket'

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

function fmtVol(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (v >= 1e9) return `$${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `$${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `$${(v / 1e3).toFixed(1)}K`
  return `$${v.toFixed(0)}`
}

function pairLabel(sym: string): string {
  return `${sym.replace(/USDT$/i, '')}/USDT`
}

function FlashPrice({ value, className }: { value: number; className?: string }) {
  const prev = useRef(value)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  useEffect(() => {
    if (prev.current === value) return
    setFlash(value > prev.current ? 'up' : 'down')
    prev.current = value
    const t = setTimeout(() => setFlash(null), 700)
    return () => clearTimeout(t)
  }, [value])
  return (
    <span
      className={cn(
        'rounded px-0.5 font-mono transition-colors duration-500',
        flash === 'up' && 'bg-emerald-500/20 text-emerald-300',
        flash === 'down' && 'bg-rose-500/20 text-rose-300',
        className,
      )}
    >
      ${fmtPrice(value)}
    </span>
  )
}

function HighlightCard({
  title,
  rows,
  onSelect,
}: {
  title: string
  rows: MarketBoardRow[]
  onSelect: (sym: string) => void
}) {
  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0f] p-3">
      <div className="flex items-center justify-between">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-zinc-400">{title}</h3>
        <Link href="/dex-jupiter" className="text-[10px] text-emerald-400/80 hover:text-emerald-300">
          More ›
        </Link>
      </div>
      <ul className="mt-2 space-y-1">
        {rows.slice(0, 5).map((r) => (
          <li key={r.symbol}>
            <button
              type="button"
              onClick={() => onSelect(r.symbol)}
              className="flex w-full items-center justify-between rounded-lg px-2 py-1.5 text-left hover:bg-white/5"
            >
              <span className="flex items-center gap-2">
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/20 text-[10px] font-bold text-violet-200">
                  {r.symbol.replace(/USDT$/i, '').slice(0, 2)}
                </span>
                <span className="text-sm font-medium text-white">{pairLabel(r.symbol)}</span>
              </span>
              <span className="text-right">
                <FlashPrice value={r.lastPrice} className="block text-xs text-zinc-200" />
                <span
                  className={`text-[11px] ${r.priceChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                >
                  {fmtPct(r.priceChangePercent)}
                </span>
              </span>
            </button>
          </li>
        ))}
        {rows.length === 0 ? <li className="px-2 py-3 text-[11px] text-zinc-600">Loading…</li> : null}
      </ul>
    </div>
  )
}

export default function OverviewPage() {
  const { rows, highlights, totalPairs, updatedAt, loading, connected, refresh } =
    useOverviewSocket()
  const [search, setSearch] = useState('')
  const [tag, setTag] = useState<'all' | 'sol' | 'meme' | 'majors'>('all')

  const topVolume = useMemo(
    () => [...rows].sort((a, b) => b.quoteVolume - a.quoteVolume).slice(0, 5),
    [rows],
  )

  const filtered = useMemo(() => {
    let list = rows
    if (tag === 'sol') list = list.filter((r) => /SOL|JUP|BONK|WIF|RAY|ORCA/i.test(r.symbol))
    if (tag === 'meme') list = list.filter((r) => /BONK|WIF|POPCAT|MEW|PNUT|GOAT|FART/i.test(r.symbol))
    if (tag === 'majors') list = list.filter((r) => /^(SOL|BTC|ETH|JUP|RAY|ORCA)USDT$/i.test(r.symbol))
    const q = search.trim().toLowerCase()
    if (q) list = list.filter((r) => r.symbol.toLowerCase().includes(q))
    return list
  }, [rows, search, tag])

  const goTrade = (sym: string) => {
    window.location.href = `/dex-jupiter?symbol=${encodeURIComponent(sym)}`
  }

  return (
    <div className="space-y-4 p-4 sm:p-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold text-white">Overview</h1>
        </div>
        <p className="text-xs text-zinc-500">
          {totalPairs > 0 ? `${totalPairs} Solana pairs` : '—'}
          {updatedAt ? ` · ${new Date(updatedAt).toLocaleTimeString()}` : ''}
          <span className={`ml-2 inline-flex items-center gap-1 ${connected ? 'text-emerald-400/80' : 'text-amber-400/80'}`}>
            <span className={`h-1.5 w-1.5 rounded-full ${connected ? 'animate-pulse bg-emerald-400' : 'bg-amber-400'}`} />
            {connected ? 'live' : 'reconnecting…'}
          </span>
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <HighlightCard title="Hot · volume" rows={highlights.hot} onSelect={goTrade} />
        <HighlightCard title="Top gainers" rows={highlights.topGainers} onSelect={goTrade} />
        <HighlightCard title="Top volume" rows={topVolume} onSelect={goTrade} />
      </div>

      <div className="rounded-xl border border-white/10 bg-[#0a0a0f]">
        <div className="flex flex-wrap items-center gap-2 border-b border-white/10 p-3">
          {(
            [
              ['all', 'All'],
              ['majors', 'Majors'],
              ['sol', 'Solana'],
              ['meme', 'Meme'],
            ] as const
          ).map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTag(id)}
              className={cn(
                'rounded-full px-3 py-1 text-[11px] font-medium',
                tag === id ? 'bg-amber-500 text-black' : 'bg-white/5 text-zinc-400 hover:bg-white/10',
              )}
            >
              {label}
            </button>
          ))}
          <input
            type="search"
            placeholder="Search Solana coins…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="min-w-[180px] flex-1 rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white placeholder:text-zinc-500"
          />
          <button
            type="button"
            onClick={() => void refresh()}
            className="rounded-lg border border-white/10 px-3 py-2 text-xs text-zinc-300 hover:bg-white/5"
          >
            Refresh
          </button>
        </div>
        <div className="max-h-[min(70vh,720px)] overflow-auto">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 z-10 bg-[#0d0d12] text-[11px] uppercase tracking-wide text-zinc-500">
              <tr>
                <th className="px-3 py-2">Name</th>
                <th className="px-3 py-2 text-right">Price</th>
                <th className="px-3 py-2 text-right">24h Change</th>
                <th className="px-3 py-2 text-right">24h Volume</th>
                <th className="px-3 py-2 text-right">Trade</th>
              </tr>
            </thead>
            <tbody>
              {loading && filtered.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-3 py-8 text-center text-zinc-500">
                    Loading Jupiter markets…
                  </td>
                </tr>
              ) : null}
              {filtered.map((r) => (
                <tr key={r.symbol} className="border-t border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <span className="flex h-7 w-7 items-center justify-center rounded-full bg-violet-500/15 text-[10px] font-bold text-violet-200">
                        {r.symbol.replace(/USDT$/i, '').slice(0, 3)}
                      </span>
                      <div>
                        <div className="font-medium text-white">{r.symbol.replace(/USDT$/i, '')}</div>
                        <div className="text-[10px] text-zinc-500">{pairLabel(r.symbol)}</div>
                      </div>
                    </div>
                  </td>
                  <td className="px-3 py-2 text-right">
                    <FlashPrice value={r.lastPrice} className="text-zinc-100" />
                  </td>
                  <td
                    className={`px-3 py-2 text-right font-mono ${r.priceChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                  >
                    {fmtPct(r.priceChangePercent)}
                  </td>
                  <td className="px-3 py-2 text-right font-mono text-zinc-400">{fmtVol(r.quoteVolume)}</td>
                  <td className="px-3 py-2 text-right">
                    <Link
                      href={`/dex-jupiter?symbol=${encodeURIComponent(r.symbol)}`}
                      className="inline-flex rounded-md bg-amber-500/90 px-2.5 py-1 text-xs font-semibold text-black hover:bg-amber-400"
                    >
                      Trade
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}
