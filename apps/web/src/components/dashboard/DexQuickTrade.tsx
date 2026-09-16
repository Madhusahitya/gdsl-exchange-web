'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useAccount, useBalance, useChainId, useConnect, useDisconnect, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { bsc } from 'wagmi/chains'
import { formatEther, formatUnits, maxUint256, parseUnits } from 'viem'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { DexWalletPicker } from '@/components/web3/DexWalletPicker'
import { engine } from '@/lib/api'
import {
  BSC_CHAIN_ID,
  PANCAKE_V2_ROUTER,
  USDT_BSC,
  WBNB,
  erc20Abi,
  routerAbi,
  SWAP_PATH_BUY,
  SWAP_PATH_SELL,
} from '@/lib/dex/bsc'
import { readConnectorChainId, waitForConnectorChain } from '@/lib/wagmi/connectorChain'

type DexQuickTradeEvent = {
  id: string
  type: 'BUY' | 'SELL'
  mode: 'manual' | 'auto'
  amountUsdt: number
  price: number | null
  quoteOut: string
  happenedAt: string
  profit?: number // Profit/loss for this trade
  totalProfit?: number // Running total profit
}

const MAX_EVENTS = 8

const PRICE_POLL_MS = 15_000
const SIGNAL_POLL_MS = 30_000
const DEFAULT_SLIPPAGE_BPS = 200n

type EngineSignal = {
  signal: 'BUY' | 'SELL' | 'HOLD'
  confidence: number
  minConfidenceRequired: number | null
  features: Record<string, unknown> | null
  updatedAt: string | null
}

type OpenSourceSignalResponse = {
  symbol: string
  updatedAt: string
  providerCount: number
  consensus: {
    signal: 'BUY' | 'SELL' | 'HOLD'
    confidence: number
    counts: { buy: number; sell: number; hold: number }
  }
  providers: Array<{
    id: string
    name: string
    sourceUrl: string
    signal: 'BUY' | 'SELL' | 'HOLD'
    confidence: number
    note?: string
    features?: Record<string, unknown> | null
  }>
}

// Production safety limits
const MAX_TRADE_SIZE_USDT = Number(process.env.NEXT_PUBLIC_MAX_TRADE_SIZE_USDT || '100')
const MAX_DAILY_TRADES = Number(process.env.NEXT_PUBLIC_MAX_DAILY_TRADES || '10')
const MAX_DAILY_VOLUME_USDT = Number(process.env.NEXT_PUBLIC_MAX_DAILY_VOLUME_USDT || '500')
const EMERGENCY_STOP_ENABLED = process.env.NEXT_PUBLIC_EMERGENCY_STOP_ENABLED === 'true'

async function fetchBnbUsdtPrice(): Promise<number | null> {
  try {
    const res = await fetch('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT')
    const data = (await res.json()) as { price?: string }
    if (!data.price) return null
    return parseFloat(data.price)
  } catch {
    return null
  }
}

function parseBps(slippagePercent: string): bigint {
  const n = parseFloat(slippagePercent)
  if (!Number.isFinite(n) || n <= 0 || n > 50) return DEFAULT_SLIPPAGE_BPS
  return BigInt(Math.round(n * 100))
}

