'use client'

import { LiveNumber } from '@/components/ui/LiveNumber'

type Props = {
  amount: string
  onAmountChange: (v: string) => void
  quoteAsset: string
  baseAsset: string
  buyPrice: number | null
  sellPrice: number | null
  busy: boolean
  onMarketBuy: () => void
  onMarketSell: () => void
}

function fmtPx(n: number | null): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(4)
  return n.toFixed(6)
}

/** Binance-style instant market buy / sell overlay on the CEX chart. */
export function CexChartMarketBar({
  amount,
  onAmountChange,
  quoteAsset,
  baseAsset,
  buyPrice,
  sellPrice,
  busy,
  onMarketBuy,
  onMarketSell,
}: Props) {
  return (
    <div className="pointer-events-none absolute inset-x-2 top-2 z-20 flex justify-center">
      <div className="pointer-events-auto flex max-w-lg flex-wrap items-stretch gap-1.5 rounded-xl border border-white/15 bg-[#0a0a0f]/95 p-1.5 shadow-lg backdrop-blur-sm">
        <button
          type="button"
          disabled={busy}
          onClick={onMarketBuy}
          className="min-w-[120px] flex-1 rounded-lg bg-emerald-600 px-3 py-2 text-left transition hover:bg-emerald-500 disabled:opacity-50"
        >
          <div className="text-[9px] font-semibold uppercase tracking-wide text-emerald-100">Market Buy</div>
          <div className="font-mono text-sm font-bold text-white">
            <LiveNumber value={buyPrice}>{fmtPx(buyPrice)}</LiveNumber>
          </div>
        </button>

        <div className="flex min-w-[100px] flex-col justify-center px-1">
          <label className="text-[8px] uppercase text-zinc-500">Spend ({quoteAsset})</label>
          <input
            value={amount}
            onChange={(e) => onAmountChange(e.target.value.replace(/[^\d.]/g, ''))}
            inputMode="decimal"
            className="w-full rounded border border-white/10 bg-black/50 px-2 py-1 font-mono text-sm text-white outline-none focus:border-sky-500/50"
          />
        </div>

        <button
          type="button"
          disabled={busy}
          onClick={onMarketSell}
          className="min-w-[120px] flex-1 rounded-lg bg-rose-600 px-3 py-2 text-left transition hover:bg-rose-500 disabled:opacity-50"
        >
          <div className="text-[9px] font-semibold uppercase tracking-wide text-rose-100">Market Sell</div>
          <div className="font-mono text-sm font-bold text-white">
            <LiveNumber value={sellPrice}>{fmtPx(sellPrice)}</LiveNumber>
          </div>
          <div className="text-[8px] text-rose-100/80">{baseAsset}</div>
        </button>
      </div>
    </div>
  )
}
