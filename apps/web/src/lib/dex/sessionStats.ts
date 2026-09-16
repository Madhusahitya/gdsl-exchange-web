const STORAGE_KEY = 'gdsl_dex_session_v1'

export type DexSessionStats = {
  /** Cumulative USDT size of confirmed BUY swaps (human units, 18 decimals as float). */
  buysUsdtTotal: number
  /** Cumulative USDT received from quoted SELL paths (estimate). */
  sellsUsdtTotal: number
  buyCount: number
  sellCount: number
  /** ISO date (local) for daily loss reset */
  dayKey: string
}

function todayKey(): string {
  const d = new Date()
  return `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`
}

export function loadDexSession(): DexSessionStats {
  if (typeof window === 'undefined') {
    return {
      buysUsdtTotal: 0,
      sellsUsdtTotal: 0,
      buyCount: 0,
      sellCount: 0,
      dayKey: todayKey(),
    }
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) throw new Error('empty')
    const parsed = JSON.parse(raw) as DexSessionStats
    if (parsed.dayKey !== todayKey()) {
      return {
        buysUsdtTotal: 0,
        sellsUsdtTotal: 0,
        buyCount: 0,
        sellCount: 0,
        dayKey: todayKey(),
      }
    }
    return parsed
  } catch {
    return {
      buysUsdtTotal: 0,
      sellsUsdtTotal: 0,
      buyCount: 0,
      sellCount: 0,
      dayKey: todayKey(),
    }
  }
}

export function saveDexSession(stats: DexSessionStats): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...stats, dayKey: todayKey() }))
  } catch {
    /* ignore quota */
  }
}

/** Rough session flow: sells - buys (negative = net spent). Not tax/legal P&L. */
export function estimatedSessionFlowUsdt(stats: DexSessionStats): number {
  return stats.sellsUsdtTotal - stats.buysUsdtTotal
}

export function resetDexSession(): void {
  saveDexSession({
    buysUsdtTotal: 0,
    sellsUsdtTotal: 0,
    buyCount: 0,
    sellCount: 0,
    dayKey: todayKey(),
  })
}
