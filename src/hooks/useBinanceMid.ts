'use client'

import { useCallback, useEffect, useState } from 'react'
import { engine } from '@/lib/api'

/**
 * Binance spot mid-price — same source as the order book panel.
 * Poll at 2s so chart, book, and ref labels stay aligned.
 */
export function useBinanceMid(symbol: string | null | undefined, pollMs = 2_000): number | null {
  const [mid, setMid] = useState<number | null>(null)

  const refresh = useCallback(async () => {
    if (!symbol) return
    try {
      const d = await engine.orderBook(symbol, 8)
      if (Number.isFinite(d.mid) && d.mid != null && d.mid > 0) setMid(d.mid)
    } catch {
      /* optional feed */
    }
  }, [symbol])

  useEffect(() => {
    void refresh()
    if (!symbol) return
    const id = window.setInterval(() => void refresh(), pollMs)
    return () => window.clearInterval(id)
  }, [refresh, symbol, pollMs])

  return mid
}
