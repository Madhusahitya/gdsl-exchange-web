'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { engine, type EnhancedSignalSnapshot } from '@/lib/api'

type Props = {
  /** Pair to analyse, e.g. BTCUSDT, ETHUSDT, BNBUSDT. */
  symbol?: string
  /** Compact mode hides the rationale list. */
  compact?: boolean
  /** Multi-symbol leaderboard for "what to invest" (top picks). */
  showMultiLeaderboard?: boolean
  multiSymbols?: string[]
  pollIntervalMs?: number
}

const DEFAULT_MULTI_SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT']

function pctLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function fmtPrice(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return '—'
  if (value >= 1000) return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (value >= 1) return value.toFixed(2)
  return value.toFixed(6)
}

function actionColor(direction: 'BUY' | 'SELL' | 'HOLD'): string {
  if (direction === 'BUY') return 'text-emerald-400'
  if (direction === 'SELL') return 'text-rose-400'
  return 'text-zinc-300'
}

function badgeColor(direction: 'BUY' | 'SELL' | 'HOLD'): string {
  if (direction === 'BUY') return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30'
  if (direction === 'SELL') return 'bg-rose-500/15 text-rose-300 border-rose-500/30'
  return 'bg-zinc-500/15 text-zinc-300 border-zinc-500/30'
}

export function EnhancedSignalsPanel({
  symbol = 'BTCUSDT',
  compact = false,
  showMultiLeaderboard = false,
  multiSymbols,
  pollIntervalMs = 30_000,
}: Props) {
  const [snapshot, setSnapshot] = useState<EnhancedSignalSnapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState<string | null>(null)
  const [topPicks, setTopPicks] = useState<
    Array<{ symbol: string; score: number; action: 'BUY' | 'SELL' | 'HOLD'; sizingLabel: string }>
  >([])

  const refresh = useCallback(async () => {
    try {
      setErr(null)
      if (showMultiLeaderboard) {
        const multi = await engine.multiSignal(multiSymbols ?? DEFAULT_MULTI_SYMBOLS)
        setTopPicks(multi.topPicks)
        const focus = multi.symbols.find((s) => s.symbol === symbol) ?? multi.symbols[0]
        if (focus) setSnapshot(focus)
      } else {
        const data = await engine.enhancedSignal(symbol)
        setSnapshot(data)
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Failed to load signal feed'
      setErr(message)
    } finally {
      setLoading(false)
    }
  }, [symbol, showMultiLeaderboard, multiSymbols])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), pollIntervalMs)
    return () => window.clearInterval(id)
  }, [refresh, pollIntervalMs])

  return (
    <Card className="border-white/10 bg-[#0a0a0f]">
      <CardHeader className="pb-3">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <CardTitle className="text-base font-medium text-white">
              Live multi-source trading signals
            </CardTitle>
            <p className="text-xs text-zinc-500">
              Aggregated across TradingView-style technicals, futures funding, on-chain breadth, news sentiment, and macro. Updated every {(pollIntervalMs / 1000).toFixed(0)}s.
            </p>
          </div>
          {snapshot ? (
            <span className={`rounded-md border px-2.5 py-1 text-xs font-mono ${badgeColor(snapshot.consensus.signal)}`}>
              {snapshot.symbol} · {snapshot.consensus.signal} · {Math.round(snapshot.consensus.confidence * 100)}%
            </span>
          ) : null}
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {loading && !snapshot ? (
          <p className="text-sm text-zinc-500">Loading providers…</p>
        ) : null}
        {err ? (
          <p className="text-sm text-amber-300">Live signals unavailable: {err}</p>
        ) : null}

        {snapshot ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Last price</p>
                <p className="mt-1 text-base font-mono text-white">${fmtPrice(snapshot.market.lastPrice)}</p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">24h change</p>
                <p className={`mt-1 text-base font-mono ${(snapshot.market.change24hPct ?? 0) >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                  {pctLabel(snapshot.market.change24hPct)}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Action</p>
                <p className={`mt-1 text-base font-mono ${actionColor(snapshot.recommendation.action)}`}>
                  {snapshot.recommendation.action}
                </p>
                <p className="text-[10px] text-zinc-500">
                  Invest: {snapshot.recommendation.invest.toUpperCase()}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-3">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Suggested size</p>
                <p className="mt-1 text-base font-mono text-white">
                  {snapshot.recommendation.sizingPct.toFixed(2)}%
                </p>
                <p className="text-[10px] text-zinc-500 capitalize">
                  {snapshot.recommendation.sizingLabel}
                </p>
              </div>
            </div>

            <div className="space-y-2">
              <p className="text-[11px] uppercase tracking-widest text-zinc-500">
                Provider votes ({snapshot.providerCount} online)
              </p>
              <div className="grid gap-2 md:grid-cols-2">
                {snapshot.providers.map((provider) => (
                  <div key={provider.id} className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-medium text-white">{provider.name}</span>
                      <span className={`font-mono text-xs ${actionColor(provider.signal)}`}>
                        {provider.signal} · {Math.round(provider.confidence * 100)}%
                      </span>
                    </div>
                    {provider.note ? (
                      <p className="mt-1 text-[11px] text-zinc-500">{provider.note}</p>
                    ) : null}
                  </div>
                ))}
                {snapshot.providers.length === 0 ? (
                  <p className="text-xs text-zinc-500">No providers online — signals will resume once feeds recover.</p>
                ) : null}
              </div>
            </div>

            {!compact ? (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-widest text-zinc-500">
                  Why this recommendation
                </p>
                <ul className="space-y-1 text-xs text-zinc-300">
                  {snapshot.recommendation.rationale.map((line, idx) => (
                    <li key={idx} className="border-b border-white/5 pb-1">{line}</li>
                  ))}
                </ul>
                {snapshot.recommendation.riskNotes.length > 0 ? (
                  <div className="rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-200">
                    <p className="text-[11px] uppercase tracking-wide text-amber-300/90">Risk notes</p>
                    <ul className="mt-1 space-y-1">
                      {snapshot.recommendation.riskNotes.map((line, idx) => (
                        <li key={idx}>• {line}</li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </div>
            ) : null}
          </>
        ) : null}

        {showMultiLeaderboard && topPicks.length > 0 ? (
          <div className="space-y-2">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">What to invest in (top picks)</p>
            <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
              {topPicks.map((pick) => (
                <div key={pick.symbol} className="rounded-md border border-white/10 bg-white/[0.02] px-3 py-2 text-xs">
                  <p className="text-white font-mono">{pick.symbol}</p>
                  <p className={actionColor(pick.action)}>
                    {pick.action} · {pick.sizingLabel}
                  </p>
                  <p className="text-[10px] text-zinc-500">
                    Score {pick.score.toFixed(3)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </CardContent>
    </Card>
  )
}
