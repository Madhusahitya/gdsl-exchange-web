'use client'

import type { useCexMarketTrade } from '@/hooks/useCexMarketTrade'

type Trade = ReturnType<typeof useCexMarketTrade>

type Props = {
  trade: Trade
  compact?: boolean
}

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(4)
  return n.toFixed(6)
}

/** Binance-style market order ticket — one-click buy/sell, no preflight step. */
export function CexMarketTradePanel({ trade, compact = false }: Props) {
  const {
    desk,
    loading,
    busy,
    amount,
    setAmount,
    sellFraction,
    setSellFraction,
    attachExits,
    setAttachExits,
    quoteAsset,
    baseAsset,
    buyPrice,
    sellPrice,
    maxSpend,
    setSpendFraction,
    marketBuy,
    marketSell,
  } = trade

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0a0a0f] p-3">
        <p className="text-[11px] text-zinc-500">Loading market desk…</p>
      </div>
    )
  }

  if (!desk) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0a0a0f] p-3">
        <p className="text-[11px] text-rose-300">Connect Binance to trade.</p>
      </div>
    )
  }

  const canBuy = maxSpend >= 5 && desk.readiness.ready
  const canSell = desk.balances.freeBase > 0 && desk.readiness.ready

  return (
    <div className="rounded-xl border border-white/10 bg-[#0a0a0f] p-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wide text-zinc-500">Market · {desk.pair}</p>
        <p className="font-mono text-[10px] text-zinc-500">
          ${desk.balances.freeQuoteUsd.toFixed(2)} {quoteAsset}
          {desk.balances.freeBase > 0 ? ` · ${desk.balances.freeBase.toFixed(6)} ${baseAsset}` : ''}
        </p>
      </div>

      {!desk.readiness.ready && desk.readiness.blockers[0] ? (
        <p className="mt-2 rounded border border-amber-500/30 bg-amber-500/5 px-2 py-1.5 text-[10px] text-amber-200">
          {desk.readiness.blockers[0]}
        </p>
      ) : null}

      <div className="mt-3 grid grid-cols-2 gap-2">
        <button
          type="button"
          disabled={busy || !canBuy}
          onClick={() => void marketBuy()}
          className="rounded-lg bg-emerald-600 px-3 py-3 text-left transition hover:bg-emerald-500 disabled:opacity-40"
        >
          <p className="text-[9px] font-semibold uppercase text-emerald-100">Market Buy</p>
          <p className="font-mono text-base font-bold text-white">{fmtPx(buyPrice)}</p>
        </button>
        <button
          type="button"
          disabled={busy || !canSell}
          onClick={() => void marketSell()}
          className="rounded-lg bg-rose-600 px-3 py-3 text-left transition hover:bg-rose-500 disabled:opacity-40"
        >
          <p className="text-[9px] font-semibold uppercase text-rose-100">Market Sell</p>
          <p className="font-mono text-base font-bold text-white">{fmtPx(sellPrice)}</p>
        </button>
      </div>

      <label className="mt-3 block text-[10px] uppercase text-zinc-500">
        Spend ({quoteAsset}) · max ${maxSpend.toFixed(2)}
      </label>
      <input
        value={amount}
        onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
        inputMode="decimal"
        className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-2 font-mono text-sm text-white outline-none focus:border-emerald-500/50"
      />
      <div className="mt-1.5 flex flex-wrap gap-1">
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setSpendFraction(f)}
            className="rounded bg-white/5 px-2 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-white/10"
          >
            {f === 1 ? 'Max' : `${f * 100}%`}
          </button>
        ))}
      </div>

      {!compact ? (
        <>
          <div className="mt-2 flex flex-wrap gap-1">
            {[0.25, 0.5, 1].map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => setSellFraction(f)}
                className={`rounded px-2 py-1 font-mono text-[10px] ${
                  sellFraction === f ? 'bg-rose-500/20 text-rose-200' : 'bg-white/5 text-zinc-400'
                }`}
              >
                Sell {(f * 100).toFixed(0)}%
              </button>
            ))}
          </div>

          <label className="mt-2 flex cursor-pointer items-center gap-2 text-[10px] text-zinc-400">
            <input
              type="checkbox"
              checked={attachExits}
              onChange={(e) => setAttachExits(e.target.checked)}
              className="h-3 w-3 accent-emerald-500"
            />
            Auto take-profit / stop-loss on buys
          </label>

          {desk.suggestion.entryHint != null ? (
            <p className="mt-2 font-mono text-[10px] text-zinc-500">
              Mark {fmtPx(desk.suggestion.entryHint)} · spread{' '}
              {desk.book?.spreadBps != null ? `${desk.book.spreadBps.toFixed(1)} bps` : '—'}
            </p>
          ) : null}
        </>
      ) : null}

      {busy ? (
        <p className="mt-2 text-center text-[10px] text-zinc-400">Sending market order to Binance…</p>
      ) : null}

      {desk.balances.error ? (
        <p className="mt-2 text-[10px] text-rose-300">{desk.balances.error}</p>
      ) : null}
    </div>
  )
}