export default function DexQuickTrade() {
  const { address, isConnected, connector } = useAccount()
  const chainId = useChainId()
  const { connectors, connect, isPending: connectPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain, switchChainAsync, isPending: switchPending } = useSwitchChain()
  const publicClient = usePublicClient()
  const { writeContractAsync, isPending: writePending } = useWriteContract()
  const { data: bnbNative } = useBalance({
    address,
    chainId: bsc.id,
    query: { enabled: Boolean(address && chainId === bsc.id) },
  })

  const [usdtBal, setUsdtBal] = useState<bigint | null>(null)
  const [wbnbBal, setWbnbBal] = useState<bigint | null>(null)
  const [lastPrice, setLastPrice] = useState<number | null>(null)
  const [tradeAmount, setTradeAmount] = useState('10')
  const [buyTarget, setBuyTarget] = useState('100')
  const [sellTarget, setSellTarget] = useState('105')
  const [slippagePercent, setSlippagePercent] = useState('2')
  const [autoTrade, setAutoTrade] = useState(true)
  const [inPosition, setInPosition] = useState(false)
  const [status, setStatus] = useState('Ready')
  const [lastUpdatedAt, setLastUpdatedAt] = useState<Date | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [engineSignal, setEngineSignal] = useState<EngineSignal | null>(null)
  const [engineSignalError, setEngineSignalError] = useState<string | null>(null)
  const [openSignal, setOpenSignal] = useState<OpenSourceSignalResponse | null>(null)
  const [openSignalError, setOpenSignalError] = useState<string | null>(null)
  const [emergencyStop, setEmergencyStop] = useState(false)
  /** Empty `date` until client hydrates from localStorage (SSR-safe). */
  const [dailyStats, setDailyStats] = useState<{ trades: number; volume: number; date: string }>({
    trades: 0,
    volume: 0,
    date: '',
  })
  const [events, setEvents] = useState<DexQuickTradeEvent[]>([])
  const [costBasis, setCostBasis] = useState(0)
  const [dexQuickHydrated, setDexQuickHydrated] = useState(false)
  /** SSR false vs restored wagmi session on client breaks DexWalletPicker vs connected markup unless gated to mount. */
  const [clientMounted, setClientMounted] = useState(false)

  useEffect(() => {
    setClientMounted(true)
  }, [])

  useEffect(() => {
    setInPosition(localStorage.getItem('dex_quick_in_position') === '1')
    setEmergencyStop(localStorage.getItem('dex_emergency_stop') === '1')
    const ds = localStorage.getItem('dex_daily_stats')
    setDailyStats(
      ds
        ? (JSON.parse(ds) as { trades: number; volume: number; date: string })
        : { trades: 0, volume: 0, date: new Date().toDateString() },
    )
    const rawEv = localStorage.getItem('dex_quick_events')
    setEvents(rawEv ? (JSON.parse(rawEv) as DexQuickTradeEvent[]) : [])
    const cb = localStorage.getItem('dex_cost_basis')
    setCostBasis(cb ? parseFloat(cb) : 0)
    const bt = localStorage.getItem('dex_quick_buy_target')
    const st = localStorage.getItem('dex_quick_sell_target')
    const ta = localStorage.getItem('dex_quick_trade_amount')
    const at = localStorage.getItem('dex_quick_auto')
    if (bt) setBuyTarget(bt)
    if (st) setSellTarget(st)
    if (ta) setTradeAmount(ta)
    if (at !== null) setAutoTrade(at === '1')
    setDexQuickHydrated(true)
  }, [])

  const wrongChain = isConnected && chainId !== BSC_CHAIN_ID
  const busyRef = useRef(false)
  const autoTriggeredRef = useRef(false)

  const buyTargetNum = useMemo(() => parseFloat(buyTarget), [buyTarget])
  const sellTargetNum = useMemo(() => parseFloat(sellTarget), [sellTarget])
  const amountInUsdt = useMemo(() => parseFloat(tradeAmount), [tradeAmount])
  const slippageBps = useMemo(() => parseBps(slippagePercent), [slippagePercent])

  const savePosition = useCallback(
    (hasPosition: boolean) => {
      setInPosition(hasPosition)
      if (typeof window === 'undefined') return
      localStorage.setItem('dex_quick_in_position', hasPosition ? '1' : '0')
    },
    [],
  )

  const updateDailyStats = useCallback((tradeAmount: number) => {
    setDailyStats(prev => {
      const today = new Date().toDateString()
      const newStats = prev.date === today
        ? { ...prev, trades: prev.trades + 1, volume: prev.volume + tradeAmount }
        : { trades: 1, volume: tradeAmount, date: today }

      if (typeof window !== 'undefined') {
        localStorage.setItem('dex_daily_stats', JSON.stringify(newStats))
      }
      return newStats
    })
  }, [])

  const checkDailyLimits = useCallback((tradeAmount: number): boolean => {
    const today = new Date().toDateString()
    const currentStats = dailyStats.date === today ? dailyStats : { trades: 0, volume: 0, date: today }

    if (currentStats.trades >= MAX_DAILY_TRADES) {
      setError(`Daily trade limit exceeded (${MAX_DAILY_TRADES})`)
      return false
    }
    if (currentStats.volume + tradeAmount > MAX_DAILY_VOLUME_USDT) {
      setError(`Daily volume limit exceeded ($${MAX_DAILY_VOLUME_USDT})`)
      return false
    }
    return true
  }, [dailyStats])

  const resetDexData = useCallback(() => {
    setEvents([])
    setCostBasis(0)
    setInPosition(false)
    setEmergencyStop(false)
    setDailyStats({ trades: 0, volume: 0, date: new Date().toDateString() })
    setError(null)
    if (typeof window !== 'undefined') {
      localStorage.removeItem('dex_quick_events')
      localStorage.removeItem('dex_cost_basis')
      localStorage.removeItem('dex_quick_in_position')
      localStorage.removeItem('dex_emergency_stop')
      localStorage.removeItem('dex_daily_stats')
      localStorage.removeItem('dex_quick_buy_target')
      localStorage.removeItem('dex_quick_sell_target')
      localStorage.removeItem('dex_quick_trade_amount')
      localStorage.removeItem('dex_quick_auto')
    }
    toast.success('DEX data reset for fresh testing')
  }, [])

  const toggleEmergencyStop = useCallback(() => {
    const newState = !emergencyStop
    setEmergencyStop(newState)
    if (typeof window !== 'undefined') {
      localStorage.setItem('dex_emergency_stop', newState ? '1' : '0')
    }
    toast.success(newState ? 'Emergency stop activated' : 'Emergency stop deactivated')
  }, [emergencyStop])

  const persistEvents = useCallback(
    (nextEvents: DexQuickTradeEvent[] | ((prev: DexQuickTradeEvent[]) => DexQuickTradeEvent[])) => {
      setEvents((prevEvents) => {
        const next = typeof nextEvents === 'function' ? nextEvents(prevEvents) : nextEvents
        const trimmed = next.slice(0, MAX_EVENTS)
        if (typeof window !== 'undefined') {
          localStorage.setItem('dex_quick_events', JSON.stringify(trimmed))
        }
        return trimmed
      })
    },
    [],
  )

  const totalBuys = useMemo(() => events.filter((event) => event.type === 'BUY').length, [events])
  const totalSells = useMemo(() => events.filter((event) => event.type === 'SELL').length, [events])
  const totalBuyUsd = useMemo(
    () => events.filter((event) => event.type === 'BUY').reduce((sum, event) => sum + event.amountUsdt, 0),
    [events],
  )
  const totalSellUsd = useMemo(
    () => events.filter((event) => event.type === 'SELL').reduce((sum, event) => sum + event.amountUsdt, 0),
    [events],
  )
  const totalProfit = useMemo(() => {
    return events.reduce((sum, event) => sum + (event.profit || 0), 0)
  }, [events])
  const totalInvested = useMemo(() => {
    return events.filter(event => event.type === 'BUY').reduce((sum, event) => sum + event.amountUsdt, 0)
  }, [events])
  const returnPercentage = useMemo(() => {
    return totalInvested > 0 ? (totalProfit / totalInvested) * 100 : 0
  }, [totalProfit, totalInvested])
  const winRate = useMemo(() => {
    const profitableTrades = events.filter(event => (event.profit || 0) > 0).length
    const totalTrades = events.filter(event => event.type === 'SELL').length
    return totalTrades > 0 ? (profitableTrades / totalTrades) * 100 : 0
  }, [events])
  const lastEvent = events[0] ?? null

  const fetchEngineSignal = useCallback(async () => {
    try {
      const [raw, openRaw] = await Promise.all([engine.signal(), engine.openSourceSignal()])
      const normalizedSignal = (raw.signal === 'BUY' || raw.signal === 'SELL' ? raw.signal : 'HOLD') as EngineSignal['signal']
      setEngineSignal({
        ...raw,
        signal: normalizedSignal,
      })
      setEngineSignalError(null)
      setOpenSignal(openRaw)
      setOpenSignalError(null)
    } catch (err) {
      if (err instanceof Error) {
        setEngineSignalError(err.message)
        setOpenSignalError(err.message)
      } else {
        setEngineSignalError('Failed to load engine signal')
        setOpenSignalError('Failed to load open-source signal providers')
      }
      setEngineSignal(null)
      setOpenSignal(null)
    }
  }, [])

  const signalSummary = useMemo(() => {
    if (engineSignalError) {
      return 'Signal unavailable'
    }
    if (!engineSignal) {
      return isConnected ? 'Loading engine signal…' : 'Connect wallet to load engine signal'
    }
    const confidence = `${Math.round(engineSignal.confidence * 100)}%`
    switch (engineSignal.signal) {
      case 'BUY':
        return `BUY signal • confidence ${confidence}`
      case 'SELL':
        return `SELL signal • confidence ${confidence}`
      default:
        return `HOLD signal • confidence ${confidence}`
    }
  }, [engineSignal, engineSignalError, isConnected])

  const signalActionDetail = useMemo(() => {
    if (engineSignalError) {
      return engineSignalError
    }
    if (!engineSignal) {
      return isConnected ? 'Awaiting latest engine recommendation.' : 'Connect wallet to fetch the DEX signal.'
    }
    if (engineSignal.signal === 'BUY') {
      return inPosition ? 'Engine suggests waiting to add more once you close the current position.' : 'Engine recommends buying BNB.'
    }
    if (engineSignal.signal === 'SELL') {
      return inPosition ? 'Engine recommends selling existing position.' : 'Engine suggests holding until a buy signal arrives.'
    }
    return 'Engine recommends holding until conditions improve.'
  }, [engineSignal, engineSignalError, inPosition, isConnected])

  const signalFeatures = useMemo(() => {
    if (!engineSignal?.features) return []
    return Object.entries(engineSignal.features).slice(0, 4)
  }, [engineSignal])

  const refreshBalances = useCallback(async () => {
    if (!publicClient || !address) return
    try {
      const [u, w] = await Promise.all([
        publicClient.readContract({
          address: USDT_BSC,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        }),
        publicClient.readContract({
          address: WBNB,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        }),
      ])
      setUsdtBal(u)
      setWbnbBal(w)
    } catch {
      setUsdtBal(null)
      setWbnbBal(null)
    }
  }, [publicClient, address])

  useEffect(() => {
    const loadPrice = async () => {
      const price = await fetchBnbUsdtPrice()
      setLastPrice(price)
      if (price !== null) {
        setLastUpdatedAt(new Date())
      }
    }
    void loadPrice()
    const id = window.setInterval(loadPrice, PRICE_POLL_MS)
    return () => clearInterval(id)
  }, [])

  useEffect(() => {
    void refreshBalances()
  }, [refreshBalances, address, chainId])

  useEffect(() => {
    if (typeof window === 'undefined' || !dexQuickHydrated) return
    localStorage.setItem('dex_quick_buy_target', buyTarget)
    localStorage.setItem('dex_quick_sell_target', sellTarget)
    localStorage.setItem('dex_quick_trade_amount', tradeAmount)
    localStorage.setItem('dex_quick_auto', autoTrade ? '1' : '0')
  }, [buyTarget, sellTarget, tradeAmount, autoTrade, dexQuickHydrated])

  useEffect(() => {
    if (!isConnected) return
    void fetchEngineSignal()
    const id = window.setInterval(() => {
      void fetchEngineSignal()
    }, SIGNAL_POLL_MS)
    return () => clearInterval(id)
  }, [fetchEngineSignal, isConnected])

  useEffect(() => {
    if (!autoTrade || busyRef.current || wrongChain || !isConnected || lastPrice === null || (EMERGENCY_STOP_ENABLED && emergencyStop)) return
    if (!inPosition && Number.isFinite(buyTargetNum) && lastPrice <= buyTargetNum) {
      autoTriggeredRef.current = true
      void executeBuy('auto')
      return
    }
    if (inPosition && Number.isFinite(sellTargetNum) && lastPrice >= sellTargetNum) {
      autoTriggeredRef.current = true
      void executeSell()
      return
    }
  }, [autoTrade, lastPrice, inPosition, buyTargetNum, sellTargetNum, wrongChain, isConnected])

  const ensureBsc = useCallback(async (): Promise<boolean> => {
    const live = await readConnectorChainId(connector)
    if (live === BSC_CHAIN_ID) return true
    try {
      if (typeof switchChainAsync === 'function') {
        await switchChainAsync({ chainId: BSC_CHAIN_ID })
      } else {
        await switchChain?.({ chainId: BSC_CHAIN_ID })
        toast.info('Approve switching to BNB Smart Chain in your wallet.')
      }
      const synced = await waitForConnectorChain(connector, BSC_CHAIN_ID)
      if (!synced) {
        toast.error(
          'Wallet did not switch to BNB Smart Chain (56). Use MetaMask → Networks → BNB Chain, or reconnect with MetaMask only.',
        )
        return false
      }
      return true
    } catch {
      toast.error('Switch to BNB Smart Chain in your wallet.')
      return false
    }
  }, [connector, switchChain, switchChainAsync])

  const validateTrade = useCallback(() => {
    if (!isConnected) {
      toast.error('Connect a wallet first.')
      return false
    }
    if (!publicClient) {
      toast.error('Wallet client not ready.')
      return false
    }
    if (EMERGENCY_STOP_ENABLED && emergencyStop) {
      toast.error('Emergency stop is active. Trading disabled.')
      return false
    }
    if (!Number.isFinite(amountInUsdt) || amountInUsdt <= 0) {
      toast.error('Enter a valid USDT amount.')
      return false
    }
    if (amountInUsdt > MAX_TRADE_SIZE_USDT) {
      toast.error(`Trade size exceeds maximum limit of $${MAX_TRADE_SIZE_USDT}`)
      return false
    }
    if (!checkDailyLimits(amountInUsdt)) {
      return false
    }
    if (amountInUsdt > 0 && usdtBal !== null) {
      const desired = parseUnits(String(amountInUsdt), 18)
      if (desired > usdtBal) {
        toast.error('Not enough USDT in wallet for this buy amount.')
        return false
      }
    }
    return true
  }, [amountInUsdt, buyTargetNum, sellTargetNum, isConnected, publicClient, usdtBal, emergencyStop, checkDailyLimits])

  const executeBuy = useCallback(
    async (mode: 'manual' | 'auto') => {
      if (!validateTrade()) return
      if (!address || !publicClient) return
      if (busyRef.current) return
      busyRef.current = true
      setStatus('Executing buy…')
      setError(null)
      try {
        const ok = await ensureBsc()
        if (!ok) return

        const amountIn = parseUnits(String(amountInUsdt), 18)
        if (amountIn <= 0n) {
          toast.error('Amount must be a positive USDT value.')
          return
        }

        const allowance = await publicClient.readContract({
          address: USDT_BSC,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, PANCAKE_V2_ROUTER],
        })

        if (allowance < amountIn) {
          setStatus('Approving USDT…')
          const approveHash = await writeContractAsync({
            chainId: bsc.id,
            address: USDT_BSC,
            abi: erc20Abi,
            functionName: 'approve',
            args: [PANCAKE_V2_ROUTER, maxUint256],
          })
          await publicClient.waitForTransactionReceipt({ hash: approveHash })
        }

        setStatus('Preparing buy swap…')
        const amounts = await publicClient.readContract({
          address: PANCAKE_V2_ROUTER,
          abi: routerAbi,
          functionName: 'getAmountsOut',
          args: [amountIn, [...SWAP_PATH_BUY]],
        })
        const expectedOut = amounts[1] as bigint
        const amountOutMin = (expectedOut * (10_000n - slippageBps)) / 10_000n
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20)

        setStatus('Submitting buy swap…')
        const hash = await writeContractAsync({
          chainId: bsc.id,
          address: PANCAKE_V2_ROUTER,
          abi: routerAbi,
          functionName: 'swapExactTokensForTokens',
          args: [amountIn, amountOutMin, [...SWAP_PATH_BUY], address, deadline],
        })
        await publicClient.waitForTransactionReceipt({ hash })
        toast.success(`Buy swap confirmed (${mode === 'auto' ? 'auto' : 'manual'}).`)
        savePosition(true)
        setCostBasis(amountInUsdt)
        if (typeof window !== 'undefined') {
          localStorage.setItem('dex_cost_basis', amountInUsdt.toString())
        }
        updateDailyStats(amountInUsdt)
        const quoteOut = formatUnits(expectedOut, 18)
        persistEvents((prev) => [
          {
            id: String(Date.now()),
            type: 'BUY',
            mode,
            amountUsdt: amountInUsdt,
            price: lastPrice,
            quoteOut,
            happenedAt: new Date().toISOString(),
          },
          ...prev,
        ])
        await refreshBalances()
        setStatus('Ready')
      } catch (err) {
        const message = err instanceof Error ? err.message : 'Buy swap failed'
        setStatus('Ready')
        setError(message)
        toast.error(message)
      } finally {
        busyRef.current = false
      }
    },
    [address, amountInUsdt, ensureBsc, publicClient, refreshBalances, savePosition, slippageBps, validateTrade, writeContractAsync],
  )

  const executeSell = useCallback(async () => {
    if (!isConnected) {
      toast.error('Connect a wallet first.')
      return
    }
    if (!publicClient || !address) return
    if (!wbnbBal || wbnbBal === 0n) {
      toast.error('No WBNB balance to sell.')
      return
    }
    if (busyRef.current) return
    busyRef.current = true
    setStatus('Executing sell…')
    setError(null)
    try {
      const ok = await ensureBsc()
      if (!ok) return

      const amountIn = wbnbBal
      const allowance = await publicClient.readContract({
        address: WBNB,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, PANCAKE_V2_ROUTER],
      })
      if (allowance < amountIn) {
        setStatus('Approving WBNB…')
        const approveHash = await writeContractAsync({
          chainId: bsc.id,
          address: WBNB,
          abi: erc20Abi,
          functionName: 'approve',
          args: [PANCAKE_V2_ROUTER, maxUint256],
        })
        await publicClient.waitForTransactionReceipt({ hash: approveHash })
      }

      setStatus('Preparing sell swap…')
      const amounts = await publicClient.readContract({
        address: PANCAKE_V2_ROUTER,
        abi: routerAbi,
        functionName: 'getAmountsOut',
        args: [amountIn, [...SWAP_PATH_SELL]],
      })
      const expectedOut = amounts[1] as bigint
      const amountOutMin = (expectedOut * (10_000n - slippageBps)) / 10_000n
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20)

      setStatus('Submitting sell swap…')
      const hash = await writeContractAsync({
        chainId: bsc.id,
        address: PANCAKE_V2_ROUTER,
        abi: routerAbi,
        functionName: 'swapExactTokensForTokens',
        args: [amountIn, amountOutMin, [...SWAP_PATH_SELL], address, deadline],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      const sellAmount = parseFloat(formatUnits(expectedOut, 18))
      const profit = sellAmount - costBasis
      const currentTotalProfit = totalProfit + profit

      toast.success(`Sell swap confirmed. Profit: $${profit.toFixed(2)}`)
      savePosition(false)
      setCostBasis(0)
      if (typeof window !== 'undefined') {
        localStorage.setItem('dex_cost_basis', '0')
      }
      updateDailyStats(sellAmount)
      const quoteOut = formatUnits(amountIn, 18)
      persistEvents((prev) => [
        {
          id: String(Date.now()),
          type: 'SELL',
          mode: 'manual',
          amountUsdt: sellAmount,
          price: lastPrice,
          quoteOut,
          happenedAt: new Date().toISOString(),
          profit,
          totalProfit: currentTotalProfit,
        },
        ...prev,
      ])
      await refreshBalances()
      setStatus('Ready')
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Sell swap failed'
      setStatus('Ready')
      setError(message)
      toast.error(message)
    } finally {
      busyRef.current = false
    }
  }, [address, ensureBsc, isConnected, publicClient, refreshBalances, savePosition, slippageBps, wbnbBal, writeContractAsync])

  return (
    <Card className="border-white/10 bg-[#050708]">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-base font-medium text-white">Quick DEX swap</CardTitle>
          <p className="text-xs text-zinc-500">
            Buy on PancakeSwap when BNB ≤ target and sell when BNB ≥ target. Uses your wallet on BSC.
          </p>
        </div>
        <span className="text-xs font-mono text-emerald-400">{status}</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">Current market</p>
            <p className="mt-2 text-lg font-semibold text-white">{lastPrice !== null ? `$${lastPrice.toFixed(2)}` : 'Loading…'}</p>
            <p className="text-xs text-zinc-500">Updated {lastUpdatedAt ? lastUpdatedAt.toLocaleTimeString() : '—'}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">Wallet balances</p>
            <p className="mt-2 text-sm text-white">BNB: {bnbNative ? formatEther(bnbNative.value) : '—'}</p>
            <p className="text-sm text-white">USDT: {usdtBal !== null ? formatUnits(usdtBal, 18) : '—'}</p>
            <p className="text-sm text-white">WBNB: {wbnbBal !== null ? formatUnits(wbnbBal, 18) : '—'}</p>
            <Button variant="ghost" size="sm" className="mt-2 px-0" onClick={() => void refreshBalances()}>
              Refresh balances
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">Recent execution</p>
            <p className="mt-2 text-sm text-white">Buys: {totalBuys}</p>
            <p className="text-sm text-white">Sells: {totalSells}</p>
            <p className="text-sm text-white">Buy USDT total: ${totalBuyUsd.toFixed(2)}</p>
            <p className="text-sm text-white">Sell USDT total: ${totalSellUsd.toFixed(2)}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">Daily Trading Limits</p>
            <p className="mt-2 text-sm text-white">Trades: {dailyStats.trades}/{MAX_DAILY_TRADES}</p>
            <p className="text-sm text-white">Volume: ${dailyStats.volume.toFixed(2)}/${MAX_DAILY_VOLUME_USDT}</p>
            <p className="text-xs text-zinc-500">Max trade: ${MAX_TRADE_SIZE_USDT}</p>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">Safety Controls</p>
            <p className="mt-2 text-sm text-white">Emergency Stop: {emergencyStop ? 'ACTIVE' : 'Inactive'}</p>
            <p className="text-xs text-zinc-500">Auto trading: {autoTrade && !emergencyStop ? 'Enabled' : 'Disabled'}</p>
            <Button
              variant="outline"
              size="sm"
              className={`mt-2 ${emergencyStop ? 'bg-red-900/20 border-red-500/50' : ''}`}
              onClick={toggleEmergencyStop}
            >
              {emergencyStop ? 'Deactivate Stop' : 'Emergency Stop'}
            </Button>
          </div>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">DEX Profit Analysis</p>
            <p className="mt-2 text-lg font-semibold text-white">
              {totalProfit >= 0 ? `+$${totalProfit.toFixed(2)}` : `-$${Math.abs(totalProfit).toFixed(2)}`}
            </p>
            <p className="text-xs text-zinc-500">
              {returnPercentage !== 0 ? `${returnPercentage >= 0 ? '+' : ''}${returnPercentage.toFixed(2)}% return` : 'No returns yet'}
            </p>
            <p className="text-xs text-zinc-500">
              {totalSells > 0 ? `${winRate.toFixed(1)}% win rate` : 'No completed trades'}
            </p>
            <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={resetDexData}>
              Reset DEX Data
            </Button>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">Current Position</p>
            <p className="mt-2 text-lg font-semibold text-white">{inPosition ? 'WBNB held' : 'No open position'}</p>
            <p className="text-xs text-zinc-500">
              Cost basis: {costBasis > 0 ? `$${costBasis.toFixed(2)}` : '—'}
            </p>
            <p className="text-xs text-zinc-500">Last action: {lastEvent ? `${lastEvent.type} ${lastEvent.amountUsdt.toFixed(2)} USDT` : 'none'}</p>
          </div>
        </div>

        {!clientMounted ? (
          <div className="min-h-[52px] rounded-lg border border-white/10 bg-white/5" aria-busy aria-label="Loading wallet status" />
        ) : !isConnected ? (
          <div>
            <DexWalletPicker
              connectors={connectors}
              connectPending={connectPending}
              onConnect={(connector) =>
                connect({ connector }, { onError(err) { toast.error(err.message ?? 'Could not connect wallet') }})
              }
            />
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-gray-300 font-mono">Connected {address}</span>
            <Button variant="outline" size="sm" onClick={() => disconnect()}>Disconnect</Button>
            {wrongChain && (
              <Button type="button" disabled={switchPending} onClick={() => void switchChain?.({ chainId: BSC_CHAIN_ID })}>
                {switchPending ? 'Switching…' : 'Switch to BSC'}
              </Button>
            )}
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-3">
          <label className="space-y-1">
            <span className="text-xs text-zinc-400">USDT trade size</span>
            <Input value={tradeAmount} onChange={(e) => setTradeAmount(e.target.value)} className="pb-input" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-zinc-400">Buy at or below $</span>
            <Input value={buyTarget} onChange={(e) => setBuyTarget(e.target.value)} className="pb-input" />
          </label>
          <label className="space-y-1">
            <span className="text-xs text-zinc-400">Sell at or above $</span>
            <Input value={sellTarget} onChange={(e) => setSellTarget(e.target.value)} className="pb-input" />
          </label>
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input type="checkbox" checked={autoTrade} onChange={(e) => setAutoTrade(e.target.checked)} />
            Auto trade at thresholds
          </label>
          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">Trade signal</p>
            <p className="mt-2 text-sm text-white">{signalSummary}</p>
            <p className="text-xs text-zinc-500">{signalActionDetail}</p>
            {engineSignal?.updatedAt && (
              <p className="text-[11px] mt-2 text-zinc-500">Updated {new Date(engineSignal.updatedAt).toLocaleTimeString()}</p>
            )}
            {engineSignal && engineSignal.minConfidenceRequired != null && (
              <p className="text-[11px] text-zinc-500">
                Min confidence required: {Math.round(engineSignal.minConfidenceRequired * 100)}%
              </p>
            )}
            <p className="text-xs text-zinc-500 mt-2">
              {autoTrade ? 'Auto mode enabled' : 'Use buttons to swap manually'}
            </p>
            {openSignal && (
              <>
                <p className="mt-2 text-xs text-zinc-400">
                  Open-source consensus: <span className="text-white">{openSignal.consensus.signal}</span> ({Math.round(openSignal.consensus.confidence * 100)}%)
                </p>
                <p className="text-[11px] text-zinc-500">
                  Providers — BUY: {openSignal.consensus.counts.buy} / SELL: {openSignal.consensus.counts.sell} / HOLD: {openSignal.consensus.counts.hold}
                </p>
              </>
            )}
            {openSignalError && (
              <p className="mt-2 text-xs text-amber-300">Open-source signals unavailable: {openSignalError}</p>
            )}
          </div>
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <p className="text-[11px] uppercase tracking-widest text-zinc-500">Signal sources</p>
          <p className="mt-2 text-sm text-white">
            {engineSignal
              ? 'Underlying signal source values from the AI engine.'
              : engineSignalError
              ? 'Unable to load engine sources.'
              : 'Loading signal sources...'}
          </p>
          {engineSignal?.features ? (
            <div className="mt-3 grid gap-2 text-[11px] text-zinc-400">
              {Object.entries(engineSignal.features).map(([key, value]) => (
                <div key={key} className="flex justify-between rounded-md bg-white/5 px-3 py-2">
                  <span className="font-medium uppercase tracking-wide">{key.replace(/([A-Z])/g, ' $1')}</span>
                  <span>{String(value)}</span>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-zinc-500 mt-2">No signal source details available yet.</p>
          )}
        </div>

        <div className="rounded-lg border border-white/10 bg-white/5 p-3">
          <p className="text-[11px] uppercase tracking-widest text-zinc-500">Open-source signal providers</p>
          {!openSignal && !openSignalError ? (
            <p className="mt-2 text-sm text-zinc-400">Loading provider signals...</p>
          ) : null}
          {openSignal?.providers?.length ? (
            <div className="mt-3 grid gap-2 text-[11px] text-zinc-300">
              {openSignal.providers.map((provider) => (
                <div key={provider.id} className="rounded-md bg-white/5 px-3 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-medium text-white">{provider.name}</span>
                    <span
                      className={
                        provider.signal === 'BUY'
                          ? 'text-emerald-400'
                          : provider.signal === 'SELL'
                            ? 'text-red-400'
                            : 'text-zinc-400'
                      }
                    >
                      {provider.signal} ({Math.round(provider.confidence * 100)}%)
                    </span>
                  </div>
                  {provider.note ? <p className="text-zinc-500 mt-1">{provider.note}</p> : null}
                  <a
                    href={provider.sourceUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-zinc-500 underline"
                  >
                    Source
                  </a>
                </div>
              ))}
            </div>
          ) : null}
        </div>

        {events.length ? (
          <div className="rounded-xl border border-white/10 bg-[#061014] p-4 text-sm text-zinc-300">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500 mb-2">DEX Trade History & P&L</p>
            <div className="space-y-2 max-h-48 overflow-y-auto">
              {events.slice(0, 8).map((event) => (
                <div key={event.id} className="flex flex-col gap-1 rounded-md bg-white/5 p-3">
                  <div className="flex items-center justify-between text-xs text-zinc-400">
                    <span className={`font-medium ${event.type === 'BUY' ? 'text-blue-400' : 'text-emerald-400'}`}>
                      {event.type}
                    </span>
                    <span>{new Date(event.happenedAt).toLocaleTimeString()}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <div className="text-sm text-white">
                      {event.mode === 'auto' ? 'Auto' : 'Manual'} · {event.amountUsdt.toFixed(2)} USDT
                    </div>
                    {event.profit !== undefined && (
                      <div className={`text-sm font-medium ${event.profit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                        {event.profit >= 0 ? '+' : ''}${event.profit.toFixed(2)}
                      </div>
                    )}
                  </div>
                  <div className="text-xs text-zinc-500">
                    Price: ${event.price?.toFixed(2) ?? '—'} · {event.quoteOut} WBNB
                  </div>
                </div>
              ))}
            </div>
            {totalSells > 0 && (
              <div className="mt-3 pt-3 border-t border-white/10">
                <div className="grid grid-cols-3 gap-4 text-center">
                  <div>
                    <p className="text-xs text-zinc-500">Total P&L</p>
                    <p className={`text-sm font-medium ${totalProfit >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                      {totalProfit >= 0 ? '+' : ''}${totalProfit.toFixed(2)}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Win Rate</p>
                    <p className="text-sm font-medium text-white">{winRate.toFixed(1)}%</p>
                  </div>
                  <div>
                    <p className="text-xs text-zinc-500">Trades</p>
                    <p className="text-sm font-medium text-white">{totalSells}</p>
                  </div>
                </div>
              </div>
            )}
          </div>
        ) : null}

        {error ? (
          <div className="rounded-lg border border-red-500/20 bg-red-950/30 px-3 py-2 text-sm text-red-300">
            {error}
          </div>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button
            type="button"
            disabled={!isConnected || wrongChain || writePending || amountInUsdt <= 0 || !Number.isFinite(amountInUsdt)}
            onClick={() => void executeBuy('manual')}
          >
            Buy now
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={!isConnected || wrongChain || writePending || !wbnbBal || wbnbBal === 0n}
            onClick={() => void executeSell()}
          >
            Sell now
          </Button>
          <Button type="button" variant="ghost" size="sm" onClick={() => {
            savePosition(false)
            setError(null)
            toast.success('Position reset.')} }
          >
            Reset state
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
