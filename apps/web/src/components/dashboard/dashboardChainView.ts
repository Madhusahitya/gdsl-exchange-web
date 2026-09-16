import type { DashboardSummary } from '@/lib/api'

export type WalletView = 'all' | 'bsc-personal' | 'sol-personal' | 'browser-bsc'

export type TradeLogRow = {
  id: string
  pair: string
  side?: 'BUY' | 'SELL' | 'CLOSED' | 'CANCELLED' | null
  entryPrice: number
  exitPrice: number | null
  pnl: number | null
  allocationUsd: number | null
  status: string
  strategy: string
  createdAt: string
}

export type HoldingRow = {
  symbol: string
  amount: number
  usdValue: number
  role?: string
}

export type OpenPosition = NonNullable<DashboardSummary['openPositions']>[number]

function sumPnl(rows: TradeLogRow[]): number {
  return rows.reduce((s, r) => s + (r.pnl ?? 0), 0)
}

function tradeStats(rows: TradeLogRow[]) {
  const closed = rows.filter((r) => r.status === 'CLOSED' && r.pnl != null)
  const startOfDay = new Date()
  startOfDay.setHours(0, 0, 0, 0)
  const weekAgo = Date.now() - 7 * 86400000
  const today = closed.filter((r) => new Date(r.createdAt) >= startOfDay)
  const week = closed.filter((r) => new Date(r.createdAt).getTime() >= weekAgo)
  const winsToday = today.filter((r) => (r.pnl ?? 0) > 0).length
  const lossesToday = today.filter((r) => (r.pnl ?? 0) < 0).length
  const winsWeek = week.filter((r) => (r.pnl ?? 0) > 0).length
  const lossesWeek = week.filter((r) => (r.pnl ?? 0) < 0).length
  const winRateToday = today.length > 0 ? (winsToday / today.length) * 100 : 0
  const winRateWeek = week.length > 0 ? (winsWeek / week.length) * 100 : 0
  const avgWinWeek =
    winsWeek > 0 ? week.filter((r) => (r.pnl ?? 0) > 0).reduce((s, r) => s + (r.pnl ?? 0), 0) / winsWeek : 0
  const avgLossWeek =
    lossesWeek > 0
      ? Math.abs(week.filter((r) => (r.pnl ?? 0) < 0).reduce((s, r) => s + (r.pnl ?? 0), 0) / lossesWeek)
      : 0
  const expectancyWeek =
    week.length > 0 ? (winRateWeek / 100) * avgWinWeek - (1 - winRateWeek / 100) * avgLossWeek : 0
  const payoffRatio = avgLossWeek > 0 ? avgWinWeek / avgLossWeek : 0
  const last = closed[0]
  return {
    todayProfit: sumPnl(today),
    weekProfit: sumPnl(week),
    totalProfit: sumPnl(closed),
    tradesToday: today.length,
    tradesThisWeek: week.length,
    closedTradesAllTime: closed.length,
    winsToday,
    lossesToday,
    winRateToday,
    winRateWeek,
    avgWinWeekUsd: avgWinWeek,
    avgLossWeekUsd: avgLossWeek,
    expectancyWeekUsd: expectancyWeek,
    payoffRatioWeek: payoffRatio,
    bestTradeToday: today.length ? Math.max(...today.map((r) => r.pnl ?? 0)) : 0,
    worstTradeToday: today.length ? Math.min(...today.map((r) => r.pnl ?? 0)) : 0,
    lastTradeAt: last?.createdAt ?? null,
    lastTradePair: last?.pair ?? null,
    lastTradePnl: last?.pnl ?? null,
  }
}

function openMv(positions: OpenPosition[]): number {
  return positions.reduce((s, p) => s + (p.marketValueUsd ?? 0), 0)
}

export type ChainDashboardView = {
  chainLabel: string
  profitSubtitle: string
  balanceSubtitle: string
  walletBalance: number
  walletChangeUsd: number
  walletChangePercent: number
  cashEquity: number
  tokenExposure: number
  openPositionsMv: number
  openPositionsCount: number
  unrealizedPnl: number
  holdings: HoldingRow[]
  stats: ReturnType<typeof tradeStats>
  showBscExtras: boolean
  showDeposits: boolean
  totalDeposits: number
  depositsToday: number
}

