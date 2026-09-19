'use client'

import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { toast } from 'sonner'
import { engine, type ManualDesk } from '@/lib/api'
import { useSocket } from '@/hooks/useSocket'

const MIN_ORDER = 5

function fmtPx(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return '—'
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (n >= 1) return n.toFixed(4)
  return n.toFixed(6)
}

/** Binance floors BTC (etc.) to lot step — leftover quote stays in wallet. */
function estimateBuyFillUsd(spend: number, ask: number | null, stepSize: number | null): number | null {
  if (!(spend > 0) || ask == null || !(ask > 0) || stepSize == null || !(stepSize > 0)) return null
  const qty = Math.floor(spend / ask / stepSize) * stepSize
  if (!(qty > 0)) return null
  return qty * ask
}

export function useCexMarketTrade(
  symbol: string,
  onTraded?: () => void,
  livePrices?: { buyPrice?: number | null; sellPrice?: number | null },
) {
  const [desk, setDesk] = useState<ManualDesk | null>(null)
  const [loading, setLoading] = useState(true)
  const [amount, setAmount] = useState('5')
  const [sellFraction, setSellFraction] = useState(1)
  const [attachExits, setAttachExits] = useState(true)
  const [busy, setBusy] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const d = await engine.manualDesk(symbol)
      setDesk(d)
      const maxSpend = Math.min(
        d.limits.maxOrderUsd,
        Math.floor(d.balances.freeQuoteUsd * 0.95 * 100) / 100,
      )
      if (maxSpend >= MIN_ORDER) {
        setAmount((prev) => {
          const n = Number.parseFloat(prev)
          if (!Number.isFinite(n) || n > maxSpend || n < MIN_ORDER) {
            return String(Math.max(MIN_ORDER, Math.floor(maxSpend * 100) / 100))
          }
          return prev
        })
      }
    } catch {
      setDesk(null)
    } finally {
      setLoading(false)
    }
  }, [symbol])

  useEffect(() => {
    setLoading(true)
    void refresh()
  }, [refresh])

  useSocket({
    onTradeExecuted: () => {
      void refresh()
    },
  })

  useEffect(() => {
    const onRefresh = () => void refresh()
    window.addEventListener('dashboard:refresh', onRefresh)
    return () => window.removeEventListener('dashboard:refresh', onRefresh)
  }, [refresh])

  const quoteAsset = desk?.quoteAsset ?? 'USDT'
  const baseAsset = desk?.baseAsset ?? symbol.replace(/USDT$/i, '')
  const buyPrice = livePrices?.buyPrice ?? desk?.book?.ask ?? desk?.book?.mid ?? null
  const sellPrice = livePrices?.sellPrice ?? desk?.book?.bid ?? desk?.book?.mid ?? null
  const maxSpend =
    desk != null
      ? Math.min(desk.limits.maxOrderUsd, Math.floor(desk.balances.freeQuoteUsd * 0.95 * 100) / 100)
      : 0

  const spendNum = Number.parseFloat(amount)
  const estFillUsd = estimateBuyFillUsd(
    spendNum,
    buyPrice,
    desk?.rules?.stepSize ?? null,
  )
  const lotDustUsd =
    estFillUsd != null && Number.isFinite(spendNum) && spendNum - estFillUsd > 0.01
      ? spendNum - estFillUsd
      : 0

  const setSpendFraction = (frac: number) => {
    if (!desk) return
    const v = Math.max(MIN_ORDER, Math.floor(maxSpend * frac * 100) / 100)
    setAmount(String(v))
  }

  const marketBuy = async () => {
    if (!desk) return
    const spend = Number.parseFloat(amount)
    if (!Number.isFinite(spend) || spend < MIN_ORDER) {
      toast.error(`Minimum market buy is $${MIN_ORDER}`)
      return
    }
    if (spend > maxSpend) {
      toast.error(`Max spend $${maxSpend.toFixed(2)} (${quoteAsset} available)`)
      return
    }
    setBusy(true)
    try {
      const result = await engine.manualTrade({
        symbol: desk.tradeSymbol ?? symbol,
        side: 'BUY',
        quoteOrderQty: spend,
        attachExits,
      })
      toast.success(
        `Market BUY ${result.pair} · spent $${result.quoteValue.toFixed(2)} ${quoteAsset} · ${result.filledQty.toFixed(8)} @ ${fmtPx(result.avgPrice)}`,
      )
      if (result.quoteValue + 0.01 < spend) {
        toast.info(
          `$${(spend - result.quoteValue).toFixed(2)} ${quoteAsset} stayed in your wallet — Binance buys BTC in 0.00001 steps, so small remainders are normal.`,
        )
      }
      if (result.note) toast.info(result.note)
      await refresh()
      onTraded?.()
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error as string) || e.message : 'Buy failed'
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  const marketSell = async () => {
    if (!desk) return
    if (desk.balances.freeBase <= 0) {
      toast.error(`No ${baseAsset} to sell on Binance`)
      return
    }
    setBusy(true)
    try {
      const result = await engine.manualTrade({
        symbol: desk.tradeSymbol ?? symbol,
        side: 'SELL',
        fraction: sellFraction,
      })
      toast.success(
        `Market SELL ${result.pair} · ${result.filledQty.toFixed(6)} @ ${fmtPx(result.avgPrice)}`,
      )
      await refresh()
      onTraded?.()
    } catch (e) {
      const msg = axios.isAxiosError(e) ? (e.response?.data?.error as string) || e.message : 'Sell failed'
      toast.error(msg)
    } finally {
      setBusy(false)
    }
  }

  return {
    desk,
    loading,
    busy,
    amount,
    setAmount,
    sellFraction,
    setSellFraction,
    attachExits,
    setAttachExits,
    quoteAsset,
    baseAsset,
    buyPrice,
    sellPrice,
    maxSpend,
    estFillUsd,
    lotDustUsd,
    setSpendFraction,
    marketBuy,
    marketSell,
    refresh,
  }
}
