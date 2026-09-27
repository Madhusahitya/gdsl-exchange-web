'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  dexJupiter,
  type JupiterPredictionEvent,
  type JupiterPredictionPosition,
  type PredictionEventInsight,
  type PredictionMarketInsight,
} from '@/lib/api'

function fmtUsd(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  return `$${n.toFixed(2)}`
}

function fmtCents(micro: number | null | undefined): string {
  if (micro == null || !Number.isFinite(micro)) return '—'
  const cents = micro / 10_000
  return `${cents.toFixed(0)}¢`
}

/** "34 days left" / "6 hours left" — the deadline matters more than the raw date. */
function timeLeft(days: number | null): string | null {
  if (days == null) return null
  if (days <= 0) return 'closed'
  if (days < 1) return `${Math.max(1, Math.round(days * 24))}h left`
  if (days < 60) return `${Math.round(days)}d left`
  return `${Math.round(days / 30)}mo left`
}

function fmtVolume(usd: number | null): string | null {
  if (usd == null || !Number.isFinite(usd) || usd <= 0) return null
  if (usd >= 1_000_000) return `$${(usd / 1_000_000).toFixed(1)}M traded`
  if (usd >= 1_000) return `$${Math.round(usd / 1_000)}k traded`
  return `$${Math.round(usd)} traded`
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleString()
}

type HistoryRow = {
  id: string
  timestamp: string
  action: string
  marketId?: string
  positionPubkey?: string
  isYes?: boolean
  amountUsd?: number
  costUsd?: number
  proceedsUsd?: number
  pnlUsd?: number
  title?: string
  txSignature?: string
}

function predictErrorMessage(e: unknown, fallback: string): string {
  const ax = e as { response?: { data?: { error?: string } } }
  return ax.response?.data?.error ?? (e as Error).message ?? fallback
}

/**
 * A binary market row. The price in cents *is* the market's implied
 * probability, which is the single thing users miss, so both are always shown
 * together along with what a stake actually pays.
 */
function MarketRow({
  insight,
  yesMicro,
  noMicro,
  rules,
  busySide,
  onBuy,
}: {
  insight: PredictionMarketInsight | null
  yesMicro: number | null
  noMicro: number | null
  rules: string | undefined
  busySide: 'yes' | 'no' | null
  onBuy: (isYes: boolean) => void
}) {
  const [showRules, setShowRules] = useState(false)

  const verdict = insight?.verdict
  const best = verdict?.best
  const suggested = verdict && verdict.action !== 'SKIP' ? (verdict.action === 'BUY_YES' ? 'yes' : 'no') : null

  const left = timeLeft(insight?.daysToClose ?? null)
  const volume = fmtVolume(insight?.volumeUsd ?? null)

  const yesPct = insight?.yes.impliedProbPct
  const noPct = insight?.no.impliedProbPct

  return (
    <div className="rounded-md border border-white/5 bg-white/[0.02] px-2.5 py-2">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="min-w-0 flex-1 text-[11px] font-medium leading-snug text-zinc-100">
          {insight?.plainQuestion ?? 'Market'}
        </p>
        <div className="flex shrink-0 items-center gap-1.5 text-[10px]">
          {left ? (
            <span className={left === 'closed' ? 'text-rose-300' : 'text-zinc-400'}>{left}</span>
          ) : null}
          {volume ? <span className="text-zinc-600">· {volume}</span> : null}
        </div>
      </div>

      {/* Price and the probability it implies, side by side. */}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[10px]">
        <span className="text-emerald-300">
          YES {fmtCents(yesMicro)}
          {yesPct != null ? <span className="text-zinc-500"> ({yesPct.toFixed(0)}% chance)</span> : null}
        </span>
        <span className="text-rose-300">
          NO {fmtCents(noMicro)}
          {noPct != null ? <span className="text-zinc-500"> ({noPct.toFixed(0)}% chance)</span> : null}
        </span>
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          className={`h-7 px-2.5 text-[10px] ${
            suggested === 'yes'
              ? 'bg-emerald-600 ring-1 ring-emerald-300/60 hover:bg-emerald-500'
              : 'bg-emerald-600/80 hover:bg-emerald-500'
          }`}
          disabled={busySide === 'yes' || insight?.settled}
          onClick={() => onBuy(true)}
        >
          {busySide === 'yes' ? 'Buying…' : `Buy YES ${fmtCents(yesMicro)}`}
        </Button>
        <Button
          size="sm"
          className={`h-7 px-2.5 text-[10px] ${
            suggested === 'no'
              ? 'bg-rose-600 ring-1 ring-rose-300/60 hover:bg-rose-500'
              : 'bg-rose-600/80 hover:bg-rose-500'
          }`}
          disabled={busySide === 'no' || insight?.settled}
          onClick={() => onBuy(false)}
        >
          {busySide === 'no' ? 'Buying…' : `Buy NO ${fmtCents(noMicro)}`}
        </Button>
        {rules ? (
          <button
            type="button"
            onClick={() => setShowRules((v) => !v)}
            className="ml-auto text-[10px] text-zinc-500 underline decoration-dotted hover:text-zinc-300"
          >
            {showRules ? 'Hide rules' : 'Rules'}
          </button>
        ) : null}
      </div>

      {showRules && rules ? (
        <p className="mt-1.5 max-h-32 overflow-y-auto rounded border border-white/5 bg-black/30 px-2 py-1.5 text-[10px] leading-snug text-zinc-400">
          {rules}
        </p>
      ) : null}
    </div>
  )
}

