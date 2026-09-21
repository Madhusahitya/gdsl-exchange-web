'use client'

import { useEffect, useRef } from 'react'
import { connectSocket, getSocket } from '@/lib/socket'
import { usePortfolio } from '@/context/PortfolioContext'
import { toast } from 'sonner'

export interface TradePayload {
  trade: {
    id: string
    pair: string
    signal: 'BUY' | 'SELL'
    price: number
    entryPrice?: number
    exitPrice?: number
    pnl?: number
    status: 'OPEN' | 'CLOSED'
  }
  currentPnl?: number
}

interface PortfolioPayload {
  totalValue: number
  pnl: number
}

interface UseSocketOptions {
  onTradeExecuted?: (payload: TradePayload) => void
}

export function useSocket(options?: UseSocketOptions) {
  const { updatePortfolio } = usePortfolio()
  /** Options object from callers is often a new reference each render — must not be a hook dependency. */
  const optionsRef = useRef(options)
  optionsRef.current = options

  useEffect(() => {
    const socket = connectSocket()

    const onTradeExecuted = (payload: TradePayload) => {
      const { trade } = payload
      const isBuy = trade.signal === 'BUY'
      const price = trade.exitPrice ?? trade.entryPrice ?? trade.price
      const priceStr = price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
      toast(`Trade executed: ${trade.pair} ${trade.signal} at $${priceStr}`, {
        style: {
          background: isBuy ? 'rgba(34, 197, 94, 0.15)' : 'rgba(239, 68, 68, 0.15)',
          border: isBuy ? '1px solid rgba(34, 197, 94, 0.35)' : '1px solid rgba(239, 68, 68, 0.35)',
          color: '#fff',
        },
      })
      optionsRef.current?.onTradeExecuted?.(payload)
    }

    const onPortfolioUpdate = (data: PortfolioPayload) => {
      updatePortfolio({ totalValue: data.totalValue, pnl: data.pnl })
      // Real-time state updated directly in React context via WebSocket.
      // Do not dispatch HTTP dashboard:refresh to avoid repeated network requests.
    }

    const onTradeFailed = (error: { type: string; reason?: string; message: string }) => {
      toast.error(`Trade failed: ${error.message}`, {
        style: {
          background: 'rgba(239, 68, 68, 0.2)',
          border: '1px solid rgba(239, 68, 68, 0.5)',
          color: '#fff',
        },
        duration: 8000,
      })
    }

    socket.on('trade:executed', onTradeExecuted)
    socket.on('trade:failed', onTradeFailed)
    socket.on('portfolio:update', onPortfolioUpdate)

    return () => {
      socket.off('trade:executed', onTradeExecuted)
      socket.off('trade:failed', onTradeFailed)
      socket.off('portfolio:update', onPortfolioUpdate)
    }
  }, [updatePortfolio])

  return getSocket()
}
