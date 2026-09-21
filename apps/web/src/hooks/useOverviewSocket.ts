'use client'

import { useEffect, useState } from 'react'
import { connectSocket } from '@/lib/socket'
import { dexJupiter, type MarketBoardRow } from '@/lib/api'
import { toast } from 'sonner'

export type OverviewData = {
  rows: MarketBoardRow[]
  highlights: {
    hot: MarketBoardRow[]
    topGainers: MarketBoardRow[]
    topLosers: MarketBoardRow[]
  }
  totalPairs: number
  updatedAt: string | null
}

export type JupiterPriceTick = {
  symbol: string
  mint: string
  lastPrice: number
  priceChangePercent: number
}

const EMPTY: OverviewData = {
  rows: [],
  highlights: { hot: [], topGainers: [], topLosers: [] },
  totalPairs: 0,
  updatedAt: null,
}

/**
 * Subscribes to real-time Jupiter overview data via Socket.IO:
 * 1. Initial REST fetch for instant layout.
 * 2. 2-second real-time price tick stream (`jupiter:ticker`) for fast, flashing prices.
 * 3. Full board background sync (`jupiter:overview`) for periodic re-ranking & discovery.
 */
export function useOverviewSocket() {
  const [data, setData] = useState<OverviewData>(EMPTY)
  const [loading, setLoading] = useState(true)
  const [connected, setConnected] = useState(false)

  // 1. Initial REST fetch — instant data before first socket push
  useEffect(() => {
    dexJupiter
      .overview(1500)
      .then((ov) => {
        setData({
          rows: ov.rows,
          highlights: ov.highlights,
          totalPairs: ov.totalPairs,
          updatedAt: ov.updatedAt,
        })
      })
      .catch((e: unknown) => {
        const ax = e as { response?: { data?: { error?: string } } }
        toast.error(ax.response?.data?.error ?? 'Could not load Solana overview')
      })
      .finally(() => setLoading(false))
  }, [])

  // 2. Socket subscription — replaces polling
  useEffect(() => {
    const socket = connectSocket()

    // Full board update (every ~20s or on manual refresh)
    const onOverview = (payload: OverviewData) => {
      setData(payload)
      setLoading(false)
    }

    // Fast 2-second real-time price ticks (lightweight price diffs)
    const onTicker = (ticks: JupiterPriceTick[]) => {
      if (!Array.isArray(ticks) || ticks.length === 0) return
      const tickMap = new Map(ticks.map((t) => [t.symbol, t]))

      setData((prev) => {
        let changed = false
        const nextRows = prev.rows.map((row) => {
          const t = tickMap.get(row.symbol)
          if (!t) return row
          if (t.lastPrice !== row.lastPrice || t.priceChangePercent !== row.priceChangePercent) {
            changed = true
            return {
              ...row,
              lastPrice: t.lastPrice,
              priceChangePercent: t.priceChangePercent,
            }
          }
          return row
        })

        if (!changed) return prev

        const updateHighlight = (list: MarketBoardRow[]) =>
          list.map((r) => {
            const t = tickMap.get(r.symbol)
            return t
              ? { ...r, lastPrice: t.lastPrice, priceChangePercent: t.priceChangePercent }
              : r
          })

        return {
          ...prev,
          rows: nextRows,
          highlights: {
            hot: updateHighlight(prev.highlights.hot),
            topGainers: updateHighlight(prev.highlights.topGainers),
            topLosers: updateHighlight(prev.highlights.topLosers),
          },
          updatedAt: new Date().toISOString(),
        }
      })
    }

    const onConnect = () => setConnected(true)
    const onDisconnect = () => setConnected(false)

    socket.on('jupiter:overview', onOverview)
    socket.on('jupiter:ticker', onTicker)
    socket.on('connect', onConnect)
    socket.on('disconnect', onDisconnect)
    if (socket.connected) setConnected(true)

    return () => {
      socket.off('jupiter:overview', onOverview)
      socket.off('jupiter:ticker', onTicker)
      socket.off('connect', onConnect)
      socket.off('disconnect', onDisconnect)
    }
  }, [])

  // Manual refresh (for the Refresh button)
  const refresh = async () => {
    try {
      const ov = await dexJupiter.overview(1500)
      setData({
        rows: ov.rows,
        highlights: ov.highlights,
        totalPairs: ov.totalPairs,
        updatedAt: ov.updatedAt,
      })
    } catch {
      toast.error('Could not refresh')
    }
  }

  return { ...data, loading, connected, refresh }
}
