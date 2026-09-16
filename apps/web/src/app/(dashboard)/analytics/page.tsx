'use client'

import { useEffect, useMemo, useState } from 'react'
import { analytics } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { Area, AreaChart, Bar, BarChart, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

type Period = '7d' | '30d' | '90d' | 'all'

interface Summary {
  totalTrades: number
  winningTrades: number
  losingTrades: number
  winRate: number
  totalPnl: number
  sharpeRatio: number
  maxDrawdown: number
  profitFactor: number
  bestTrade: { pair: string; pnl: number; date: string } | null
  worstTrade: { pair: string; pnl: number; date: string } | null
}

export default function AnalyticsPage() {
  const [period, setPeriod] = useState<Period>('30d')
  const [loading, setLoading] = useState(true)
  const [summary, setSummary] = useState<Summary | null>(null)
  const [equity, setEquity] = useState<any[]>([])
  const [byStrategy, setByStrategy] = useState<any[]>([])
  const [byPair, setByPair] = useState<any[]>([])

  useEffect(() => {
    let active = true
    setLoading(true)
    Promise.all([
      analytics.summary(period),
      analytics.equityCurve(period),
      analytics.byStrategy(period),
      analytics.byPair(period),
    ])
      .then(([s, e, st, p]) => {
        if (!active) return
        setSummary(s)
        setEquity(e)
        setByStrategy(st)
        setByPair(p)
      })
      .finally(() => active && setLoading(false))

    return () => {
      active = false
    }
  }, [period])

  const currency = (v: number) =>
    new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v)

  const isPositive = (summary?.totalPnl ?? 0) >= 0
  const donut = useMemo(
    () => [
      { name: 'Wins', value: summary?.winningTrades ?? 0, fill: '#22c55e' },
      { name: 'Losses', value: summary?.losingTrades ?? 0, fill: '#ef4444' },
    ],
    [summary]
  )

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Analytics</h1>
          <p className="text-gray-400">Performance analytics and risk metrics</p>
        </div>
        <div className="inline-flex rounded-lg border border-[#2a2a2a] bg-[#1a1a1a] p-1">
          {(['7d', '30d', '90d', 'all'] as Period[]).map((p) => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={`px-3 py-1.5 text-sm rounded-md ${period === p ? 'bg-amber-500 text-black' : 'text-gray-300 hover:bg-[#2a2a2a]'}`}
            >
              {p.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-24 bg-[#2a2a2a]" />)}</div>
      ) : summary?.totalTrades === 0 ? (
        <Card className="bg-[#1a1a1a] border-[#2a2a2a]"><CardContent className="py-12 text-center text-gray-400">No trades yet â€” start a bot to see analytics</CardContent></Card>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-3 lg:grid-cols-6 gap-4">
            <Stat label="Total Trades" value={String(summary?.totalTrades ?? 0)} />
            <Stat label="Win Rate" value={`${(summary?.winRate ?? 0).toFixed(1)}%`} color={(summary?.winRate ?? 0) >= 50 ? 'text-green-500' : 'text-red-500'} />
            <Stat label="Total P&L" value={currency(summary?.totalPnl ?? 0)} color={isPositive ? 'text-green-500' : 'text-red-500'} />
            <Stat label="Sharpe Ratio" value={(summary?.sharpeRatio ?? 0).toFixed(2)} />
            <Stat label="Max Drawdown" value={`${(summary?.maxDrawdown ?? 0).toFixed(2)}%`} color="text-red-500" />
            <Stat label="Profit Factor" value={(summary?.profitFactor ?? 0).toFixed(2)} />
          </div>

          <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
            <CardHeader><CardTitle className="text-white">Equity Curve</CardTitle></CardHeader>
            <CardContent>
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={equity}>
                    <defs>
                      <linearGradient id="equityFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor={isPositive ? '#22c55e' : '#ef4444'} stopOpacity={0.35} />
                        <stop offset="95%" stopColor={isPositive ? '#22c55e' : '#ef4444'} stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <XAxis dataKey="date" stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                    <YAxis stroke="#6b7280" tick={{ fill: '#9ca3af', fontSize: 12 }} />
                    <Tooltip contentStyle={{ background: '#1f1f1f', border: '1px solid #2a2a2a', color: '#fff' }} />
                    <Area type="monotone" dataKey="portfolioValue" stroke={isPositive ? '#22c55e' : '#ef4444'} fill="url(#equityFill)" strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card className="bg-[#1a1a1a] border-[#2a2a2a]"><CardHeader><CardTitle className="text-white">Win / Loss</CardTitle></CardHeader><CardContent><div className="h-64"><ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={donut} dataKey="value" nameKey="name" innerRadius={70} outerRadius={95} /></PieChart></ResponsiveContainer></div><p className="text-center text-2xl font-semibold text-white">{(summary?.winRate ?? 0).toFixed(1)}%</p></CardContent></Card>
            <Card className="bg-[#1a1a1a] border-[#2a2a2a]"><CardHeader><CardTitle className="text-white">Strategy Performance</CardTitle></CardHeader><CardContent><Table><TableHeader><TableRow className="border-[#2a2a2a]"><TableHead className="text-gray-400">Strategy</TableHead><TableHead className="text-gray-400">Trades</TableHead><TableHead className="text-gray-400">Win Rate</TableHead><TableHead className="text-gray-400">Total P&L</TableHead><TableHead className="text-gray-400">Avg P&L</TableHead></TableRow></TableHeader><TableBody>{byStrategy.map((r) => <TableRow key={r.strategyId} className="border-[#2a2a2a]"><TableCell className="text-white">{r.strategyName}</TableCell><TableCell className="text-gray-300">{r.totalTrades}</TableCell><TableCell className="text-gray-300">{r.winRate.toFixed(1)}%</TableCell><TableCell className={r.totalPnl >= 0 ? 'text-green-500' : 'text-red-500'}>{currency(r.totalPnl)}</TableCell><TableCell className={r.avgPnl >= 0 ? 'text-green-500' : 'text-red-500'}>{currency(r.avgPnl)}</TableCell></TableRow>)}</TableBody></Table></CardContent></Card>
          </div>

          <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
            <CardHeader><CardTitle className="text-white">Pair Performance</CardTitle></CardHeader>
            <CardContent>
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={byPair}>
                    <XAxis dataKey="pair" stroke="#6b7280" tick={{ fill: '#9ca3af' }} />
                    <YAxis stroke="#6b7280" tick={{ fill: '#9ca3af' }} />
                    <Tooltip contentStyle={{ background: '#1f1f1f', border: '1px solid #2a2a2a', color: '#fff' }} />
                    <Bar dataKey="totalPnl">
                      {byPair.map((entry: any, idx: number) => (
                        <Cell key={`c-${idx}`} fill={entry.totalPnl >= 0 ? '#22c55e' : '#ef4444'} />
                      ))}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </CardContent>
          </Card>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <Card className="bg-[#1a1a1a] border border-green-500/30"><CardHeader><CardTitle className="text-green-500">Best Trade</CardTitle></CardHeader><CardContent className="text-gray-200">{summary?.bestTrade ? `${summary.bestTrade.pair} â€¢ ${currency(summary.bestTrade.pnl)} â€¢ ${new Date(summary.bestTrade.date).toLocaleDateString()}` : 'N/A'}</CardContent></Card>
            <Card className="bg-[#1a1a1a] border border-red-500/30"><CardHeader><CardTitle className="text-red-500">Worst Trade</CardTitle></CardHeader><CardContent className="text-gray-200">{summary?.worstTrade ? `${summary.worstTrade.pair} â€¢ ${currency(summary.worstTrade.pnl)} â€¢ ${new Date(summary.worstTrade.date).toLocaleDateString()}` : 'N/A'}</CardContent></Card>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, value, color = 'text-white' }: { label: string; value: string; color?: string }) {
  return (
    <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
      <CardContent className="pt-5">
        <p className="text-xs text-gray-400">{label}</p>
        <p className={`mt-1 text-2xl font-semibold ${color}`}>{value}</p>
      </CardContent>
    </Card>
  )
}
