'use client'

/**
 * Open positions held in the user's own wallet.
 *
 * The bot has no key for these, so the take-profit and stop-loss levels the
 * user configured show up here as alerts rather than automatic exits. Selling
 * is one click, but the wallet still signs it.
 */
import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { dexJupiter } from '@/lib/api'
import { useBrowserJupiterSwap } from '@/hooks/useBrowserJupiterSwap'

type Positions = Awaited<ReturnType<typeof dexJupiter.browserPositions>>

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `$${n.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1) return n.toFixed(4)
  return n.toFixed(8)
}

export function SelfCustodyPositions({
  owner,
  onTraded,
}: {
  owner: string | null
  onTraded?: () => void
}) {
  const [data, setData] = useState<Positions | null>(null)
  const [loading, setLoading] = useState(true)
  const [sellingId, setSellingId] = useState<string | null>(null)
  const browserSwap = useBrowserJupiterSwap()

  const load = useCallback(async () => {
    try {
      setData(await dexJupiter.browserPositions(owner ?? undefined))
    } catch {
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [owner])

  useEffect(() => {
    void load()
    const id = window.setInterval(() => void load(), 30_000)
    return () => window.clearInterval(id)
  }, [load])

  const sell = async (p: Positions['positions'][number]) => {
    const qty = p.walletQty != null && p.walletQty > 0 ? Math.min(p.walletQty, p.qty) : p.qty
    if (!(qty > 0)) {
      toast.error(`No ${p.baseSymbol} balance in your connected wallet`)
      return
    }
    setSellingId(p.id)
    try {
      const res = await browserSwap.swap({ side: 'SELL', binanceSymbol: p.binanceSymbol, amount: qty })
      toast.success(`Sold ${p.baseSymbol} for ${fmtUsd(res.amountOut)} · ${res.txSignature.slice(0, 12)}…`)
      await load()
      onTraded?.()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } }; message?: string }
      const msg = ax.response?.data?.error ?? ax.message ?? 'Sell failed'
      toast.error(/reject|denied|cancel/i.test(msg) ? 'Cancelled in your wallet' : msg)
    } finally {
      setSellingId(null)
    }
  }

  if (loading || !data || data.positions.length === 0) return null

  const alerts = data.positions.filter((p) => p.alert != null)

  return (
    <div className="rounded-xl border border-violet-500/25 bg-violet-500/[0.05] p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="text-xs font-medium text-white">Your wallet&rsquo;s positions</p>
          <p className="mt-0.5 text-[10px] leading-snug text-zinc-500">
            Not auto-managed — take-profit {data.thresholds.takeProfitPct}% and stop-loss{' '}
            {data.thresholds.stopLossPct}% are alerts you action here.
          </p>
        </div>
        {alerts.length > 0 ? (
          <span className="shrink-0 rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-300">
            {alerts.length} to review
          </span>
        ) : null}
      </div>

      <div className="mt-2 flex flex-col gap-1.5">
        {data.positions.map((p) => {
          const up = (p.pnlPct ?? 0) >= 0
          return (
            <div
              key={p.id}
              className={`rounded-lg border px-2.5 py-2 ${
                p.alert === 'take_profit'
                  ? 'border-emerald-500/40 bg-emerald-500/[0.07]'
                  : p.alert === 'stop_loss'
                    ? 'border-rose-500/40 bg-rose-500/[0.07]'
                    : 'border-white/10 bg-black/30'
              }`}
            >
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <p className="truncate text-xs font-medium text-white">{p.pair}</p>
                  <p className="font-mono text-[10px] text-zinc-500">
                    {fmtUsd(p.allocationUsd)} in · entry {fmtPx(p.entryPrice)} · mark {fmtPx(p.markPrice)}
                  </p>
                </div>
                <div className="shrink-0 text-right">
                  <p className={`font-mono text-xs ${up ? 'text-emerald-300' : 'text-rose-300'}`}>
                    {p.pnlPct != null ? `${up ? '+' : ''}${p.pnlPct.toFixed(2)}%` : '—'}
                  </p>
                  <p className="font-mono text-[10px] text-zinc-500">{fmtUsd(p.pnlUsd)}</p>
                </div>
              </div>

              {p.alert ? (
                <p
                  className={`mt-1 text-[10px] ${
                    p.alert === 'take_profit' ? 'text-emerald-300' : 'text-rose-300'
                  }`}
                >
                  {p.alert === 'take_profit'
                    ? `Take-profit level reached — sell to bank ${fmtUsd(p.pnlUsd)}.`
                    : 'Stop-loss level breached — consider closing.'}
                </p>
              ) : null}

              {p.walletQty != null && p.walletQty <= 0 ? (
                <p className="mt-1 text-[10px] text-amber-300/80">
                  No {p.baseSymbol} left in this wallet — it was moved or sold elsewhere.
                </p>
              ) : null}

              <button
                type="button"
                disabled={sellingId === p.id || !browserSwap.canSign}
                onClick={() => void sell(p)}
                className="mt-1.5 w-full rounded-md bg-white/10 py-1 text-[11px] text-zinc-200 transition hover:bg-white/20 disabled:opacity-50"
              >
                {sellingId === p.id
                  ? browserSwap.stage === 'signing'
                    ? 'Sign in your wallet…'
                    : 'Selling…'
                  : `Sell ${p.baseSymbol}`}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
