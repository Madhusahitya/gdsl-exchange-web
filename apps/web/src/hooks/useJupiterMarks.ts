'use client'

import { useCallback, useEffect, useState } from 'react'
import { dexJupiter, type JupiterExecutableMarks } from '@/lib/api'
import { connectSocket } from '@/lib/socket'

const marksMemoryCache = new Map<string, JupiterExecutableMarks>()

/**
 * Unified Jupiter bid/ask/mid — loaded instantly from RAM cache & WebSocket ticks,
 * with background HTTP reconciliation. Zero delay on initial render.
 */
export function useJupiterMarks(
  symbol: string | null | undefined,
  _pollMs?: number,
): JupiterExecutableMarks | null {
  const [marks, setMarks] = useState<JupiterExecutableMarks | null>(() => {
    return symbol ? marksMemoryCache.get(symbol) ?? null : null
  })

  const refresh = useCallback(async () => {
    if (!symbol) return
    try {
      const m = await dexJupiter.marks(symbol)
      marksMemoryCache.set(symbol, m)
      setMarks(m)
    } catch {
      /* optional feed */
    }
  }, [symbol])

  // Sync from cache on symbol change, then background fetch
  useEffect(() => {
    if (!symbol) {
      setMarks(null)
      return
    }
    const cached = marksMemoryCache.get(symbol)
    if (cached) {
      setMarks(cached)
    }
    void refresh()
  }, [symbol, refresh])

  // Real-time marks updates via WebSocket ticks — instant sub-second response
  useEffect(() => {
    if (!symbol) return
    const socket = connectSocket()

    const onTicker = (ticks: Array<{ symbol: string; lastPrice: number; priceChangePercent?: number }>) => {
      if (!Array.isArray(ticks) || ticks.length === 0) return
      const match = ticks.find((t) => t.symbol === symbol)
      if (!match || match.lastPrice == null || match.lastPrice <= 0) return

      setMarks((prev) => {
        const spreadBps = prev?.spreadBps && prev.spreadBps > 0 ? prev.spreadBps : 3
        const halfSpread = (match.lastPrice * spreadBps) / 20_000
        const baseSymbol = symbol.replace(/USDT$/i, '')
        const updated: JupiterExecutableMarks = {
          baseSymbol,
          binanceSymbol: symbol,
          mint: prev?.mint ?? '',
          spreadBps,
          ...(prev ?? {}),
          mid: match.lastPrice,
          bid: match.lastPrice - halfSpread,
          ask: match.lastPrice + halfSpread,
          ts: Date.now(),
        }
        marksMemoryCache.set(symbol, updated)
        return updated
      })
    }

    socket.on('jupiter:ticker', onTicker)
    return () => {
      socket.off('jupiter:ticker', onTicker)
    }
  }, [symbol])

  return marks
}

