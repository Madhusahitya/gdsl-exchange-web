'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { engine, type TradeAdvisory, type AdvisorySeverity } from '@/lib/api'

type Props = {
  symbol: string
  side: 'BUY' | 'SELL'
  sizeUsdt: number
  accountEquityUsdt?: number | null
  /** Auto-refresh window for re-checking the advisory. Default 20s. */
  pollIntervalMs?: number
  /** Called whenever advisory updates. UI uses this to enable/disable submit buttons. */
  onAdvisoryChange?: (advisory: TradeAdvisory | null) => void
  /** Compact mode hides the loss-projection block. */
  compact?: boolean
}

function severityClasses(s: AdvisorySeverity) {
  if (s === 'block') {
    return {
      border: 'border-rose-500/40',
      bg: 'bg-rose-500/10',
      text: 'text-rose-200',
      label: 'BLOCK',
      labelClass: 'bg-rose-500/30 text-rose-100',
    }
  }
  if (s === 'warning') {
    return {
      border: 'border-amber-500/40',
      bg: 'bg-amber-500/10',
      text: 'text-amber-200',
      label: 'CAUTION',
      labelClass: 'bg-amber-500/30 text-amber-100',
    }
  }
  return {
    border: 'border-emerald-500/30',
    bg: 'bg-emerald-500/5',
    text: 'text-emerald-200',
    label: 'OK',
    labelClass: 'bg-emerald-500/25 text-emerald-100',
  }
}

