'use client'

/**
 * Specialist AI Agent Council — Execution / Liquidity / Momentum / Risk / Flow /
 * News / Portfolio / LLM Summary. Maps live council votes + execution confidence
 * into the specialist board the product promised (without changing trade path).
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import {
  dexJupiter,
  engine,
  type CouncilDecision,
  type CouncilStatus,
  type ExecutionCompareResult,
  type JupiterSuperMachineStatus,
} from '@/lib/api'
import { useSocket } from '@/hooks/useSocket'
import { cn } from '@/lib/utils'

type SpecialistId =
  | 'execution'
  | 'liquidity'
  | 'momentum'
  | 'risk'
  | 'flow'
  | 'news'
  | 'portfolio'
  | 'llm'
  | 'orderbook'
  | 'volatility'
  | 'regime'
  | 'sizing'
  | 'venue'
  | 'compliance'
  | 'cex_spot'
  | 'jupiter_dex'

type SpecialistCard = {
  id: SpecialistId
  label: string
  role: string
  score: number | null
  signal: 'GO' | 'WAIT' | 'BLOCK' | 'WATCH'
  detail: string
  source: string
  accuracyPct?: number | null
  samples?: number
  weight?: number
}

const VOTE_STYLES: Record<string, string> = {
  BUY: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  HOLD: 'bg-zinc-500/15 text-zinc-300 border-zinc-500/40',
  AVOID: 'bg-red-500/15 text-red-300 border-red-500/40',
  GO: 'bg-emerald-500/15 text-emerald-300 border-emerald-500/40',
  WAIT: 'bg-amber-500/15 text-amber-300 border-amber-500/40',
  BLOCK: 'bg-red-500/15 text-red-300 border-red-500/40',
  WATCH: 'bg-sky-500/15 text-sky-300 border-sky-500/40',
}

function timeAgo(iso: string): string {
  const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000)
  if (s < 60) return `${Math.floor(s)}s ago`
  if (s < 3600) return `${Math.floor(s / 60)}m ago`
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`
  return new Date(iso).toLocaleDateString()
}

function pct(v: number | null | undefined, digits = 0): string {
  return v == null ? '—' : `${v.toFixed(digits)}%`
}

function signalFromScore(score: number | null, invert = false): SpecialistCard['signal'] {
  if (score == null) return 'WATCH'
  const s = invert ? 100 - score : score
  if (s >= 75) return 'GO'
  if (s >= 55) return 'WAIT'
  return 'BLOCK'
}

function voteToSignal(vote?: { vote: string; confidence: number } | null): SpecialistCard['signal'] {
  if (!vote || vote.confidence === 0) return 'WATCH'
  if (vote.vote === 'BUY') return vote.confidence >= 0.55 ? 'GO' : 'WAIT'
  if (vote.vote === 'AVOID') return 'BLOCK'
  return 'WAIT'
}

function buildSpecialists(opts: {
  status: CouncilStatus | null
  cexStatus: CouncilStatus | null
  compare: ExecutionCompareResult | null
  sm: JupiterSuperMachineStatus | null
  venue: 'jupiter' | 'cex' | 'all'
}): SpecialistCard[] {
  const { status, cexStatus, compare, sm, venue } = opts
  const agents = (venue === 'cex' ? cexStatus?.agents : status?.agents) ?? status?.agents ?? []
  const byId = Object.fromEntries(agents.map((a) => [a.id, a]))
  const conf = compare?.confidence
  const best = compare?.best
  const last = (venue === 'cex' ? cexStatus?.lastDecision : status?.lastDecision) ?? status?.lastDecision

  const momentum = byId.momentum
  const sentiment = byId.sentiment
  const technical = byId.technical
  const risk = byId.risk
  const llm = byId.llm
  const orderbook = byId.orderbook
  const volatility = byId.volatility

  const execScore = conf?.execution ?? (best ? Math.round(best.score) : null)
  const liqScore = conf?.liquidity ?? null
  const momScore =
    conf?.momentum ??
    (momentum?.lastVote ? Math.round(momentum.lastVote.confidence * 100) : null)
  const spreadScore = conf?.spread ?? null

  const openPos = sm?.runtime?.openPositions ?? 0
  const maxPos = sm?.settings?.maxOpenPositions ?? 2
  const portfolioScore =
    maxPos > 0 ? Math.round(Math.max(0, Math.min(100, (1 - openPos / maxPos) * 100))) : null

  const flowScore =
    technical?.lastVote != null
      ? Math.round(technical.lastVote.confidence * 100)
      : spreadScore

  const perf = (id: string) => {
    const a = byId[id]
    return { accuracyPct: a?.accuracyPct ?? null, samples: a?.samples ?? 0, weight: a?.weight }
  }

  const cards: SpecialistCard[] = [
    {
      id: 'execution',
      label: 'Execution Agent',
      role: 'Router quality · latency · fill score',
      score: execScore,
      signal: best?.canExecute ? signalFromScore(execScore) : execScore == null ? 'WATCH' : 'BLOCK',
      detail: best
        ? `Best path: ${best.label} · ${best.explanation.slice(0, 120)}`
        : 'Waiting for live route compare on Solana…',
      source: 'execution engine',
    },
    {
      id: 'liquidity',
      label: 'Liquidity Agent',
      role: 'Pool depth · impact · TVL proxy',
      score: liqScore,
      signal: signalFromScore(liqScore),
      detail:
        liqScore != null
          ? `Liquidity confidence ${liqScore}% · impact-aware sizing`
          : 'Enable a quote on Solana to score pool depth.',
      source: 'execution engine',
    },
    {
      id: 'momentum',
      label: 'Momentum Agent',
      role: '5m · 15m · 1h trend',
      score: momScore,
      signal: voteToSignal(momentum?.lastVote) ?? signalFromScore(momScore),
      detail: momentum?.lastVote?.reason ?? 'Scanning momentum…',
      source: 'council · momentum',
      ...perf('momentum'),
    },
    {
      id: 'risk',
      label: 'Risk Agent',
      role: 'Rug / authority · concentration gates',
      score: risk?.lastVote ? Math.round(risk.lastVote.confidence * 100) : null,
      signal: voteToSignal(risk?.lastVote),
      detail: risk?.lastVote?.reason ?? 'Meta-policy + regime gates stand by.',
      source: 'council · risk',
      ...perf('risk'),
    },
    {
      id: 'flow',
      label: 'Technical Flow',
      role: 'EMA · RSI · tape structure',
      score: flowScore,
      signal: voteToSignal(technical?.lastVote) ?? signalFromScore(flowScore),
      detail: technical?.lastVote?.reason ?? 'Reading candles + spread…',
      source: 'council · technical',
      ...perf('technical'),
    },
    {
      id: 'news',
      label: 'News / Sentiment',
      role: 'Catalysts · news tone',
      score: sentiment?.lastVote ? Math.round(sentiment.lastVote.confidence * 100) : null,
      signal: voteToSignal(sentiment?.lastVote),
      detail: sentiment?.lastVote?.reason ?? 'Oracle sentiment idle — Super Machine feeds this.',
      source: 'council · sentiment',
      ...perf('sentiment'),
    },
    {
      id: 'orderbook',
      label: 'Order Book Agent',
      role: 'OBI · bid/ask pressure',
      score: orderbook?.lastVote ? Math.round(orderbook.lastVote.confidence * 100) : null,
      signal: voteToSignal(orderbook?.lastVote),
      detail: orderbook?.lastVote?.reason ?? 'Depth imbalance warms up with Super Machine ticks.',
      source: 'council · orderbook',
      ...perf('orderbook'),
    },
    {
      id: 'volatility',
      label: 'Volatility Agent',
      role: 'Regime · chop vs trend',
      score: volatility?.lastVote ? Math.round(volatility.lastVote.confidence * 100) : null,
      signal: voteToSignal(volatility?.lastVote),
      detail: volatility?.lastVote?.reason ?? 'Waiting for vol regime vote…',
      source: 'council · volatility',
      ...perf('volatility'),
    },
    {
      id: 'regime',
      label: 'Macro Regime',
      role: 'Risk-on / risk-off filter',
      score: last?.regime === 'risk_on' ? 72 : last?.regime === 'neutral' ? 50 : 40,
      signal: last?.regime === 'risk_on' ? 'GO' : last?.regime ? 'WAIT' : 'WATCH',
      detail: last ? `Last regime: ${last.regime}` : 'Regime inferred from council cycle.',
      source: 'council meta',
    },
    {
      id: 'sizing',
      label: 'Position Sizing',
      role: 'Max trade · free cash · caps',
      score: last?.orderSizeUsd ? Math.min(100, Math.round(last.orderSizeUsd * 4)) : portfolioScore,
      signal: last?.orderSizeUsd && last.orderSizeUsd >= 5 ? 'GO' : 'WAIT',
      detail: last?.orderSizeUsd
        ? `Last approved size $${last.orderSizeUsd.toFixed(2)}`
        : 'Size gated by risk + free balance.',
      source: 'risk / SM',
    },
    {
      id: 'venue',
      label: 'Venue Ranker',
      role: 'CEX vs DEX route quality',
      score: execScore ?? (venue === 'cex' ? 70 : null),
      signal: venue === 'cex' ? 'GO' : best?.canExecute ? 'GO' : 'WATCH',
      detail:
        venue === 'cex'
          ? 'Binance spot order book venue active for Binance Super Machine.'
          : best
            ? `Jupiter path: ${best.label}`
            : 'Compares Solana DEX routes when quoting.',
      source: 'execution / CEX',
    },
    {
      id: 'compliance',
      label: 'Compliance Gate',
      role: 'Key perms · withdraw-off · readiness',
      score: risk?.lastVote?.vote === 'AVOID' ? 20 : 85,
      signal: risk?.lastVote?.vote === 'AVOID' ? 'BLOCK' : 'GO',
      detail: 'Trade-only keys, risk limits, and vetoes must clear before Super Machine buys.',
      source: 'risk / ops',
    },
    {
      id: 'cex_spot',
      label: 'CEX Spot Specialist',
      role: 'Binance majors · hub signals',
      score: cexStatus?.lastDecision
        ? Math.round(cexStatus.lastDecision.consensus * 100)
        : null,
      signal: cexStatus?.lastDecision?.action === 'BUY' ? 'GO' : 'WATCH',
      detail: cexStatus?.lastDecision?.reasons?.[0] ?? 'Enable Binance Super Machine to feed CEX council.',
      source: 'binance-cex council',
    },
    {
      id: 'jupiter_dex',
      label: 'Jupiter DEX Specialist',
      role: 'Solana trending · Metis routes',
      score: status?.lastDecision ? Math.round(status.lastDecision.consensus * 100) : null,
      signal: status?.lastDecision?.action === 'BUY' ? 'GO' : 'WATCH',
      detail: status?.lastDecision?.reasons?.[0] ?? 'Enable Jupiter Super Machine on Solana.',
      source: 'jupiter council',
    },
    {
      id: 'portfolio',
      label: 'Portfolio Agent',
      role: 'Open risk · daily caps · exposure',
      score: portfolioScore,
      signal:
        sm?.settings?.emergencyStop
          ? 'BLOCK'
          : openPos >= maxPos
            ? 'WAIT'
            : signalFromScore(portfolioScore),
      detail: sm
        ? `${openPos}/${maxPos} positions · ${sm.runtime.tradesToday} trades today · vol $${Number(sm.runtime.volumeTodayUsd).toFixed(0)}`
        : 'Load Super Machine status for exposure caps.',
      source: 'super machine',
    },
    {
      id: 'llm',
      label: 'LLM Strategist',
      role: 'Summarizes evidence — weighted vote',
      score: llm?.lastVote ? Math.round(llm.lastVote.confidence * 100) : conf?.overall ?? null,
      signal:
        llm?.lastVote && llm.lastVote.confidence > 0 ? voteToSignal(llm.lastVote) : 'WATCH',
      detail:
        llm?.lastVote && llm.lastVote.confidence > 0
          ? llm.lastVote.reason
          : compare?.aiExplanation?.slice(0, 160) ??
            (status?.llmConfigured || cexStatus?.llmConfigured
              ? 'LLM connected — awaiting next council cycle.'
              : 'Rule-based summary active (no LLM key).'),
      source: 'council · llm',
      ...perf('llm'),
    },
  ]

  return cards
}

function SpecialistTile({ card }: { card: SpecialistCard }) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/10 bg-white/[0.03] p-4 transition-colors hover:border-emerald-500/25">
      <div className="flex items-start justify-between gap-2">
        <div className="text-sm font-semibold text-white">{card.label}</div>
        <span className={cn('shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-bold', VOTE_STYLES[card.signal])}>
          {card.signal}
        </span>
      </div>
      <div className="flex items-end justify-between">
        <span className="text-[10px] uppercase tracking-wider text-zinc-600">Confidence</span>
        <span
          className={cn(
            'font-mono text-2xl font-bold tabular-nums',
            card.score == null
              ? 'text-zinc-600'
              : card.score >= 75
                ? 'text-emerald-300'
                : card.score >= 55
                  ? 'text-amber-300'
                  : 'text-rose-300',
          )}
        >
          {card.score == null ? '—' : `${card.score}`}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-white/5">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-500',
            card.signal === 'GO'
              ? 'bg-emerald-400'
              : card.signal === 'BLOCK'
                ? 'bg-red-400'
                : card.signal === 'WAIT'
                  ? 'bg-amber-400'
                  : 'bg-sky-400',
          )}
          style={{ width: `${card.score ?? 8}%` }}
        />
      </div>
      <p className="text-[11px] leading-snug text-zinc-400">{card.detail}</p>
      <div className="mt-auto text-[9px] uppercase tracking-wider text-zinc-600">{card.source}</div>
    </div>
  )
}

function ConsensusMeter({ decision }: { decision: CouncilDecision }) {
  const consensusPct = decision.consensus * 100
  const barPct = decision.threshold * 100
  return (
    <div className="rounded-xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium uppercase tracking-wider text-zinc-400">
          Latest council decision
        </span>
        <span className="text-[10px] text-zinc-500">{timeAgo(decision.timestamp)}</span>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-3">
        <span
          className={cn(
            'rounded-lg border px-3 py-1.5 text-sm font-bold',
            decision.action === 'BUY' ? VOTE_STYLES.BUY : VOTE_STYLES.HOLD,
          )}
        >
          {decision.action}
        </span>
        {decision.symbol && <span className="text-lg font-semibold text-white">{decision.symbol}</span>}
        {decision.orderSizeUsd > 0 && (
          <span className="text-sm text-emerald-300">${decision.orderSizeUsd.toFixed(2)}</span>
        )}
        <span className="ml-auto text-[11px] text-zinc-500">regime {decision.regime}</span>
      </div>
      <div className="relative mt-3 h-3 overflow-hidden rounded-full bg-white/5">
        <div
          className={cn(
            'h-full rounded-full transition-all duration-700',
            consensusPct >= barPct ? 'bg-emerald-400' : 'bg-violet-400/70',
          )}
          style={{ width: `${consensusPct}%` }}
        />
        <div
          className="absolute inset-y-0 w-0.5 bg-amber-300"
          style={{ left: `${barPct}%` }}
          title="adaptive entry bar"
        />
      </div>
      <div className="mt-1 flex justify-between text-[10px] text-zinc-500">
        <span>consensus {pct(consensusPct)}</span>
        <span className="text-amber-300/90">entry bar {pct(barPct)}</span>
      </div>
      <ul className="mt-3 space-y-1">
        {decision.reasons.slice(0, 4).map((r, i) => (
          <li key={i} className="text-[11px] text-zinc-400">
            {r}
          </li>
        ))}
        {decision.vetoedBy && (
          <li className="text-[11px] font-semibold text-red-300">
            Veto exercised by {decision.vetoedBy}
          </li>
        )}
      </ul>
    </div>
  )
}

export default function AgentsPage() {
  const [status, setStatus] = useState<CouncilStatus | null>(null)
  const [cexStatus, setCexStatus] = useState<CouncilStatus | null>(null)
  const [decisions, setDecisions] = useState<CouncilDecision[]>([])
  const [compare, setCompare] = useState<ExecutionCompareResult | null>(null)
  const [sm, setSm] = useState<JupiterSuperMachineStatus | null>(null)
  const [venue, setVenue] = useState<'jupiter' | 'cex' | 'all'>('all')
  const [live, setLive] = useState(false)
  const liveTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const socket = useSocket()

  const refresh = useCallback(async (mode: 'fast' | 'full' = 'full') => {
    try {
      if (mode === 'fast') {
        const [s, cex] = await Promise.all([
          dexJupiter.councilStatus(),
          engine.cexCouncilStatus().catch(() => null),
        ])
        setStatus(s)
        if (cex) {
          setCexStatus({
            agents: cex.agents as CouncilStatus['agents'],
            llmConfigured: cex.llmConfigured,
            threshold: cex.threshold,
            rollingWinRatePct: null,
            winRateSamples: 0,
            winRateTarget: { min: 65, max: 70 },
            lastDecision: cex.lastDecision,
          })
        }
        void dexJupiter.councilDecisions(20).then((d) => setDecisions(d.decisions)).catch(() => null)
        void dexJupiter.superMachineStatus().then(setSm).catch(() => null)
        return
      }

      const [s, d, smRes, cex] = await Promise.all([
        dexJupiter.councilStatus(),
        dexJupiter.councilDecisions(40),
        dexJupiter.superMachineStatus().catch(() => null),
        engine.cexCouncilStatus().catch(() => null),
      ])
      setStatus(s)
      setDecisions(d.decisions)
      if (smRes) setSm(smRes)
      if (cex) {
        setCexStatus({
          agents: cex.agents as CouncilStatus['agents'],
          llmConfigured: cex.llmConfigured,
          threshold: cex.threshold,
          rollingWinRatePct: null,
          winRateSamples: 0,
          winRateTarget: { min: 65, max: 70 },
          lastDecision: cex.lastDecision,
        })
      }

      const sym = s.lastDecision?.symbol ?? d.decisions[0]?.symbol ?? 'SOLUSDT'
      void dexJupiter
        .executionCompare({
          side: 'BUY',
          binanceSymbol: sym,
          amount: smRes?.settings?.maxTradeUsd ?? 25,
          includeSecondary: false,
        })
        .then(setCompare)
        .catch(() => null)
    } catch {
      /* keep last good snapshot */
    }
  }, [])

  useEffect(() => {
    void refresh('fast')
    const t = setInterval(() => void refresh('full'), 20_000)
    return () => clearInterval(t)
  }, [refresh])

  useEffect(() => {
    if (!socket) return
    const onDecision = (d: CouncilDecision) => {
      setDecisions((prev) => [d, ...prev.filter((x) => x.id !== d.id)].slice(0, 80))
      setStatus((prev) => (prev ? { ...prev, lastDecision: d } : prev))
      setLive(true)
      if (liveTimer.current) clearTimeout(liveTimer.current)
      liveTimer.current = setTimeout(() => setLive(false), 4000)
    }
    const onCex = (d: CouncilDecision) => {
      setCexStatus((prev) =>
        prev
          ? { ...prev, lastDecision: d, agents: prev.agents }
          : {
              agents: [],
              llmConfigured: false,
              threshold: 0.62,
              rollingWinRatePct: null,
              winRateSamples: 0,
              winRateTarget: { min: 65, max: 70 },
              lastDecision: d,
            },
      )
      setLive(true)
    }
    socket.on('council:decision', onDecision)
    socket.on('cex-council:decision', onCex)
    return () => {
      socket.off('council:decision', onDecision)
      socket.off('cex-council:decision', onCex)
    }
  }, [socket])

  const specialists = useMemo(
    () => buildSpecialists({ status, cexStatus, compare, sm, venue }),
    [status, cexStatus, compare, sm, venue],
  )
  const lastDecision =
    venue === 'cex'
      ? cexStatus?.lastDecision ?? null
      : decisions[0] ?? status?.lastDecision ?? null
  const overall = compare?.confidence?.overall ?? null
  const entryBar = venue === 'cex' ? cexStatus?.threshold : status?.threshold

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h1 className="flex items-center gap-2 text-xl font-bold text-white">
            AI Agent Council
            <span
              className={cn(
                'inline-flex h-2.5 w-2.5 rounded-full transition-colors',
                live ? 'animate-pulse bg-emerald-400' : 'bg-zinc-600',
              )}
            />
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[11px]">
          {(['all', 'jupiter', 'cex'] as const).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setVenue(v)}
              className={cn(
                'rounded-full border px-2.5 py-1 capitalize',
                venue === v
                  ? 'border-violet-500/50 bg-violet-500/15 text-violet-200'
                  : 'border-white/10 text-zinc-400 hover:bg-white/5',
              )}
            >
              {v === 'cex' ? 'Binance' : v === 'jupiter' ? 'Solana' : 'All venues'}
            </button>
          ))}
          {overall != null ? (
            <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 font-mono text-emerald-300">
              confidence {overall}%
            </span>
          ) : null}
          {entryBar != null && (
            <span className="rounded-full border border-violet-500/40 bg-violet-500/10 px-2.5 py-1 text-violet-300">
              entry bar {pct(entryBar * 100)}
            </span>
          )}
          <Link
            href="/dex-jupiter"
            className="rounded-full border border-white/10 px-2.5 py-1 text-zinc-300 hover:bg-white/5"
          >
            Jupiter SM →
          </Link>
          <Link
            href="/trading"
            className="rounded-full border border-sky-500/30 px-2.5 py-1 text-sky-200 hover:bg-sky-500/10"
          >
            Binance →
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {specialists.map((c) => (
          <SpecialistTile key={c.id} card={c} />
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {lastDecision ? (
          <ConsensusMeter decision={lastDecision} />
        ) : (
          <div className="flex items-center justify-center rounded-xl border border-white/10 bg-white/[0.03] p-6 text-sm text-zinc-600">
            No decisions yet
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/10 bg-white/[0.03]">
        <div className="flex items-center justify-between border-b border-white/5 px-4 py-3">
          <h2 className="text-sm font-semibold text-white">Decision history</h2>
        </div>
        <div className="max-h-[360px] overflow-y-auto">
          {decisions.length === 0 ? (
            <div className="p-6 text-center text-xs text-zinc-600">No decisions recorded</div>
          ) : (
                <table className="w-full text-left text-[11px]">
                  <thead className="sticky top-0 bg-[#0d0d14] text-[10px] uppercase tracking-wider text-zinc-500">
                    <tr>
                      <th className="px-4 py-2">Time</th>
                      <th className="px-2 py-2">Token</th>
                      <th className="px-2 py-2">Action</th>
                      <th className="px-2 py-2">Consensus</th>
                      <th className="hidden px-2 py-2 md:table-cell">Why</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-white/5">
                    {decisions.map((d) => (
                      <tr key={d.id} className="text-zinc-300 hover:bg-white/[0.02]">
                        <td className="whitespace-nowrap px-4 py-2 text-zinc-500">
                          {timeAgo(d.timestamp)}
                        </td>
                        <td className="px-2 py-2 font-semibold text-white">{d.symbol ?? '—'}</td>
                        <td className="px-2 py-2">
                          <span
                            className={cn(
                              'rounded border px-1.5 py-0.5 text-[10px] font-bold',
                              d.action === 'BUY' ? VOTE_STYLES.BUY : VOTE_STYLES.HOLD,
                            )}
                          >
                            {d.action}
                            {d.tradeId ? ' ✓' : ''}
                          </span>
                        </td>
                        <td className="whitespace-nowrap px-2 py-2 tabular-nums">
                          <span
                            className={
                              d.consensus >= d.threshold ? 'text-emerald-300' : 'text-zinc-400'
                            }
                          >
                            {(d.consensus * 100).toFixed(0)}%
                          </span>
                          <span className="text-zinc-600"> / {(d.threshold * 100).toFixed(0)}%</span>
                        </td>
                        <td
                          className="hidden max-w-[380px] truncate px-2 py-2 text-zinc-500 md:table-cell"
                          title={d.reasons.join(' · ')}
                        >
                          {d.reasons[0] ?? ''}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
    </div>
  )
}
