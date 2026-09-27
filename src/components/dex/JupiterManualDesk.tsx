'use client'

/**
 * Manual trading desk for Jupiter.
 *
 * The point of this panel is that a DEX trade can look flat and still be a
 * guaranteed loss, because the buy ask sits above the sell bid by more than the
 * move you are hoping for. So the headline number here is not the price — it is
 * how far the token has to travel before an exit makes money. Nothing submits
 * until the server-side preflight returns clean and the user confirms.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import axios from 'axios'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { dexJupiter, type JupiterDesk, type JupiterPreflight } from '@/lib/api'

type Props = {
  binanceSymbol: string
  /** Connected wallet address, or null to trade the platform wallet. */
  owner: string | null
  /** Runs the actual swap; the page owns execution so both custody paths work. */
  onExecute: (req: { side: 'BUY' | 'SELL'; amount: number }) => Promise<void>
  executing?: boolean
  /** Label for the signing step, e.g. "Phantom" or "Platform wallet". */
  walletLabel: string
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
  return n.toPrecision(4)
}

function fmtQty(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return n.toPrecision(6)
}

function biasColor(bias: string): string {
  if (bias === 'up') return 'text-emerald-300'
  if (bias === 'down') return 'text-rose-300'
  return 'text-zinc-400'
}