export function TradeAdvisor({
  symbol,
  side,
  sizeUsdt,
  accountEquityUsdt,
  pollIntervalMs = 20_000,
  onAdvisoryChange,
  compact = false,
}: Props) {
  const [advisory, setAdvisory] = useState<TradeAdvisory | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const callbackRef = useRef(onAdvisoryChange)

  useEffect(() => {
    callbackRef.current = onAdvisoryChange
  }, [onAdvisoryChange])

  const refresh = useCallback(async () => {
    if (!symbol || !Number.isFinite(sizeUsdt) || sizeUsdt <= 0) {
      setAdvisory(null)
      callbackRef.current?.(null)
      return
    }
    setLoading(true)
    setErr(null)
    try {
      const result = await engine.tradeAdvice({
        symbol,
        side,
        sizeUsdt,
        accountEquityUsdt: accountEquityUsdt ?? null,
      })
      setAdvisory(result)
      callbackRef.current?.(result)
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Trade advisor unavailable'
      setErr(msg)
      callbackRef.current?.(null)
    } finally {
      setLoading(false)
    }
  }, [symbol, side, sizeUsdt, accountEquityUsdt])

  useEffect(() => {
    const timer = setTimeout(() => {
      void refresh()
    }, 350)

    const onRefresh = () => {
      void refresh()
    }
    window.addEventListener('dashboard:refresh', onRefresh)
    window.addEventListener('trade:executed', onRefresh)

    return () => {
      clearTimeout(timer)
      window.removeEventListener('dashboard:refresh', onRefresh)
      window.removeEventListener('trade:executed', onRefresh)
    }
  }, [refresh])

  if (!sizeUsdt || sizeUsdt <= 0) return null

  if (err) {
    return (
      <div className="rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
        Signal advisor unavailable: {err}
      </div>
    )
  }

  if (!advisory) {
    return (
      <div className="rounded-md border border-zinc-700 bg-zinc-900/40 px-3 py-2 text-xs text-zinc-400">
        {loading ? 'Checking signals against trade…' : 'Awaiting signal advisor…'}
      </div>
    )
  }

  const styles = severityClasses(advisory.highestSeverity)
  const blocking = advisory.reasons.filter((r) => r.severity === 'block')
  const warnings = advisory.reasons.filter((r) => r.severity === 'warning')
  const infos = advisory.reasons.filter((r) => r.severity === 'info')

  return (
    <div className={`rounded-lg border ${styles.border} ${styles.bg} px-3 py-3 text-xs`}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className={`rounded-md px-2 py-0.5 text-[10px] font-semibold tracking-wide ${styles.labelClass}`}>
            {styles.label}
          </span>
          <span className={`font-mono ${styles.text}`}>
            {advisory.symbol} · {advisory.side} · {advisory.decision.toUpperCase()}
          </span>
        </div>
        <span className="text-[10px] text-zinc-500">
          {new Date(advisory.evaluatedAt).toLocaleTimeString()}
        </span>
      </div>

      {!compact ? (
        <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-zinc-300 sm:grid-cols-4">
          <div>
            <p className="text-[10px] uppercase text-zinc-500">
              {advisory.decision === 'block' ? 'Strategy size' : 'Recommended size'}
            </p>
            <p className="font-mono text-white">
              {advisory.decision === 'block'
                ? 'Hold (do not buy)'
                : advisory.recommendedSizeUsdt > 0
                  ? `$${advisory.recommendedSizeUsdt.toFixed(2)}`
                  : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-zinc-500">Worst-case loss</p>
            <p className="font-mono text-white">
              {advisory.projectedWorstCaseLossUsdt !== null
                ? `$${advisory.projectedWorstCaseLossUsdt.toFixed(2)}`
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-zinc-500">Adverse move</p>
            <p className="font-mono text-white">
              {advisory.expectedAdverseMovePct !== null
                ? `${advisory.expectedAdverseMovePct.toFixed(2)}%`
                : '—'}
            </p>
          </div>
          <div>
            <p className="text-[10px] uppercase text-zinc-500">Cap of capital</p>
            <p className="font-mono text-white">{(advisory.capitalCapPct * 100).toFixed(1)}%</p>
          </div>
        </div>
      ) : null}

      {advisory.decision === 'block' ? (
        <p className="mt-2 rounded-md border border-rose-500/20 bg-rose-500/5 px-2.5 py-1.5 text-[11px] leading-snug text-rose-100/90">
          BLOCK is now reserved for real emergencies (operator kill switch,
          strong opposing trend, losing-streak cooldown). Both{' '}
          <span className="font-mono text-white">Strategy BUY</span> and{' '}
          <span className="font-mono text-white">Manual BUY</span> stay clickable
          — the platform respects your call.
        </p>
      ) : null}
      {advisory.decision === 'caution' ? (
        <p className="mt-2 rounded-md border border-amber-500/20 bg-amber-500/5 px-2.5 py-1.5 text-[11px] leading-snug text-amber-100/90">
          Caution is informational. Strategy auto-execute will still fire on a
          BUY signal; sizing is auto-trimmed to the recommended slice.
        </p>
      ) : null}

      {blocking.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-rose-300">Blocking reasons</p>
          {blocking.map((r, idx) => (
            <ReasonRow key={`b-${idx}`} reason={r} />
          ))}
        </div>
      ) : null}

      {warnings.length > 0 ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-amber-300">Warnings</p>
          {warnings.map((r, idx) => (
            <ReasonRow key={`w-${idx}`} reason={r} />
          ))}
        </div>
      ) : null}

      {infos.length > 0 && !compact ? (
        <div className="mt-2 space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-zinc-500">Notes</p>
          {infos.map((r, idx) => (
            <ReasonRow key={`i-${idx}`} reason={r} muted />
          ))}
        </div>
      ) : null}

      {advisory.cooldownSecs > 0 ? (
        <p className="mt-2 text-[11px] text-rose-200">
          Auto-cooldown active for {(advisory.cooldownSecs / 60).toFixed(0)} minutes.
        </p>
      ) : null}
    </div>
  )
}

function ReasonRow({
  reason,
  muted = false,
}: {
  reason: { code: string; severity: AdvisorySeverity; message: string; source: string; sourceUrl?: string }
  muted?: boolean
}) {
  const baseClass = muted ? 'text-zinc-400' : 'text-white'
  return (
    <div className={`rounded-md border border-white/10 bg-black/20 px-2.5 py-1.5 ${baseClass}`}>
      <p className="leading-snug">{reason.message}</p>
      <p className="mt-1 text-[10px] uppercase tracking-wide text-zinc-500">
        Source: {reason.source}
        {reason.sourceUrl ? (
          <>
            {' · '}
            <a
              href={reason.sourceUrl.startsWith('http') ? reason.sourceUrl : '#'}
              target={reason.sourceUrl.startsWith('http') ? '_blank' : undefined}
              rel="noreferrer"
              className="underline text-zinc-400 hover:text-white"
            >
              {reason.sourceUrl}
            </a>
          </>
        ) : null}
      </p>
    </div>
  )
}
