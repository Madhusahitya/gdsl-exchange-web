'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { personalWallet, trades, type WalletActivityItem } from '@/lib/api'

type ActivityRow = Omit<WalletActivityItem, 'type'> & {
  type: WalletActivityItem['type'] | 'Trade'
  link?: string
}

function isJupiterStrategy(name: string): boolean {
  return name.toLowerCase().includes('jupiter')
}

export function WalletActivityFeed({ chainFilter }: { chainFilter?: 'all' | 'bsc' | 'solana' | 'cross' }) {
  const [rows, setRows] = useState<ActivityRow[]>([])
  const [loading, setLoading] = useState(true)

  const scope = chainFilter ?? 'all'

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [activityRes, tradeRes] = await Promise.all([
        personalWallet.activity({ scope, limit: 50 }).catch(() => ({ items: [] })),
        scope === 'all' || scope === 'bsc' || scope === 'solana'
          ? trades.list({ status: 'ALL', page: 1, limit: 40 }).catch(() => ({ trades: [] }))
          : Promise.resolve({ trades: [] }),
      ])

      const merged: ActivityRow[] = activityRes.items.map((item) => ({ ...item }))

      for (const t of tradeRes.trades ?? []) {
        const strat = String(t.strategy ?? '')
        const chain = isJupiterStrategy(strat) ? 'Solana' : 'BSC'
        if (scope !== 'all' && scope === 'cross') continue
        if (scope === 'bsc' && chain !== 'BSC') continue
        if (scope === 'solana' && chain !== 'Solana') continue
        merged.push({
          id: `trade-${t.id}`,
          at: t.createdAt,
          chain,
          type: 'Trade',
          detail: `${t.pair} · ${strat}`,
          amount: t.allocationUsd != null ? `$${Number(t.allocationUsd).toFixed(2)}` : t.side ?? t.status,
          status: t.status,
        })
      }

      merged.sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      setRows(merged)
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    void load()
  }, [load])

  const filtered = useMemo(() => {
    if (!chainFilter || chainFilter === 'all') return rows
    if (chainFilter === 'bsc') return rows.filter((r) => r.chain === 'BSC' || r.type === 'Transfer')
    if (chainFilter === 'solana') return rows.filter((r) => r.chain === 'Solana' || r.type === 'Transfer')
    return rows.filter((r) => r.chain === 'Cross-chain' || r.type === 'Transfer')
  }, [rows, chainFilter])

  return (
    <Card className="border-white/10 bg-[#1a1a1a]">
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle className="text-white">Activity timeline</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Withdrawals, converts, cross-chain transfers, and logged trades across BSC and Solana. On-chain deposits appear as balance increases (no separate row).
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="text-xs text-zinc-500 hover:text-zinc-300">
          Refresh
        </button>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {loading ? (
          <p className="px-4 py-6 text-sm text-zinc-500">Loading activity…</p>
        ) : filtered.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500">No activity yet for this filter.</p>
        ) : (
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="border-b border-white/10 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-normal">Time</th>
                <th className="px-3 py-2 font-normal">Chain</th>
                <th className="px-3 py-2 font-normal">Type</th>
                <th className="px-3 py-2 font-normal">Detail</th>
                <th className="px-3 py-2 font-normal">Amount</th>
                <th className="px-3 py-2 font-normal">Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r) => (
                <tr key={r.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2 text-zinc-400">{new Date(r.at).toLocaleString()}</td>
                  <td className="px-3 py-2 text-zinc-300">{r.chain}</td>
                  <td className="px-3 py-2 font-medium text-white">{r.type}</td>
                  <td className="px-3 py-2 text-zinc-400">
                    {r.txLink ? (
                      <span className="inline-flex flex-wrap items-center gap-2">
                        <a href={r.txLink} target="_blank" rel="noreferrer" className="text-sky-300 underline">
                          {r.detail}
                        </a>
                        {r.txLink2 ? (
                          <a href={r.txLink2} target="_blank" rel="noreferrer" className="text-violet-300 underline">
                            credit tx
                          </a>
                        ) : null}
                      </span>
                    ) : (
                      r.detail
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono text-zinc-200">{r.amount}</td>
                  <td
                    className={`px-3 py-2 ${
                      r.status === 'COMPLETED' || r.status === 'CLOSED'
                        ? 'text-emerald-300'
                        : r.status === 'FAILED'
                          ? 'text-rose-300'
                          : r.status === 'OPEN'
                            ? 'text-sky-300'
                            : 'text-amber-300'
                    }`}
                  >
                    {r.status}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="border-t border-white/5 px-4 py-3 text-[11px] text-zinc-500">
          Swaps on{' '}
          <Link href="/dex-jupiter" className="text-violet-300 underline">
            Solana
          </Link>{' '}
          and{' '}
          <Link href="/dex-1inch" className="text-sky-300 underline">
            DEX 1inch
          </Link>{' '}
          are logged here after execution. Use Convert / Transfer in the top bar for same-chain or cross-chain moves.
        </p>
      </CardContent>
    </Card>
  )
}