export function JupiterManualDesk({
  binanceSymbol,
  owner,
  onExecute,
  executing,
  walletLabel,
}: Props) {
  const [desk, setDesk] = useState<JupiterDesk | null>(null)
  const [loading, setLoading] = useState(true)
  const [deskError, setDeskError] = useState<string | null>(null)
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [usdAmount, setUsdAmount] = useState('25')
  const [sellFraction, setSellFraction] = useState(1)
  const [preflight, setPreflight] = useState<JupiterPreflight | null>(null)
  const [checking, setChecking] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setDesk(await dexJupiter.desk({ binanceSymbol, owner: owner ?? undefined }))
      setDeskError(null)
    } catch (e) {
      const msg = axios.isAxiosError(e)
        ? ((e.response?.data as { error?: string })?.error ?? e.message)
        : 'Desk unavailable'
      setDeskError(msg)
    } finally {
      setLoading(false)
    }
  }, [binanceSymbol, owner])

  useEffect(() => {
    setLoading(true)
    setPreflight(null)
    void refresh()
    const id = window.setInterval(() => void refresh(), 20_000)
    return () => window.clearInterval(id)
  }, [refresh])

  const amount = useMemo(() => {
    if (side === 'BUY') return Number(usdAmount) || 0
    return (desk?.wallet.baseQty ?? 0) * sellFraction
  }, [side, usdAmount, desk, sellFraction])

  const runPreflight = async () => {
    setChecking(true)
    try {
      const result = await dexJupiter.manualPreflight({
        binanceSymbol,
        side,
        amount,
        owner: owner ?? undefined,
      })
      setPreflight(result)
      if (!result.ok) toast.error(result.blockers[0] ?? 'Preflight blocked this order')
    } catch (e) {
      const msg = axios.isAxiosError(e)
        ? ((e.response?.data as { error?: string })?.error ?? e.message)
        : 'Preflight failed'
      toast.error(msg)
    } finally {
      setChecking(false)
    }
  }

  const submit = async () => {
    await onExecute({ side, amount })
    setPreflight(null)
    await refresh()
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
        <p className="text-[11px] text-zinc-500">{deskError ?? 'Manual desk unavailable for this pair.'}</p>
      </div>
    )
  }

  const ctx = desk.context
  const lh = ctx?.longHorizon
  const s = desk.suggestion
  const spreadPct = desk.price.spreadBps != null ? Math.abs(desk.price.spreadBps) / 100 : null
  const canSubmit = preflight?.ok && !executing

  return (
    <div className="flex flex-col gap-2.5">
      {/* What the trade has to do to make money — the whole point of the panel. */}
      <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] p-3">
        <p className="text-[10px] uppercase tracking-wide text-amber-200/80">Cost to beat</p>
        <p className="mt-1 text-sm leading-snug text-white">
          {desk.profit.minMoveToBreakEvenPct != null ? (
            <>
              {desk.baseSymbol} must rise{' '}
              <span className="font-mono font-semibold text-amber-200">
                {desk.profit.minMoveToBreakEvenPct.toFixed(2)}%
              </span>{' '}
              after you buy before selling turns a profit.
            </>
          ) : (
            'Enter an amount and run preflight to see the break-even for your size.'
          )}
        </p>
        <p className="mt-1 font-mono text-[10px] text-zinc-500">
          Buy {fmtPx(desk.price.buy)} · sell {fmtPx(desk.price.sell)}
          {spreadPct != null ? ` · round-trip spread ${spreadPct.toFixed(2)}%` : ''}
          {desk.profit.breakEvenSellPrice != null
            ? ` · break-even ${fmtPx(desk.profit.breakEvenSellPrice)}`
            : ''}
        </p>
        {desk.profit.openEntryPrice != null ? (
          <p className="mt-1 text-[10px] text-zinc-400">
            You already hold {desk.baseSymbol} at {fmtPx(desk.profit.openEntryPrice)}.{' '}
            {desk.profit.upsideToBreakEvenPct === 0
              ? 'Selling now is profitable.'
              : desk.profit.upsideToBreakEvenPct != null
                ? `Still ${desk.profit.upsideToBreakEvenPct.toFixed(2)}% below break-even.`
                : ''}
          </p>
        ) : null}
      </div>

      {/* Signal read */}
      <div className="rounded-xl border border-white/10 bg-[#0a0a0f] p-3">
        <div className="flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">Signal · {desk.pair}</p>
          <span
            className={`rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase ${
              s.action === 'BUY'
                ? 'bg-emerald-500/15 text-emerald-300'
                : s.action === 'SELL'
                  ? 'bg-rose-500/15 text-rose-300'
                  : 'bg-zinc-500/15 text-zinc-400'
            }`}
          >
            {s.action}
          </span>
        </div>
        <p className="mt-1.5 font-mono text-xs text-zinc-300">
          Conviction {(s.conviction * 100).toFixed(0)}%
          {desk.profit.entryQuality ? ` · entry ${desk.profit.entryQuality}` : ''}
        </p>

        {ctx?.available ? (
          <>
            <p className="mt-2 text-[11px] text-zinc-400">{ctx.headline}</p>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {ctx.timeframes.map((tf) => (
                <span
                  key={tf.interval}
                  className={`rounded bg-white/5 px-1.5 py-0.5 font-mono text-[9px] ${biasColor(tf.bias)}`}
                  title={`RSI ${tf.rsi14?.toFixed(0) ?? '—'} · ${tf.bars} bars`}
                >
                  {tf.interval} {tf.bias}
                </span>
              ))}
            </div>
            {lh ? (
              <p className="mt-2 font-mono text-[10px] text-zinc-500">
                52w {fmtPx(lh.low52w)}–{fmtPx(lh.high52w)} · position {(lh.rangePosition * 100).toFixed(0)}%
                {lh.return365dPct != null
                  ? ` · 1y ${lh.return365dPct >= 0 ? '+' : ''}${lh.return365dPct.toFixed(0)}%`
                  : ''}
              </p>
            ) : null}
          </>
        ) : (
          <p className="mt-2 text-[11px] text-zinc-500">
            No Binance history for this token, so there is no multi-timeframe read — trade it on the
            spread and your own thesis.
          </p>
        )}

        {s.cautions.length > 0 ? (
          <ul className="mt-2 space-y-0.5">
            {s.cautions.map((c) => (
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
            {fmtUsd(desk.wallet.usdc)} · {fmtQty(desk.wallet.baseQty)} {desk.baseSymbol}
          </p>
        </div>
        <p className="mt-0.5 text-[9px] text-zinc-600">
          {desk.wallet.source === 'browser' ? walletLabel : 'Platform wallet'} · {desk.wallet.sol.toFixed(4)} SOL
          for fees
        </p>

        <div className="mt-2 grid grid-cols-2 gap-1.5">
          {(['BUY', 'SELL'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => {
                setSide(v)
                setPreflight(null)
              }}
              className={`rounded-md py-1.5 text-xs font-semibold transition ${
                side === v
                  ? v === 'BUY'
                    ? 'bg-emerald-500/20 text-emerald-200'
                    : 'bg-rose-500/20 text-rose-200'
                  : 'bg-white/5 text-zinc-400 hover:bg-white/10'
              }`}
            >
              {v}
            </button>
          ))}
        </div>

        {side === 'BUY' ? (
          <>
            <label htmlFor="jup-manual-usd" className="mt-2 block text-[10px] uppercase text-zinc-500">
              Spend (USDC)
            </label>
            <input
              id="jup-manual-usd"
              value={usdAmount}
              onChange={(e) => {
                setUsdAmount(e.target.value.replace(/[^\d.]/g, ''))
                setPreflight(null)
              }}
              inputMode="decimal"
              className="mt-1 w-full rounded border border-white/10 bg-black/40 px-2 py-1.5 font-mono text-sm text-white outline-none focus:border-violet-500/50"
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
              {s.action === 'BUY' && s.sizeUsd >= 1 ? (
                <button
                  type="button"
                  onClick={() => {
                    setUsdAmount(s.sizeUsd.toFixed(2))
                    setPreflight(null)
                  }}
                  className="rounded bg-emerald-500/15 px-2 py-0.5 font-mono text-[10px] text-emerald-300 hover:bg-emerald-500/25"
                >
                  Suggested ${s.sizeUsd.toFixed(0)}
                </button>
              ) : null}
            </div>
          </>
        ) : (
          <div className="mt-2 flex flex-wrap items-center gap-1">
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
            <span className="ml-auto font-mono text-[10px] text-zinc-500">
              ≈ {fmtQty(amount)} {desk.baseSymbol}
            </span>
          </div>
        )}

        <p className="mt-2 font-mono text-[10px] text-zinc-500">
          Take-profit {desk.exits.takeProfitPct}% at {fmtPx(desk.exits.takeProfitPrice)} · stop-loss{' '}
          {desk.exits.stopLossPct}% at {fmtPx(desk.exits.stopLossPrice)}
        </p>
        {!desk.wallet.botCanTrade ? (
          <p className="mt-0.5 text-[10px] text-violet-300/80">
            Those levels are alerts for a connected wallet — the bot has no key to sell with.
          </p>
        ) : null}

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
            {preflight.profitCase ? (
              <p className="mt-1 text-[10px] leading-snug text-zinc-300">{preflight.profitCase}</p>
            ) : null}
            {preflight.ok ? (
              <p className="mt-1 font-mono text-[10px] text-zinc-400">
                ≈ {fmtQty(preflight.order.estReceive)}{' '}
                {preflight.order.side === 'BUY' ? desk.baseSymbol : 'USDC'} @ {fmtPx(preflight.order.estPrice)}
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
            disabled={checking || amount <= 0}
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
            {executing ? 'Submitting…' : `Confirm ${side}`}
          </Button>
        </div>
        {!preflight ? (
          <p className="mt-1.5 text-[9px] text-zinc-600">Run preflight to enable the confirm button.</p>
        ) : null}
      </div>
    </div>
  )
}
