'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { performance as perfApi } from '@/lib/api'
import { useSocket } from '@/hooks/useSocket'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Skeleton } from '@/components/ui/skeleton'
import { Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

// ─── Types ────────────────────────────────────────────────────────────────────

interface Summary {
  totalTrades:  number
  winRate:      number
  totalPnl:     number
  avgPnl:       number
  profitFactor: number
  sharpe:       number
  maxDrawdown:  number
  streak:       number
  winsCount:    number
  lossesCount:  number
}

interface SignalAccuracy {
  source:       string
  accuracy:     number
  observations: number
}

interface RecentSignal {
  id:         string
  symbol:     string
  direction:  string
  confidence: number
  outcome:    string | null
  ts:         string
}

interface ModelRecord {
  modelId:     string
  status:      string
  sharpe:      number | null
  winRate:     number | null
  maxDrawdown: number | null
  promotedAt:  string | null
  notes:       string | null
}

interface LiveData {
  summary:        Summary
  position:       { pair: string; entryPrice: number; since: string } | null
  signalAccuracy: SignalAccuracy[]
  recentSignals:  RecentSignal[]
  model:          { modelId: string; sharpe: number | null; winRate: number | null; maxDrawdown: number | null; promotedAt: string | null } | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

const usd = (v: number) =>
  new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 }).format(v)

const pct = (v: number, digits = 1) => `${v.toFixed(digits)}%`

const SOURCE_LABELS: Record<string, string> = {
  ema:       'EMA Crossover',
  rsi:       'RSI',
  macd:      'MACD',
  bollinger: 'Bollinger',
  volume:    'Volume Spike',
  news:      'News Sentiment',
  orderbook: 'Order Book',
}

function StatCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
      <CardContent className="pt-5 pb-4">
        <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">{label}</p>
        <p className={`text-2xl font-bold ${color ?? 'text-white'}`}>{value}</p>
        {sub && <p className="text-xs text-gray-500 mt-0.5">{sub}</p>}
      </CardContent>
    </Card>
  )
}

function StreakBadge({ streak }: { streak: number }) {
  if (streak === 0) return <Badge variant="outline" className="border-gray-600 text-gray-400">No streak</Badge>
  if (streak > 0)   return <Badge className="bg-green-500/20 text-green-400 border border-green-500/30">{streak}W streak</Badge>
  return <Badge className="bg-red-500/20 text-red-400 border border-red-500/30">{Math.abs(streak)}L streak</Badge>
}

