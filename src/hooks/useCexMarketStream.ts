'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { engine } from '@/lib/api'

export type DepthLevel = { price: number; qty: number }

export type MarketTrade = {
  id: number
  price: number
  qty: number
  time: number
  isBuyerMaker: boolean
}

export interface CexMarketStreamState {
  bids: DepthLevel[]
  asks: DepthLevel[]
  bestBid: number | null
  bestAsk: number | null
  mid: number | null
  spreadBps: number | null
  trades: MarketTrade[]
  connected: boolean
  refresh: () => Promise<void>
}

function normalizePair(symbol: string): string {
  return symbol.replace('/', '').toUpperCase()
}

/**
 * High-performance real-time WebSocket market stream for Binance pairs.
 * Fetches an initial snapshot once on symbol change, then continuously streams:
 *  - Order book depth (1000ms updates)
 *  - Real-time trade executions
 *  - Mid-price and spread BPS
 *
 * Replaces recurring HTTP polling loops with a zero-cost, low-latency WebSocket connection.
 */
export function useCexMarketStream(symbol: string, depth: number = 14): CexMarketStreamState {
  const [bids, setBids] = useState<DepthLevel[]>([])
  const [asks, setAsks] = useState<DepthLevel[]>([])
  const [bestBid, setBestBid] = useState<number | null>(null)
  const [bestAsk, setBestAsk] = useState<number | null>(null)
  const [mid, setMid] = useState<number | null>(null)
  const [spreadBps, setSpreadBps] = useState<number | null>(null)
  const [trades, setTrades] = useState<MarketTrade[]>([])
  const [connected, setConnected] = useState(false)

  const pair = normalizePair(symbol)
  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const refreshSnapshot = useCallback(async () => {
    if (!pair) return
    try {
      const fetchDepth = async () => {
        try {
          const r = await fetch(
            `https://data-api.binance.vision/api/v3/depth?symbol=${encodeURIComponent(pair)}&limit=${depth}`,
          )
          if (r.ok) {
            const data = (await r.json()) as {
              bids?: [string, string][]
              asks?: [string, string][]
            }
            const bids = (data.bids ?? []).map(([p, q]) => ({ price: Number(p), qty: Number(q) }))
            const asks = (data.asks ?? []).map(([p, q]) => ({ price: Number(p), qty: Number(q) }))
            const bestBid = bids[0]?.price ?? null
            const bestAsk = asks[0]?.price ?? null
            const mid =
              bestBid != null && bestAsk != null && bestBid > 0 && bestAsk > 0
                ? (bestBid + bestAsk) / 2
                : (bestBid ?? bestAsk)
            const spreadBps =
              mid != null && bestBid != null && bestAsk != null
                ? ((bestAsk - bestBid) / mid) * 10_000
                : null
            return { bids, asks, mid, spreadBps }
          }
        } catch {
          /* try backend */
        }
        return await engine.orderBook(pair, depth)
      }

      const fetchTrades = async () => {
        try {
          const r = await fetch(
            `https://data-api.binance.vision/api/v3/trades?symbol=${encodeURIComponent(pair)}&limit=20`,
          )
          if (r.ok) return r
        } catch {
          /* fallback */
        }
        return await fetch(
          `https://api.binance.com/api/v3/trades?symbol=${encodeURIComponent(pair)}&limit=20`,
        )
      }

      const [bookRes, tradesRes] = await Promise.allSettled([fetchDepth(), fetchTrades()])

      if (bookRes.status === 'fulfilled' && bookRes.value) {
        const d = bookRes.value
        const nextBids = d.bids?.slice(0, depth) ?? []
        const topBid = nextBids[0]?.price ?? null
        const topAsk = d.asks?.[0]?.price ?? null
        setBids(nextBids)
        setAsks([...(d.asks ?? [])].slice(0, depth).reverse())
        if (topBid != null && topBid > 0) setBestBid(topBid)
        if (topAsk != null && topAsk > 0) setBestAsk(topAsk)
        setMid(d.mid ?? null)
        setSpreadBps(d.spreadBps ?? null)
      }

      if (tradesRes.status === 'fulfilled' && tradesRes.value.ok) {
        const rows = (await tradesRes.value.json()) as Array<{
          id: number
          price: string
          qty: string
          time: number
          isBuyerMaker: boolean
        }>
        setTrades(
          rows.map((r) => ({
            id: r.id,
            price: Number(r.price),
            qty: Number(r.qty),
            time: r.time,
            isBuyerMaker: r.isBuyerMaker,
          })),
        )
      }
    } catch {
      /* non-fatal snapshot error */
    }
  }, [pair, depth])

  // 1. Initial snapshot on pair/depth change
  useEffect(() => {
    void refreshSnapshot()
  }, [refreshSnapshot])

  // 2. Real-time WebSocket connection to Binance stream
  useEffect(() => {
    if (!pair || typeof window === 'undefined') return

    let isDisposed = false
    const streamSymbol = pair.toLowerCase()
    const url = `wss://stream.binance.com:9443/stream?streams=${streamSymbol}@depth20@1000ms/${streamSymbol}@trade`

    const connect = () => {
      if (isDisposed) return
      try {
        const ws = new WebSocket(url)
        wsRef.current = ws

        ws.onopen = () => {
          if (isDisposed) {
            ws.close()
            return
          }
          setConnected(true)
        }

        ws.onmessage = (event) => {
          if (isDisposed) return
          try {
            const message = JSON.parse(event.data) as {
              stream?: string
              data?: {
                bids?: Array<[string, string]>
                asks?: Array<[string, string]>
                t?: number
                p?: string
                q?: string
                T?: number
                m?: boolean
              }
            }

            if (message.stream?.endsWith('@depth20@1000ms') && message.data) {
              const rawBids = message.data.bids ?? []
              const rawAsks = message.data.asks ?? []

              const nextBids: DepthLevel[] = rawBids.slice(0, depth).map(([p, q]) => ({
                price: Number(p),
                qty: Number(q),
              }))
              const nextAsks: DepthLevel[] = rawAsks.slice(0, depth).map(([p, q]) => ({
                price: Number(p),
                qty: Number(q),
              })).reverse()

              const bestBid = nextBids[0]?.price ?? null
              const bestAsk = rawAsks[0] ? Number(rawAsks[0][0]) : null

              setBids(nextBids)
              setAsks(nextAsks)
              if (bestBid != null && bestBid > 0) setBestBid(bestBid)
              if (bestAsk != null && bestAsk > 0) setBestAsk(bestAsk)

              if (bestBid != null && bestAsk != null && bestBid > 0 && bestAsk > 0) {
                const nextMid = (bestBid + bestAsk) / 2
                const nextSpread = ((bestAsk - bestBid) / nextMid) * 10_000
                setMid(nextMid)
                setSpreadBps(nextSpread)
              }
            } else if (message.stream?.endsWith('@trade') && message.data) {
              const t = message.data
              if (t.t && t.p && t.q) {
                const newTrade: MarketTrade = {
                  id: t.t,
                  price: Number(t.p),
                  qty: Number(t.q),
                  time: t.T ?? Date.now(),
                  isBuyerMaker: Boolean(t.m),
                }
                setTrades((prev) => [newTrade, ...prev.slice(0, 19)])
              }
            }
          } catch {
            /* ignore corrupted frame */
          }
        }

        ws.onclose = () => {
          setConnected(false)
          wsRef.current = null
          if (!isDisposed) {
            reconnectTimerRef.current = setTimeout(connect, 3_000)
          }
        }

        ws.onerror = () => {
          ws.close()
        }
      } catch {
        if (!isDisposed) {
          reconnectTimerRef.current = setTimeout(connect, 5_000)
        }
      }
    }

    connect()

    return () => {
      isDisposed = true
      if (reconnectTimerRef.current) clearTimeout(reconnectTimerRef.current)
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [pair, depth])

  return {
    bids,
    asks,
    bestBid,
    bestAsk,
    mid,
    spreadBps,
    trades,
    connected,
    refresh: refreshSnapshot,
  }
}