export function buildChainDashboardView(opts: {
  walletView: WalletView
  summary: DashboardSummary | null
  solSnapshot: { usdc: number; sol: number; totalUsd: number } | null
  bscTotalUsd: number | null
  bscBalances: HoldingRow[]
  solTokens: HoldingRow[]
  filteredTrades: TradeLogRow[]
  filteredOpenPositions: OpenPosition[]
}): ChainDashboardView | null {
  const { walletView, summary, solSnapshot, bscTotalUsd, bscBalances, solTokens, filteredTrades, filteredOpenPositions } =
    opts
  const stats = tradeStats(filteredTrades)
  const posMv = openMv(filteredOpenPositions)

  if (walletView === 'sol-personal') {
    const usdc = solSnapshot?.usdc ?? 0
    // Never show $0 headline when live USDC is known (API total can lag/fail).
    const total = Math.max(solSnapshot?.totalUsd ?? 0, usdc)
    const tokenExp = Math.max(0, total - usdc)
    return {
      chainLabel: 'Solana personal wallet',
      profitSubtitle: 'Realized PnL from Jupiter DEX trades · open positions valued at live marks.',
      balanceSubtitle: 'Full Solana portfolio — every SPL token priced via Jupiter.',
      walletBalance: total,
      walletChangeUsd: stats.todayProfit,
      walletChangePercent: total > 0 ? (stats.todayProfit / total) * 100 : 0,
      cashEquity: usdc,
      tokenExposure: tokenExp,
      openPositionsMv: posMv,
      openPositionsCount: filteredOpenPositions.length,
      unrealizedPnl: 0,
      holdings: solTokens.filter((t) => t.usdValue > 0.001 || t.amount > 0),
      stats,
      showBscExtras: false,
      showDeposits: false,
      totalDeposits: 0,
      depositsToday: 0,
    }
  }

  if (walletView === 'bsc-personal') {
    const total = bscTotalUsd ?? summary?.walletBalance ?? 0
    const stable = summary?.cashEquity ?? 0
    return {
      chainLabel: 'BSC personal wallet',
      profitSubtitle: 'Realized PnL from Pancake / 1inch trades on your BSC personal wallet.',
      balanceSubtitle: 'Live on-chain BSC portfolio — USDT, BNB, and token holdings.',
      walletBalance: total,
      walletChangeUsd: summary?.walletChangeUsd ?? stats.todayProfit,
      walletChangePercent: summary?.walletChangePercent ?? 0,
      cashEquity: stable,
      tokenExposure: Math.max(0, total - stable),
      openPositionsMv: posMv,
      openPositionsCount: filteredOpenPositions.length,
      unrealizedPnl: summary?.unrealizedPnl ?? 0,
      holdings: bscBalances.filter((t) => t.usdValue > 0.001 || t.amount > 0),
      stats,
      showBscExtras: true,
      showDeposits: false,
      totalDeposits: summary?.totalDeposits ?? 0,
      depositsToday: summary?.depositsToday ?? 0,
    }
  }

  if (walletView === 'browser-bsc') {
    return {
      chainLabel: 'Browser wallet (BSC)',
      profitSubtitle: 'Logged swap PnL from your connected MetaMask on BNB Smart Chain.',
      balanceSubtitle: summary?.walletBrowserTail
        ? `Approximate USD from browser wallet …${summary.walletBrowserTail}`
        : 'Connected MetaMask valuation on BSC.',
      walletBalance: summary?.walletBalance ?? 0,
      walletChangeUsd: summary?.walletChangeUsd ?? 0,
      walletChangePercent: summary?.walletChangePercent ?? 0,
      cashEquity: summary?.cashEquity ?? 0,
      tokenExposure: summary?.openPositionsMarketValue ?? 0,
      openPositionsMv: posMv,
      openPositionsCount: filteredOpenPositions.length,
      unrealizedPnl: 0,
      holdings: [],
      stats,
      showBscExtras: true,
      showDeposits: false,
      totalDeposits: 0,
      depositsToday: 0,
    }
  }

  // all chains — require both legs when available so the headline doesn't
  // jump BSC-only → BSC+Sol as Solana RPC catches up.
  const solUsdc = solSnapshot?.usdc ?? 0
  const solTotal = Math.max(solSnapshot?.totalUsd ?? 0, solUsdc)
  const bscTotal = bscTotalUsd ?? summary?.walletBalance ?? 0
  const solReady = solSnapshot != null
  const bscReady = bscTotalUsd != null || summary != null
  const combined =
    solReady && bscReady
      ? bscTotal + solTotal
      : bscReady
        ? bscTotal
        : solReady
          ? solTotal
          : 0
  const combinedHoldings = [...bscBalances, ...solTokens].filter((t) => t.usdValue > 0.001 || t.amount > 0)
  return {
    chainLabel: 'All chains',
    profitSubtitle: 'Combined realized PnL across BSC and Solana personal wallets.',
    balanceSubtitle: solReady && bscReady
      ? 'BSC personal + Solana personal — full portfolio totals.'
      : 'Loading chain legs… totals stabilize once BSC and Solana both report.',
    walletBalance: combined,
    walletChangeUsd: (summary?.walletChangeUsd ?? 0) + stats.todayProfit,
    walletChangePercent:
      combined > 0
        ? (((summary?.walletChangeUsd ?? 0) + stats.todayProfit) / combined) * 100
        : 0,
    cashEquity: (summary?.cashEquity ?? 0) + solUsdc,
    tokenExposure: Math.max(0, combined - (summary?.cashEquity ?? 0) - solUsdc),
    openPositionsMv: posMv,
    openPositionsCount: filteredOpenPositions.length,
    unrealizedPnl: summary?.unrealizedPnl ?? 0,
    holdings: combinedHoldings,
    stats,
    showBscExtras: true,
    showDeposits: true,
    totalDeposits: summary?.totalDeposits ?? 0,
    depositsToday: summary?.depositsToday ?? 0,
  }
}
