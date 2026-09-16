'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { analytics, portfolio } from '@/lib/api'

export default function ProfitPage() {
  const [period, setPeriod] = useState<'7d' | '30d' | '90d' | 'all'>('30d')
  const [summary, setSummary] = useState<{ totalPnl: number; winRate: number; totalTrades: number } | null>(null)
  const [total, setTotal] = useState<number | null>(null)

  useEffect(() => {
    Promise.all([analytics.summary(period), portfolio.get()])
      .then(([s, p]) => {
        setSummary(s)
        setTotal(p.totalValue)
      })
      .catch(() => {
        setSummary(null)
        setTotal(null)
      })
  }, [period])

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Profit & analytics</h1>
      </div>

      <div className="flex flex-wrap gap-2">
        {(['7d', '30d', '90d', 'all'] as const).map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => setPeriod(p)}
            className={`rounded-lg px-3 py-1.5 text-sm ${
              period === p ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-500/40' : 'bg-white/5 text-zinc-400 hover:bg-white/10'
            }`}
          >
            {p}
          </button>
        ))}
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <Card className="border-white/10 bg-[#0a0a0f]">
          <CardHeader>
            <CardTitle className="text-sm text-zinc-400">Portfolio value</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-white">
            {total != null ? `$${total.toFixed(2)}` : '—'}
          </CardContent>
        </Card>
        <Card className="border-white/10 bg-[#0a0a0f]">
          <CardHeader>
            <CardTitle className="text-sm text-zinc-400">Period PnL</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-emerald-300">
            {summary ? `$${Number(summary.totalPnl).toFixed(2)}` : '—'}
          </CardContent>
        </Card>
        <Card className="border-white/10 bg-[#0a0a0f]">
          <CardHeader>
            <CardTitle className="text-sm text-zinc-400">Win rate</CardTitle>
          </CardHeader>
          <CardContent className="text-2xl font-semibold text-white">
            {summary ? `${Number(summary.winRate).toFixed(1)}%` : '—'}
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/10 bg-[#0a0a0f]">
        <CardContent className="py-8 text-center text-sm text-zinc-500">
          Full charts live on{' '}
          <Link href="/analytics" className="text-emerald-400 hover:underline">
            Analytics
          </Link>
          .
        </CardContent>
      </Card>
    </div>
  )
}
