'use client'

import { type MarketBoardRow } from '@/lib/api'
import { useJupiterMarks } from '@/hooks/useJupiterMarks'

function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return '—'
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (p >= 1) return p.toFixed(4)
  return p.toPrecision(6)
}

function fmtUsdCompact(n: number): string {
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`
  return `$${n.toFixed(0)}`
}

type Props = {
  symbol: string
  row: MarketBoardRow | null
}

export function JupiterTokenHeader({ symbol, row }: Props) {
  const base = symbol.replace(/USDT$/i, '')
  const marks = useJupiterMarks(symbol, 800)
  const live = marks?.mid ?? row?.lastPrice ?? null
  const chg = row?.priceChangePercent ?? 0

  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-white/10 bg-[#0a0a0f] px-3 py-2">
      <div className="flex items-center gap-2">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-violet-600/40 to-emerald-600/30 text-xs font-bold text-white">
          {base.slice(0, 2)}
        </div>
        <div>
          <p className="text-sm font-semibold text-white">{base}</p>
          <p className="text-[10px] text-zinc-500">Solana · Jupiter</p>
        </div>
      </div>

      {live != null ? (
        <div>
          <p className="font-mono text-lg tabular-nums text-white">${fmtPrice(live)}</p>
          <p className={`text-[11px] font-medium ${chg >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
            {chg >= 0 ? '+' : ''}
            {chg.toFixed(2)}% 24h
          </p>
        </div>
      ) : null}

      <div className="flex flex-wrap gap-3 text-[10px] text-zinc-500">
        {marks?.bid != null && marks?.ask != null ? (
          <span className="font-mono tabular-nums">
            Ask <span className="text-rose-400">${fmtPrice(marks.ask)}</span>
            {' · '}
            Bid <span className="text-emerald-400">${fmtPrice(marks.bid)}</span>
          </span>
        ) : null}
        {row && row.quoteVolume > 0 ? (
          <span>Vol {fmtUsdCompact(row.quoteVolume)}</span>
        ) : null}
        {row && row.highPrice > 0 ? (
          <span>
            H ${fmtPrice(row.highPrice)} · L ${fmtPrice(row.lowPrice)}
          </span>
        ) : null}
      </div>
    </div>
  )
}
