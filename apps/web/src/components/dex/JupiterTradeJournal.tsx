'use client'

import { useCallback, useEffect, useState } from 'react'
import { dexJupiter, type JupiterJournal } from '@/lib/api'

function fmtUsd(n: number): string {
  const sign = n < 0 ? '-' : ''
  return `${sign}$${Math.abs(n).toFixed(2)}`
}

export function JupiterTradeJournal() {
  const [journal, setJournal] = useState<JupiterJournal | null>(null)
  const [loading, setLoading] = useState(true)
  const [open, setOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      setLoading(true)
      const j = await dexJupiter.journal()
      setJournal(j)
    } catch {
      setJournal(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  if (loading && !journal) {
    return <p className="text-[10px] text-zinc-600">Loading trade journal…</p>
  }

  if (!journal || journal.totalTrades === 0) {
    return (
      <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
        <p className="text-[11px] font-semibold text-zinc-200">Trade journal</p>
        <p className="mt-1 text-[10px] text-zinc-500">
          Closed Jupiter trades will appear here with win rate and P&amp;L stats.
        </p>
      </div>
    )
  }

  return (
    <div className="rounded-lg border border-white/10 bg-black/20">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between px-2.5 py-2 text-left"
      >
        <span className="text-[11px] font-semibold text-zinc-200">Trade journal · Jupiter</span>
        <span className="text-[10px] text-zinc-500">{open ? '▲' : '▼'}</span>
      </button>
      <div className="grid grid-cols-3 gap-1 border-t border-white/5 px-2.5 py-2">
        <div>
          <p className="text-[9px] text-zinc-500">Win rate</p>
          <p className="font-mono text-sm text-emerald-400">{journal.winRatePct.toFixed(1)}%</p>
        </div>
        <div>
          <p className="text-[9px] text-zinc-500">Total P&amp;L</p>
          <p
            className={`font-mono text-sm ${journal.totalPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
          >
            {fmtUsd(journal.totalPnlUsd)}
          </p>
        </div>
        <div>
          <p className="text-[9px] text-zinc-500">Trades</p>
          <p className="font-mono text-sm text-zinc-200">{journal.totalTrades}</p>
        </div>
      </div>
      {open ? (
        <div className="space-y-2 border-t border-white/5 px-2.5 py-2 text-[10px]">
          <p className="text-zinc-500">
            Avg per trade:{' '}
            <span className={journal.avgPnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'}>
              {fmtUsd(journal.avgPnlUsd)}
            </span>
            {journal.bestTrade ? (
              <span className="ml-2 text-zinc-600">
                Best: {journal.bestTrade.pair} {fmtUsd(journal.bestTrade.pnlUsd)}
              </span>
            ) : null}
          </p>
          {journal.topTokens.length > 0 ? (
            <div>
              <p className="mb-1 font-medium text-zinc-400">Best tokens for you</p>
              <div className="flex flex-wrap gap-1">
                {journal.topTokens.slice(0, 5).map((t) => (
                  <span
                    key={t.baseSymbol}
                    className={`rounded px-1.5 py-0.5 font-mono ${
                      t.totalPnlUsd >= 0 ? 'bg-emerald-500/10 text-emerald-300' : 'bg-rose-500/10 text-rose-300'
                    }`}
                  >
                    {t.baseSymbol} {fmtUsd(t.totalPnlUsd)} ({t.winRatePct.toFixed(0)}%)
                  </span>
                ))}
              </div>
            </div>
          ) : null}
          {journal.recentClosed.length > 0 ? (
            <div className="max-h-[120px] overflow-y-auto">
              <table className="w-full text-left">
                <thead className="text-zinc-600">
                  <tr>
                    <th className="py-0.5">Token</th>
                    <th className="py-0.5 text-right">P&amp;L</th>
                  </tr>
                </thead>
                <tbody>
                  {journal.recentClosed.slice(0, 8).map((t) => (
                    <tr key={t.id} className="border-t border-white/5">
                      <td className="py-0.5 text-zinc-300">{t.baseSymbol}</td>
                      <td
                        className={`py-0.5 text-right font-mono ${
                          t.pnlUsd >= 0 ? 'text-emerald-400' : 'text-rose-400'
                        }`}
                      >
                        {fmtUsd(t.pnlUsd)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : null}
          <button type="button" onClick={() => void load()} className="text-violet-400 hover:text-violet-300">
            Refresh stats
          </button>
        </div>
      ) : null}
    </div>
  )
}
