'use client'

/**
 * Manual trading desk for Auto Binance.
 *
 * The Super Machine trades on its own; this panel is for taking the trade
 * yourself while still seeing the council's read. Nothing is submitted until
 * the server-side preflight comes back clean and the user confirms.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { engine, type ManualDesk, type ManualPreflight } from '@/lib/api'
import { useSocket } from '@/hooks/useSocket'

type Props = {
  symbol: string
  onTraded?: () => void
}

const QUICK_USD = [10, 25, 50, 100]
const SELL_FRACTIONS = [0.25, 0.5, 1]

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(4)
  return n.toFixed(6)
}

function biasColor(bias: string): string {
  if (bias === 'up') return 'text-emerald-300'
  if (bias === 'down') return 'text-rose-300'
  return 'text-zinc-400'
}

export function CexManualTradePanel({ symbol, onTraded }: Props) {
  const [desk, setDesk] = useState<ManualDesk | null>(null)
  const [loading, setLoading] = useState(true)
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [usdAmount, setUsdAmount] = useState('25')
  const [sellFraction, setSellFraction] = useState(1)
  const [attachExits, setAttachExits] = useState(true)
  const [preflight, setPreflight] = useState<ManualPreflight | null>(null)
  const [checking, setChecking] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const d = await engine.manualDesk(symbol)
      setDesk(d)
    } catch {
      setDesk(null)
    } finally {
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => {
    setLoading(true)
    setPreflight(null)
    void refresh()
  }, [refresh])

  useSocket({
    onTradeExecuted: () => {
      void refresh()
    },
  })

  useEffect(() => {
    const onRefresh = () => void refresh()
    window.addEventListener('dashboard:refresh', onRefresh)
    return () => window.removeEventListener('dashboard:refresh', onRefresh)
  }, [refresh])

  const request = useMemo(
    () =>
      side === 'BUY'
        ? { symbol, side, quoteOrderQty: Number(usdAmount) || 0, attachExits }
        : { symbol, side, fraction: sellFraction },
    [symbol, side, usdAmount, sellFraction, attachExits],
  )

  const runPreflight = async () => {
    setChecking(true)
    try {
      const result = await engine.manualPreflight(request)
      setPreflight(result)
      if (!result.ok) toast.error(result.blockers[0] ?? 'Preflight failed')
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error as string) || e.message : 'Preflight failed'
      toast.error(msg)
    } finally {
      setChecking(false)
    }
  }

  const submit = async () => {
    setSubmitting(true)
    try {
      const result = await engine.manualTrade(request)
      toast.success(
        `${result.side} ${result.pair} filled — ${result.filledQty} @ ${fmtPx(result.avgPrice)} (${fmtUsd(result.quoteValue)})`,
      )
      if (result.note) toast.info(result.note)
      setPreflight(null)
      await refresh()
      onTraded?.()
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error as string) || e.message : 'Trade failed'
      toast.error(msg)
    } finally {
      setSubmitting(false)
    }
  }

  if (loading) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0a0a0f] p-3">
        <p className="text-[11px] text-zinc-500">Loading manual desk…</p>
      </div>
    )
  }

  if (!desk) {
    return (
      <div className="rounded-xl border border-white/10 bg-[#0a0a0f] p-3">
        <p className="text-[11px] text-zinc-500">Manual desk unavailable. Check your Binance connection.</p>
      </div>
    )
  }

  const ctx = desk.signal.context
  const lh = ctx?.longHorizon
  const suggestion = desk.suggestion
  const canSubmit = preflight?.ok && !submitting

  return (
    <div className="flex flex-col gap-3">
      {/* Signal / suggestion */}
      <div className="rounded-xl border border-white/10 bg-[#0a0a0f] p-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Signal · {desk.pair}</p>
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
              suggestion.action === 'BUY'
                ? 'bg-emerald-500/15 text-emerald-300'
                : suggestion.action === 'SELL'
                  ? 'bg-rose-500/15 text-rose-300'
                  : 'bg-zinc-500/15 text-zinc-400'
            }`}
          >
            {suggestion.action}
          </span>
        </div>

        <p className="mt-1.5 font-mono text-xs text-zinc-300">
          Consensus {desk.signal.consensus} · {(desk.signal.confidence * 100).toFixed(0)}% · conviction{' '}
          {(suggestion.conviction * 100).toFixed(0)}%
        </p>

        {ctx?.available ? (
          <>
            <p className="mt-2 text-[11px] text-zinc-400">{ctx.headline}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ctx.timeframes.map((tf) => (
                <span
                  key={tf.interval}
                  className={`rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] ${biasColor(tf.bias)}`}
                  title={`RSI ${tf.rsi14?.toFixed(0) ?? '—'} · ADX ${tf.adx?.toFixed(0) ?? '—'} · ${tf.bars} bars`}
                >
                  {tf.interval} {tf.bias}
                </span>
              ))}
            </div>
            {lh ? (
              <p className="mt-2 font-mono text-[10px] text-zinc-500">
                52w range {fmtPx(lh.low52w)}–{fmtPx(lh.high52w)} · position {(lh.rangePosition * 100).toFixed(0)}%
                {lh.return365dPct != null ? ` · 1y ${lh.return365dPct >= 0 ? '+' : ''}${lh.return365dPct.toFixed(0)}%` : ''}
                {lh.annualizedVolPct != null ? ` · vol ${lh.annualizedVolPct.toFixed(0)}%` : ''}
              </p>
            ) : null}
            <p className="mt-1 text-[9px] uppercase tracking-wide text-zinc-600">
              {ctx.dataQuality} history · {ctx.regime.replace('_', ' ')}
            </p>
          </>
        ) : (
          <p className="mt-2 text-[11px] text-amber-300/80">
            No stored history for this pair yet — the candle store is still backfilling.
          </p>
        )}

        {suggestion.cautions.length > 0 ? (
          <ul className="mt-2 space-y-0.5">
            {suggestion.cautions.slice(0, 3).map((c) => (
              <li key={c} className="text-[10px] text-amber-300/80">
                · {c}
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {/* Ticket */}
      <div className="rounded-xl border border-white/10 bg-[#0a0a0f] p-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Manual order</p>
          <p className="font-mono text-[10px] text-zinc-500">
            Balance ${(desk.balances.freeQuoteUsd ?? desk.balances.freeUsdt).toFixed(2)} stables
            {desk.balances.freeUsdc > 0 ? ` · USDC $${desk.balances.freeUsdc.toFixed(2)}` : ''}
            {' · '}
            {desk.balances.freeBase} {desk.baseAsset}
          </p>
          {desk.balances.error ? (
            <p className="text-[10px] text-rose-300">{desk.balances.error}</p>
          ) : null}
        </div>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {(['BUY', 'SELL'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setSide(s)
                setPreflight(null)
              }}
              className={`rounded-md py-1.5 text-xs font-semibold transition ${
                side === s
                  ? s === 'BUY'
                    ? 'bg-emerald-500/20 text-emerald-200'
                    : 'bg-rose-500/20 text-rose-200'
                  : 'bg-white/5 text-zinc-400 hover:bg-white/10'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {side === 'BUY' ? (
          <>
            <label htmlFor="manual-usd" className="mt-2 block text-[10px] uppercase text-zinc-500">
              Spend (USDT)
            </label>
            <input
              id="manual-usd"
              value={usdAmount}
              onChange={(e) => {
                setUsdAmount(e.target.value.replace(/[^\d.]/g, ''))
                setPreflight(null)
              }}
              inputMode="decimal"
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-sm text-white outline-none focus:border-sky-500/50"
            />
            <div className="mt-1.5 flex flex-wrap gap-1">
              {QUICK_USD.map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => {
                    setUsdAmount(String(v))
                    setPreflight(null)
                  }}
                  className="rounded bg-white/5 px-2 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-white/10 hover:text-zinc-200"
                >
                  ${v}
                </button>
              ))}
              {suggestion.action === 'BUY' && suggestion.sizeUsd >= 5 ? (
                <button
                  type="button"
                  onClick={() => {
                    setUsdAmount(suggestion.sizeUsd.toFixed(2))
                    setPreflight(null)
                  }}
                  className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] text-emerald-300 hover:bg-emerald-500/25"
                >
                  Suggested ${suggestion.sizeUsd.toFixed(0)}
                </button>
              ) : null}
            </div>

            <label className="mt-2 flex cursor-pointer items-center gap-2 text-[10px] text-zinc-400">
              <input
                type="checkbox"
                checked={attachExits}
                onChange={(e) => {
                  setAttachExits(e.target.checked)
                  setPreflight(null)
                }}
                className="h-3 w-3 accent-emerald-500"
              />
              Attach take-profit / stop-loss (managed by Binance)
            </label>
          </>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1">
            {SELL_FRACTIONS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => {
                  setSellFraction(f)
                  setPreflight(null)
                }}
                className={`rounded px-2 py-1 font-mono text-[10px] ${
                  sellFraction === f ? 'bg-rose-500/20 text-rose-200' : 'bg-white/5 text-zinc-400 hover:bg-white/10'
                }`}
              >
                {(f * 100).toFixed(0)}%
              </button>
            ))}
            <span className="ml-auto self-center font-mono text-[10px] text-zinc-500">
              ≈ {(desk.balances.freeBase * sellFraction).toPrecision(6)} {desk.baseAsset}
            </span>
          </div>
        )}

        {suggestion.entryHint != null ? (
          <p className="mt-2 font-mono text-[10px] text-zinc-500">
            Mark {fmtPx(suggestion.entryHint)} · TP {fmtPx(suggestion.takeProfitHint)} · SL{' '}
            {fmtPx(suggestion.stopLossHint)}
            {desk.book?.spreadBps != null ? ` · spread ${desk.book.spreadBps.toFixed(1)} bps` : ''}
          </p>
        ) : null}

        {/* Preflight result */}
        {preflight ? (
          <div
            className={`mt-2 rounded-lg border px-2 py-1.5 ${
              preflight.ok ? 'border-emerald-500/30 bg-emerald-500/5' : 'border-rose-500/30 bg-rose-500/5'
            }`}
          >
            <p className={`text-[10px] font-semibold ${preflight.ok ? 'text-emerald-300' : 'text-rose-300'}`}>
              {preflight.ok ? 'Preflight passed' : 'Preflight blocked'}
              {preflight.signalAlignment === 'against' ? ' · against the signal' : ''}
            </p>
            {preflight.ok ? (
              <p className="mt-0.5 font-mono text-[10px] text-zinc-400">
                ≈ {preflight.order.estBaseQty?.toPrecision(6) ?? '—'} {desk.baseAsset} @{' '}
                {fmtPx(preflight.order.estPrice)} = {fmtUsd(preflight.order.estQuoteValue)}
              </p>
            ) : null}
            {[...preflight.blockers, ...preflight.warnings].slice(0, 4).map((m) => (
              <p key={m} className="mt-0.5 text-[10px] text-zinc-400">
                · {m}
              </p>
            ))}
          </div>
        ) : null}

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="h-8 text-[11px]"
            disabled={checking}
            onClick={() => void runPreflight()}
          >
            {checking ? 'Checking…' : 'Preflight'}
          </Button>
          <Button
            type="button"
            size="sm"
            className={`h-8 text-[11px] ${
              side === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'
            }`}
            disabled={!canSubmit}
            onClick={() => void submit()}
          >
            {submitting ? 'Submitting…' : `Confirm ${side}`}
          </Button>
        </div>

        {!preflight ? (
          <p className="mt-1.5 text-[9px] text-zinc-600">Run preflight to enable the confirm button.</p>
        ) : null}

        {!desk.readiness.ready && desk.readiness.blockers[0] ? (
          <p className="mt-1.5 text-[10px] text-amber-300/80">{desk.readiness.blockers[0]}</p>
        ) : null}
      </div>
    </div>
  )
}
