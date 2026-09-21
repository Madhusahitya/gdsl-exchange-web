'use client'

import { useCallback, useEffect, useState } from 'react'
import { dexJupiter, type JupiterExecutableMarks } from '@/lib/api'
import { connectSocket } from '@/lib/socket'

/**
 * Unified Jupiter bid/ask/mid — fetched once on symbol change, then updated
 * in real-time from the Socket.IO jupiter:ticker stream. Zero HTTP polling.
 */
export function useJupiterMarks(
  symbol: string | null | undefined,
  _pollMs?: number,
): JupiterExecutableMarks | null {
  const [marks, setMarks] = useState<JupiterExecutableMarks | null>(null)

  const refresh = useCallback(async () => {
    if (!symbol) return
    try {
      const m = await dexJupiter.marks(symbol)
      setMarks(m)
    } catch {
      /* optional feed */
    }
  }, [symbol])

  // Fetch once on symbol change
  useEffect(() => {
    void refresh()
  }, [refresh])

  // Real-time marks updates via WebSocket ticks
  useEffect(() => {
    if (!symbol) return
    const socket = connectSocket()

    const onTicker = (ticks: Array<{ symbol: string; lastPrice: number }>) => {
      if (!Array.isArray(ticks) || ticks.length === 0) return
      const match = ticks.find((t) => t.symbol === symbol)
      if (!match || match.lastPrice == null || match.lastPrice <= 0) return

      setMarks((prev) => {
        if (!prev) return prev
        const halfSpread = prev.spreadBps != null ? (match.lastPrice * prev.spreadBps) / 20_000 : 0
        return {
          ...prev,
          mid: match.lastPrice,
          bid: halfSpread > 0 ? match.lastPrice - halfSpread : prev.bid,
          ask: halfSpread > 0 ? match.lastPrice + halfSpread : prev.ask,
        }
      })
    }

    socket.on('jupiter:ticker', onTicker)
    return () => {
      socket.off('jupiter:ticker', onTicker)
    }
  }, [symbol])

  return marks
}