function LiveDot() {
  return (
    <span className="relative flex h-2 w-2 mr-2">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75" />
      <span className="relative inline-flex rounded-full h-2 w-2 bg-green-500" />
    </span>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function PerformancePage() {
  const [data, setData]           = useState<LiveData | null>(null)
  const [models, setModels]       = useState<ModelRecord[]>([])
  const [recent, setRecent]       = useState<any[]>([])
  const [loading, setLoading]     = useState(true)
  const [lastRefresh, setLastRefresh] = useState<Date>(new Date())
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const fetchAll = useCallback(async () => {
    try {
      const [live, mvs, rec] = await Promise.all([
        perfApi.live(),
        perfApi.models(),
        perfApi.recent(),
      ])
      setData(live)
      setModels(mvs)
      setRecent(rec)
      setLastRefresh(new Date())
    } catch {
      // keep stale data on error
    } finally {
      setLoading(false)
    }
  }, [])

  // Initial fetch + 30s polling
  useEffect(() => {
    fetchAll()
    intervalRef.current = setInterval(fetchAll, 30_000)
    return () => { if (intervalRef.current) clearInterval(intervalRef.current) }
  }, [fetchAll])

  // Instant refresh on trade close
  const socket = useSocket()
  useEffect(() => {
    if (!socket) return
    const onUpdate = () => fetchAll()
    socket.on('performance:update', onUpdate)
    return () => { socket.off('performance:update', onUpdate) }
  }, [socket, fetchAll])

  if (loading) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64 bg-[#2a2a2a]" />
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          {[...Array(8)].map((_, i) => <Skeleton key={i} className="h-24 bg-[#2a2a2a]" />)}
        </div>
      </div>
    )
  }

  const s = data?.summary
  const isProfit = (s?.totalPnl ?? 0) >= 0

  // Build equity mini-curve from recent trades
  const equityCurve = (() => {
    let eq = 0
    return recent.slice().reverse().map((t, i) => {
      eq += Number(t.pnl ?? 0)
      return { i: i + 1, equity: eq }
    })
  })()

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Performance</h1>
          <p className="text-gray-400 text-sm mt-0.5">Real-time results from live trading.</p>
        </div>
        <div className="flex items-center gap-3">
          {data?.position ? (
            <Badge className="bg-amber-500/20 text-amber-400 border border-amber-500/30 flex items-center">
              <LiveDot />
              LONG {data.position.pair}
            </Badge>
          ) : (
            <Badge variant="outline" className="border-gray-600 text-gray-400">FLAT</Badge>
          )}
          <span className="text-xs text-gray-500">
            Updated {lastRefresh.toLocaleTimeString()}
          </span>
        </div>
      </div>

      {/* Core stats */}
      {/* Core stats — show placeholder when no trades yet */}
      {!s || s.totalTrades === 0 ? (
        <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
          <CardContent className="py-10 text-center text-gray-400">
            <div className="flex items-center justify-center gap-2 mb-2">
              <LiveDot />
              <span className="text-white font-medium">Live bot is active</span>
            </div>
            <p className="text-sm">Waiting for first BUY signal — signal accuracy data is already loading below.</p>
          </CardContent>
        </Card>
      ) : (
        <>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
            <StatCard
              label="Win Rate"
              value={pct(s.winRate)}
              sub={`${s.winsCount}W / ${s.lossesCount}L`}
              color={s.winRate >= 50 ? 'text-green-400' : 'text-red-400'}
            />
            <StatCard
              label="Total P&L"
              value={usd(s.totalPnl)}
              sub={`avg ${usd(s.avgPnl)}/trade`}
              color={isProfit ? 'text-green-400' : 'text-red-400'}
            />
            <StatCard label="Sharpe Ratio"    value={s.sharpe.toFixed(2)}       color={s.sharpe >= 1 ? 'text-green-400' : s.sharpe >= 0 ? 'text-amber-400' : 'text-red-400'} />
            <StatCard label="Profit Factor"   value={s.profitFactor.toFixed(2)} color={s.profitFactor >= 1.5 ? 'text-green-400' : 'text-amber-400'} />
            <StatCard label="Total Trades"    value={String(s.totalTrades)} />
            <StatCard label="Max Drawdown"    value={pct(s.maxDrawdown)}        color="text-red-400" />
            <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
              <CardContent className="pt-5 pb-4">
                <p className="text-xs text-gray-500 uppercase tracking-wider mb-2">Streak</p>
                <StreakBadge streak={s.streak} />
              </CardContent>
            </Card>
            {data?.model && (
              <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
                <CardContent className="pt-5 pb-4">
                  <p className="text-xs text-gray-500 uppercase tracking-wider mb-1">RL Champion</p>
                  <p className="text-sm font-mono text-amber-400 truncate">{data.model.modelId}</p>
                  <p className="text-xs text-gray-500 mt-0.5">
                    sharpe {data.model.sharpe?.toFixed(2) ?? '—'}
                  </p>
                </CardContent>
              </Card>
            )}
          </div>

          {/* Equity curve */}
          {equityCurve.length > 1 && (
            <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
              <CardHeader>
                <CardTitle className="text-white text-base">Cumulative P&L (last {recent.length} trades)</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="h-48">
                  <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={equityCurve}>
                      <defs>
                        <linearGradient id="eFill" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="5%"  stopColor={isProfit ? '#22c55e' : '#ef4444'} stopOpacity={0.35} />
                          <stop offset="95%" stopColor={isProfit ? '#22c55e' : '#ef4444'} stopOpacity={0} />
                        </linearGradient>
                      </defs>
                      <XAxis dataKey="i" stroke="#374151" tick={{ fill: '#6b7280', fontSize: 11 }} />
                      <YAxis stroke="#374151" tick={{ fill: '#6b7280', fontSize: 11 }}
                        tickFormatter={(v) => `$${v.toFixed(0)}`} />
                      <Tooltip
                        contentStyle={{ background: '#1f2937', border: '1px solid #374151', color: '#fff', fontSize: 12 }}
                        formatter={(v: number) => [usd(v), 'Cumulative P&L']}
                      />
                      <Area type="monotone" dataKey="equity"
                        stroke={isProfit ? '#22c55e' : '#ef4444'}
                        fill="url(#eFill)" strokeWidth={2} dot={false} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Recent trades table */}
          {recent.length > 0 && (
            <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
              <CardHeader>
                <CardTitle className="text-white text-base">Recent Trades</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="text-gray-500 border-b border-[#2a2a2a]">
                        <th className="text-left pb-2 font-normal">Pair</th>
                        <th className="text-right pb-2 font-normal">Entry</th>
                        <th className="text-right pb-2 font-normal">Exit</th>
                        <th className="text-right pb-2 font-normal">P&L</th>
                        <th className="text-right pb-2 font-normal">Time</th>
                      </tr>
                    </thead>
                    <tbody>
                      {recent.map((t) => {
                        const pnl = Number(t.pnl ?? 0)
                        return (
                          <tr key={t.id} className="border-b border-[#2a2a2a] last:border-0">
                            <td className="py-2 text-white font-medium">{t.pair}</td>
                            <td className="py-2 text-right text-gray-300">{usd(Number(t.entryPrice))}</td>
                            <td className="py-2 text-right text-gray-300">{t.exitPrice ? usd(Number(t.exitPrice)) : '—'}</td>
                            <td className={`py-2 text-right font-medium ${pnl >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                              {pnl >= 0 ? '+' : ''}{usd(pnl)}
                            </td>
                            <td className="py-2 text-right text-gray-500 text-xs">
                              {new Date(t.createdAt).toLocaleDateString([], { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
                            </td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </CardContent>
            </Card>
          )}
        </>
      )}

      {/* Signal accuracy + recent signals — always visible */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {(data?.signalAccuracy?.length ?? 0) > 0 && (
          <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
            <CardHeader>
              <CardTitle className="text-white text-base">Signal Accuracy</CardTitle>
              <p className="text-xs text-gray-500">Win rate by signal source</p>
            </CardHeader>
            <CardContent className="space-y-3">
              {data!.signalAccuracy.map((sig) => (
                <div key={sig.source}>
                  <div className="flex justify-between text-sm mb-1">
                    <span className="text-gray-300">{SOURCE_LABELS[sig.source] ?? sig.source}</span>
                    <span className={sig.accuracy >= 52 ? 'text-green-400' : sig.accuracy >= 49 ? 'text-gray-400' : 'text-red-400'}>
                      {pct(sig.accuracy)} <span className="text-gray-600 text-xs">n={sig.observations}</span>
                    </span>
                  </div>
                  <div className="h-1.5 w-full bg-[#2a2a2a] rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${sig.accuracy >= 52 ? 'bg-green-500' : sig.accuracy >= 49 ? 'bg-gray-500' : 'bg-red-500'}`}
                      style={{ width: `${Math.min(sig.accuracy, 100)}%` }}
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {(data?.recentSignals?.length ?? 0) > 0 && (
          <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
            <CardHeader>
              <CardTitle className="text-white text-base">Recent Signals</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-2">
                {data!.recentSignals.map((sig) => (
                  <div key={sig.id} className="flex items-center justify-between py-1.5 border-b border-[#2a2a2a] last:border-0">
                    <div className="flex items-center gap-2">
                      <Badge
                        className={
                          sig.direction === 'UP'   ? 'bg-green-500/20 text-green-400 text-xs' :
                          sig.direction === 'DOWN' ? 'bg-red-500/20 text-red-400 text-xs' :
                          'bg-gray-500/20 text-gray-400 text-xs'
                        }
                      >
                        {sig.direction === 'UP' ? 'BUY' : sig.direction === 'DOWN' ? 'SELL' : 'HOLD'}
                      </Badge>
                      <span className="text-gray-300 text-sm">{sig.symbol}</span>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-gray-500">
                      <span>{(sig.confidence * 100).toFixed(0)}% conf</span>
                      {sig.outcome && (
                        <Badge className={sig.outcome === 'WIN' ? 'bg-green-500/20 text-green-400 text-xs' : 'bg-red-500/20 text-red-400 text-xs'}>
                          {sig.outcome}
                        </Badge>
                      )}
                      <span>{new Date(sig.ts).toLocaleTimeString()}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {/* Model version history */}
      {models.length > 0 && (
        <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
          <CardHeader>
            <CardTitle className="text-white text-base">RL Model History</CardTitle>
            <p className="text-xs text-gray-500">Model version timeline</p>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-gray-500 border-b border-[#2a2a2a]">
                    <th className="text-left pb-2 font-normal">Model</th>
                    <th className="text-left pb-2 font-normal">Status</th>
                    <th className="text-right pb-2 font-normal">Sharpe</th>
                    <th className="text-right pb-2 font-normal">Win Rate</th>
                    <th className="text-right pb-2 font-normal">Max DD</th>
                    <th className="text-left pb-2 font-normal pl-4">Note</th>
                  </tr>
                </thead>
                <tbody>
                  {models.map((m, i) => (
                    <tr key={i} className="border-b border-[#2a2a2a] last:border-0">
                      <td className="py-2 font-mono text-xs text-amber-400">{m.modelId}</td>
                      <td className="py-2">
                        <Badge className={
                          m.status === 'champion' ? 'bg-amber-500/20 text-amber-400 text-xs' :
                          m.status === 'rejected' ? 'bg-red-500/20 text-red-400 text-xs' :
                          m.status === 'archived' ? 'bg-gray-500/20 text-gray-400 text-xs' :
                          'bg-blue-500/20 text-blue-400 text-xs'
                        }>
                          {m.status}
                        </Badge>
                      </td>
                      <td className={`py-2 text-right ${(m.sharpe ?? 0) >= 1 ? 'text-green-400' : 'text-gray-300'}`}>
                        {m.sharpe?.toFixed(2) ?? '—'}
                      </td>
                      <td className="py-2 text-right text-gray-300">
                        {m.winRate ? pct(m.winRate * 100) : '—'}
                      </td>
                      <td className="py-2 text-right text-red-400">
                        {m.maxDrawdown ? pct(m.maxDrawdown * 100) : '—'}
                      </td>
                      <td className="py-2 pl-4 text-xs text-gray-500 max-w-xs truncate">{m.notes ?? ''}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
