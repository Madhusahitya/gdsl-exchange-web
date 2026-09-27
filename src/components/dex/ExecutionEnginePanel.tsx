'use client'

/**
 * Binance-style Execution Engine panel — compares routers without changing the
 * existing swap ticket. Additive: Trade tab still works exactly as before.
 */
import { useCallback, useEffect, useState } from 'react'
import { dexJupiter, type ExecutionCompareResult } from '@/lib/api'
import { cn } from '@/lib/utils'

type Props = {
  binanceSymbol: string
  side: 'BUY' | 'SELL'
  amount: number
  spendMint?: string
}

export function ExecutionEnginePanel({ binanceSymbol, side, amount, spendMint }: Props) {
  const [data, setData] = useState<ExecutionCompareResult | null>(null)
  const [err, setErr] = useState('')
  const [loading, setLoading] = useState(false)

  const refresh = useCallback(async () => {
    if (!binanceSymbol || !(amount > 0)) return
    setLoading(true)
    setErr('')
    try {
      const res = await dexJupiter.executionCompare({
        side,
        binanceSymbol,
        amount,
        spendMint,
        includeSecondary: true,
      })
      setData(res)
    } catch (e) {
      setErr(
        (e as { response?: { data?: { error?: string } } })?.response?.data?.error ??
          (e instanceof Error ? e.message : 'Compare failed'),
      )
    } finally {
      setLoading(false)
    }
  }, [binanceSymbol, side, amount, spendMint])

  useEffect(() => {
    const t = window.setTimeout(() => void refresh(), 200)
    const id = window.setInterval(() => void refresh(), 5_000)
    return () => {
      window.clearTimeout(t)
      window.clearInterval(id)
    }
  }, [refresh])

  const cex = data?.cex
  const conf = data?.confidence

  return (
    <div className="flex min-h-0 flex-col gap-2 rounded-xl border border-white/10 bg-[#0a0a0f] p-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-semibold text-white">Execution Engine</p>
          <p className="text-[10px] text-zinc-500">
            Metis · Raydium · Orca · Meteora · OKX · order books — scored live
          </p>
        </div>
        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="rounded border border-zinc-700 px-2 py-1 text-[10px] text-zinc-300 hover:bg-white/5 disabled:opacity-50"
        >
          {loading ? '…' : 'Refresh'}
        </button>
      </div>

      {err ? (
        <p className="rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-[10px] text-amber-200">
          {err}
        </p>
      ) : null}

      {conf ? (
        <div className="grid grid-cols-5 gap-1 text-center">
          {(
            [
              ['Overall', conf.overall],
              ['Liq', conf.liquidity],
              ['Exec', conf.execution],
              ['Spread', conf.spread],
              ['Mom', conf.momentum],
            ] as const
          ).map(([label, v]) => (
            <div key={label} className="rounded bg-zinc-900/80 px-1 py-1.5">
              <p className="text-[9px] uppercase tracking-wide text-zinc-500">{label}</p>
              <p
                className={cn(
                  'font-mono text-sm font-semibold',
                  v >= 80 ? 'text-emerald-400' : v >= 60 ? 'text-amber-300' : 'text-rose-300',
                )}
              >
                {v}%
              </p>
            </div>
          ))}
        </div>
      ) : null}

      {cex ? (
        <div className="flex flex-wrap gap-2 text-[10px] text-zinc-400">
          <span>
            Binance{' '}
            <span className="font-mono text-zinc-200">
              {cex.binance != null ? `$${cex.binance.toPrecision(6)}` : '—'}
            </span>
          </span>
          <span>
            OKX{' '}
            <span className="font-mono text-zinc-200">
              {cex.okx != null ? `$${cex.okx.toPrecision(6)}` : '—'}
            </span>
          </span>
          <span>
            Bybit{' '}
            <span className="font-mono text-zinc-200">
              {cex.bybit != null ? `$${cex.bybit.toPrecision(6)}` : '—'}
            </span>
          </span>
        </div>
      ) : null}

      <div className="min-h-0 max-h-64 overflow-y-auto rounded border border-white/5">
        <table className="w-full text-left text-[10px]">
          <thead className="sticky top-0 bg-[#12121a] text-zinc-500">
            <tr>
              <th className="px-2 py-1.5 font-medium">Router</th>
              <th className="px-2 py-1.5 font-medium">Out</th>
              <th className="px-2 py-1.5 font-medium">ms</th>
              <th className="px-2 py-1.5 font-medium">Impact</th>
              <th className="px-2 py-1.5 font-medium">Score</th>
            </tr>
          </thead>
          <tbody>
            {(data?.routes ?? []).map((r) => (
              <tr
                key={r.router}
                className={cn(
                  'border-t border-white/5',
                  data?.best?.router === r.router ? 'bg-emerald-500/10' : '',
                  !r.executable ? 'opacity-50' : '',
                )}
              >
                <td className="px-2 py-1.5 text-zinc-200">
                  {r.label}
                  {!r.canExecute && r.executable ? (
                    <span className="ml-1 text-[8px] text-amber-400">quote-only</span>
                  ) : null}
                </td>
                <td className="px-2 py-1.5 font-mono text-zinc-300">
                  {r.executable ? r.outAmount.toPrecision(5) : '—'}
                </td>
                <td className="px-2 py-1.5 font-mono text-zinc-400">{r.latencyMs || '—'}</td>
                <td className="px-2 py-1.5 font-mono text-zinc-400">
                  {r.priceImpactPct != null ? `${r.priceImpactPct.toFixed(2)}%` : '—'}
                </td>
                <td
                  className={cn(
                    'px-2 py-1.5 font-mono font-semibold',
                    r.score >= 80 ? 'text-emerald-400' : 'text-zinc-300',
                  )}
                >
                  {r.executable ? r.score.toFixed(1) : '0'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data?.aiExplanation ? (
        <p className="rounded border border-violet-500/20 bg-violet-500/5 px-2 py-1.5 text-[10px] leading-snug text-violet-100/90">
          {data.aiExplanation}
        </p>
      ) : null}

      {data?.rpc?.length ? (
        <p className="text-[9px] text-zinc-600">
          RPC:{' '}
          {data.rpc
            .filter((r) => r.ok)
            .slice(0, 3)
            .map((r) => `${r.url.replace(/^https?:\/\//, '').slice(0, 28)}… ${r.latencyMs}ms`)
            .join(' · ') || 'probing…'}
        </p>
      ) : null}
    </div>
  )
}