type Props = {
  solAddress: string | null
}

export function JupiterPredictionsPanel({ solAddress }: Props) {
  const [events, setEvents] = useState<JupiterPredictionEvent[]>([])
  const [insights, setInsights] = useState<PredictionEventInsight[]>([])
  const [positions, setPositions] = useState<JupiterPredictionPosition[]>([])
  const [history, setHistory] = useState<HistoryRow[]>([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<'crypto' | 'sports' | 'politics'>('crypto')
  const [loading, setLoading] = useState(true)
  const [busyMarket, setBusyMarket] = useState<string | null>(null)
  const [claimBusy, setClaimBusy] = useState<string | null>(null)
  const [closeBusy, setCloseBusy] = useState<string | null>(null)
  const [buyAmount, setBuyAmount] = useState('10')
  const [edgeOnly, setEdgeOnly] = useState(false)

  // The stake drives the payout maths shown on every row, so it is sent with
  // the request rather than recomputed client-side.
  const stakeUsd = useMemo(() => {
    const n = Number.parseFloat(buyAmount)
    return Number.isFinite(n) && n >= 1 ? n : 10
  }, [buyAmount])

  const loadEvents = useCallback(async () => {
    setLoading(true)
    try {
      const q = search.trim()
      const res = q
        ? await dexJupiter.predictionsSearch(q, 12, stakeUsd)
        : await dexJupiter.predictionsEvents({ category, limit: 20, stakeUsd })
      setEvents(res.events)
      setInsights(res.insights ?? [])
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      toast.error(ax.response?.data?.error ?? 'Could not load prediction markets')
    } finally {
      setLoading(false)
    }
  }, [category, search, stakeUsd])

  const insightByMarket = useMemo(() => {
    const map = new Map<string, PredictionMarketInsight>()
    for (const ev of insights) {
      for (const m of ev.markets) map.set(m.marketId, m)
    }
    return map
  }, [insights])

  const edgeCount = useMemo(
    () => insights.filter((e) => e.topPick != null).length,
    [insights],
  )

  const visibleEvents = useMemo(() => {
    if (!edgeOnly) return events
    const withEdge = new Set(insights.filter((i) => i.topPick != null).map((i) => i.eventId))
    return events.filter((e) => withEdge.has(e.eventId))
  }, [events, insights, edgeOnly])

  const loadPositions = useCallback(async () => {
    try {
      const res = await dexJupiter.predictionsPositions()
      setPositions(res.positions)
    } catch {
      setPositions([])
    }
  }, [])

  const loadHistory = useCallback(async () => {
    try {
      const res = await dexJupiter.predictionsHistory(80)
      setHistory(res.events)
    } catch {
      setHistory([])
    }
  }, [])

  useEffect(() => {
    void loadEvents()
  }, [loadEvents])

  useEffect(() => {
    void loadPositions()
    void loadHistory()
    const id = window.setInterval(() => {
      void loadPositions()
      void loadHistory()
    }, 30_000)
    return () => window.clearInterval(id)
  }, [loadPositions, loadHistory])

  const lockedUsd = useMemo(() => {
    return positions.reduce((sum, p) => {
      if (p.claimed) return sum
      const cost = (Number.parseInt(p.totalCostUsd, 10) || 0) / 1_000_000
      const value =
        p.valueUsd != null ? (Number.parseInt(p.valueUsd, 10) || 0) / 1_000_000 : cost
      return sum + (Number.isFinite(value) ? value : cost)
    }, 0)
  }, [positions])

  const buy = async (marketId: string, isYes: boolean, title: string) => {
    const amountUsd = Number.parseFloat(buyAmount)
    if (!Number.isFinite(amountUsd) || amountUsd < 1) {
      toast.error('Enter at least $1')
      return
    }
    const insight = insightByMarket.get(marketId)
    const price = isYes ? insight?.yes.priceUsd : insight?.no.priceUsd
    const payout = price != null && price > 0 ? amountUsd / price : null

    const ok = window.confirm(
      [
        `${title}`,
        '',
        `Buying ${isYes ? 'YES' : 'NO'} with $${amountUsd.toFixed(2)} USDC.`,
        payout != null
          ? `If you are right you receive about $${payout.toFixed(2)} (profit $${(payout - amountUsd).toFixed(2)}).`
          : '',
        'If you are wrong the position settles at $0 and the USDC is lost.',
        '',
        'You can sell before settlement at the market price, which may be less than you paid.',
      ]
        .filter(Boolean)
        .join('\n'),
    )
    if (!ok) return
    setBusyMarket(`${marketId}:${isYes ? 'yes' : 'no'}`)
    try {
      const res = await dexJupiter.predictionsBuy({ marketId, isYes, amountUsd })
      toast.success(`${isYes ? 'YES' : 'NO'} position opened · ${res.txSignature.slice(0, 10)}…`)
      void loadPositions()
      void loadHistory()
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      toast.error(ax.response?.data?.error ?? 'Buy failed')
    } finally {
      setBusyMarket(null)
    }
  }

  const claim = async (positionPubkey: string, title: string, valueUsd: number | null) => {
    const ok = window.confirm(
      `Claim settled winnings for this prediction?\n\n"${title}"${
        valueUsd != null ? `\n\nPayout ≈ ${fmtUsd(valueUsd)} USDC to your Solana wallet.` : ''
      }\n\nOnly use Claim after the market has resolved. For open markets in profit, use Sell / Close instead.`,
    )
    if (!ok) return
    setClaimBusy(positionPubkey)
    try {
      const res = await dexJupiter.predictionsClaim(positionPubkey)
      toast.success(
        res.via === 'sell_fallback'
          ? `Position closed · ${res.txSignature.slice(0, 10)}…`
          : `Claimed · ${res.txSignature.slice(0, 10)}…`,
      )
      void loadPositions()
      void loadHistory()
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e: unknown) {
      toast.error(predictErrorMessage(e, 'Claim failed'))
    } finally {
      setClaimBusy(null)
    }
  }

  const closePos = async (positionPubkey: string, title: string) => {
    const ok = window.confirm(
      `Sell/close this prediction position now?\n\n"${title}"\n\nThis returns the current market value as USDC to your Solana wallet (may be less than you paid).`,
    )
    if (!ok) return
    setCloseBusy(positionPubkey)
    try {
      const res = await dexJupiter.predictionsClose(positionPubkey)
      toast.success(`Sold · USDC returning · ${res.txSignature.slice(0, 10)}…`)
      void loadPositions()
      void loadHistory()
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e: unknown) {
      toast.error(predictErrorMessage(e, 'Sell/close failed'))
    } finally {
      setCloseBusy(null)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto rounded-xl border border-white/10 bg-[#0a0a0f] p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="text-base font-semibold text-white">Prediction markets</h2>
      </div>

      {!solAddress ? (
        <p className="rounded-lg border border-white/10 bg-white/[0.02] px-3 py-2 text-xs text-zinc-400">
          Connect Solana wallet to trade predictions.
        </p>
      ) : null}

      <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
        <div className="flex items-center justify-between gap-2">
          <p className="text-[11px] font-semibold text-zinc-200">Your positions</p>
          <span className="font-mono text-[10px] text-zinc-500">locked ≈ {fmtUsd(lockedUsd)}</span>
        </div>
        {positions.length === 0 ? (
          <p className="mt-1 text-[10px] text-zinc-500">No open positions.</p>
        ) : (
          <div className="mt-2 space-y-2">
            {positions.map((p) => {
              const cost = (Number.parseInt(p.totalCostUsd, 10) || 0) / 1_000_000
              const pnl = p.pnlUsd != null ? Number.parseInt(p.pnlUsd, 10) / 1_000_000 : null
              const value =
                p.valueUsd != null ? Number.parseInt(p.valueUsd, 10) / 1_000_000 : null
              const title = p.marketMetadata?.title ?? p.eventMetadata?.title ?? p.marketId
              const canSellOpen = !p.claimed && p.valueUsd != null
              const canClaimSettled = p.claimable && !p.claimed && p.valueUsd == null
              return (
                <div
                  key={p.pubkey}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-white/5 bg-white/[0.02] px-2 py-2"
                >
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[11px] font-medium text-zinc-100">{title}</p>
                    <p className="font-mono text-[10px] text-zinc-500">
                      {p.isYes ? 'YES' : 'NO'} · {p.contracts} contracts · cost {fmtUsd(cost)}
                      {value != null ? ` · now ${fmtUsd(value)}` : ''}
                      {pnl != null ? ` · P&L ${pnl >= 0 ? '+' : ''}${fmtUsd(pnl)}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-1">
                    {canSellOpen ? (
                      <Button
                        size="sm"
                        className="h-7 bg-emerald-600 text-[10px] hover:bg-emerald-500"
                        disabled={closeBusy === p.pubkey}
                        onClick={() => void closePos(p.pubkey, title)}
                      >
                        {closeBusy === p.pubkey
                          ? 'Selling…'
                          : pnl != null && pnl > 0
                            ? `Sell / Close (+${fmtUsd(pnl)})`
                            : 'Sell / Close'}
                      </Button>
                    ) : null}
                    {canClaimSettled ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-emerald-500/40 px-2 text-[10px] text-emerald-200 hover:bg-emerald-500/10"
                        disabled={claimBusy === p.pubkey}
                        onClick={() => void claim(p.pubkey, title, value)}
                      >
                        {claimBusy === p.pubkey ? 'Claiming…' : 'Claim USDC'}
                      </Button>
                    ) : null}
                    {!canSellOpen && !canClaimSettled && !p.claimed ? (
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 border-white/15 px-2 text-[10px] text-zinc-300 hover:bg-white/5"
                        disabled={closeBusy === p.pubkey}
                        onClick={() => void closePos(p.pubkey, title)}
                      >
                        {closeBusy === p.pubkey ? 'Selling…' : 'Sell / Close'}
                      </Button>
                    ) : null}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
        <p className="text-[11px] font-semibold text-zinc-200">Predict trade log</p>
        {history.length === 0 ? (
          <p className="mt-1 text-[10px] text-zinc-500">No trades yet.</p>
        ) : (
          <div className="mt-2 max-h-40 overflow-y-auto">
            <table className="w-full text-left text-[10px]">
              <thead className="sticky top-0 bg-[#0a0a0f] text-zinc-500">
                <tr>
                  <th className="px-1 py-1 font-medium">When</th>
                  <th className="px-1 py-1 font-medium">Action</th>
                  <th className="px-1 py-1 font-medium">Market</th>
                  <th className="px-1 py-1 font-medium">Cost</th>
                  <th className="px-1 py-1 font-medium">Proceeds</th>
                  <th className="px-1 py-1 font-medium">P&L</th>
                  <th className="px-1 py-1 font-medium">Tx</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5 text-zinc-300">
                {history.map((h) => (
                  <tr key={h.id}>
                    <td className="whitespace-nowrap px-1 py-1 text-zinc-500">{timeAgo(h.timestamp)}</td>
                    <td className="px-1 py-1">
                      <span
                        className={
                          h.action === 'BUY'
                            ? 'text-emerald-300'
                            : h.action === 'SELL'
                              ? 'text-rose-300'
                              : 'text-violet-300'
                        }
                      >
                        {h.action}
                        {h.isYes != null ? (h.isYes ? ' YES' : ' NO') : ''}
                      </span>
                    </td>
                    <td className="max-w-[120px] truncate px-1 py-1 text-zinc-400" title={h.title}>
                      {h.title ?? '—'}
                    </td>
                    <td className="px-1 py-1 font-mono">
                      {h.costUsd != null ? fmtUsd(h.costUsd) : h.action === 'BUY' ? fmtUsd(h.amountUsd) : '—'}
                    </td>
                    <td className="px-1 py-1 font-mono">
                      {h.proceedsUsd != null
                        ? fmtUsd(h.proceedsUsd)
                        : h.action !== 'BUY'
                          ? fmtUsd(h.amountUsd)
                          : '—'}
                    </td>
                    <td className="px-1 py-1 font-mono">
                      {h.pnlUsd != null ? (
                        <span className={h.pnlUsd >= 0 ? 'text-emerald-300' : 'text-rose-300'}>
                          {h.pnlUsd >= 0 ? '+' : ''}
                          {fmtUsd(h.pnlUsd)}
                        </span>
                      ) : (
                        '—'
                      )}
                    </td>
                    <td className="px-1 py-1 font-mono text-zinc-500">
                      {h.txSignature ? `${h.txSignature.slice(0, 8)}…` : '—'}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div className="flex gap-1 rounded-lg border border-white/10 p-0.5">
          {(['crypto', 'sports', 'politics'] as const).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => {
                setSearch('')
                setCategory(c)
              }}
              className={`rounded-md px-2.5 py-1 text-[10px] capitalize ${
                category === c && !search.trim()
                  ? 'bg-violet-600 text-white'
                  : 'text-zinc-400 hover:bg-white/5'
              }`}
            >
              {c}
            </button>
          ))}
        </div>
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search events…"
          className="h-8 max-w-xs border-white/10 bg-black/40 text-xs"
        />
        <label className="text-[10px] text-zinc-500">
          Stake $
          <Input
            value={buyAmount}
            onChange={(e) => setBuyAmount(e.target.value)}
            className="mt-0.5 h-8 w-20 border-white/10 bg-black/40 font-mono text-xs"
          />
        </label>
        <button
          type="button"
          onClick={() => setEdgeOnly((v) => !v)}
          className={`h-8 rounded-md border px-2.5 text-[10px] transition ${
            edgeOnly
              ? 'border-emerald-500/40 bg-emerald-500/10 text-emerald-200'
              : 'border-white/10 text-zinc-400 hover:bg-white/5'
          }`}
        >
          {edgeOnly ? 'Showing edges only' : `Edges found: ${edgeCount}`}
        </button>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Loading…</p>
      ) : visibleEvents.length === 0 ? (
        <p className="text-sm text-zinc-500">No markets found.</p>
      ) : (
        <div className="space-y-3">
          {visibleEvents.map((ev) => {
            const title = ev.metadata?.title ?? 'Event'
            const subtitle = ev.metadata?.subtitle
            const imageUrl = ev.metadata?.imageUrl
            const eventInsight = insights.find((i) => i.eventId === ev.eventId)
            const markets = (ev.markets ?? []).filter((m) => m?.marketId)
            return (
              <div key={ev.eventId} className="rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex flex-wrap items-start gap-2">
                  {imageUrl ? (
                    // Jupiter serves these from arbitrary hosts, which next/image
                    // cannot optimise without whitelisting each one.
                    <img src={imageUrl} alt="" className="h-10 w-10 rounded-lg object-cover" />
                  ) : null}
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-semibold text-white">{title}</p>
                    <p className="mt-0.5 text-[10px] text-zinc-500">
                      {subtitle ? `${subtitle} · ` : ''}
                      {ev.provider ? `${ev.provider} liquidity` : 'Polymarket / Kalshi liquidity'}
                    </p>
                  </div>
                  {eventInsight?.topPick ? (
                    <span className="shrink-0 rounded border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-200">
                      Edge on {eventInsight.topPick.side}
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 space-y-1.5">
                  {markets.map((m) => (
                    <MarketRow
                      key={m.marketId}
                      insight={insightByMarket.get(m.marketId) ?? null}
                      yesMicro={m.pricing.buyYesPriceUsd}
                      noMicro={m.pricing.buyNoPriceUsd}
                      rules={
                        m.metadata?.closeCondition ??
                        m.metadata?.rulesPrimary ??
                        ev.metadata?.closeCondition ??
                        ev.metadata?.rulesPrimary
                      }
                      busySide={
                        busyMarket === `${m.marketId}:yes`
                          ? 'yes'
                          : busyMarket === `${m.marketId}:no`
                            ? 'no'
                            : null
                      }
                      onBuy={(isYes) =>
                        void buy(
                          m.marketId,
                          isYes,
                          insightByMarket.get(m.marketId)?.plainQuestion ??
                            `${title} · ${m.metadata?.title ?? ''}`,
                        )
                      }
                    />
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}
