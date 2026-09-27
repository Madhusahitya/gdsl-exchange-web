'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import {
  useAccount,
  useBalance,
  useChainId,
  useConnect,
  useDisconnect,
  usePublicClient,
  useSwitchChain,
  useWriteContract,
} from 'wagmi'
import { bsc } from 'wagmi/chains'
import { formatEther, formatUnits, maxUint256, parseUnits } from 'viem'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { EnhancedSignalsPanel } from '@/components/signals/EnhancedSignalsPanel'
import { TradeAdvisor } from '@/components/signals/TradeAdvisor'
import type { TradeAdvisory } from '@/lib/api'
import {
  BSC_CHAIN_ID,
  PANCAKE_V2_ROUTER,
  erc20Abi,
  routerAbi,
} from '@/lib/dex/bsc'
import {
  BSC_TOKENS,
  BSC_TOKEN_BY_SYMBOL,
  BSC_USDT,
  DEFAULT_BSC_TOKEN,
  candidateSwapPaths,
  type BscToken,
} from '@/lib/dex/bscTokens'
import { CoinSelector, type CoinSelectorOption } from '@/components/market/CoinSelector'
import { LiveCandle } from '@/components/market/LiveCandle'
import { computeDexSignal, type DexStrategyMode } from '@/lib/dex/strategy'
import {
  estimatedSessionFlowUsdt,
  loadDexSession,
  resetDexSession,
  saveDexSession,
  type DexSessionStats,
} from '@/lib/dex/sessionStats'
import { dexBuyRealizedPnlUsd, dexSellRealizedPnlUsd } from '@/lib/dex/swapPnl'
import { allChecksPass, evaluateBuyPreTradeChecks } from '@/lib/dex/preTradeChecks'
import { fetchFearGreedIndex } from '@/lib/dex/fearGreed'
import { DexWalletPicker } from '@/components/web3/DexWalletPicker'
import { TradingViewEmbed } from '@/components/trading/TradingViewEmbed'
import {
  dex,
  engine,
  hotWallet,
  personalWallet,
  tokenTrading,
  trades,
  type DexAllocationSuggestionsResponse,
  type DexTelegramNotifyPayload,
  type PersonalWalletSummary,
} from '@/lib/api'
import { readConnectorChainId, waitForConnectorChain } from '@/lib/wagmi/connectorChain'

const PRICE_POLL_MS = 15_000
const PRICE_STALE_MS = 90_000
const DEFAULT_FG_MAX = 100
const DEFAULT_MAX_BUYS_DAY = 100
const ENFORCE_AUTOMATED_EXECUTION = true
// Minimum gap between auto-executor swap attempts. Prevents looping retries
// when the AI signal flickers (e.g. BUY → HOLD → BUY between price ticks)
// after a wallet rejection or on-chain revert.
const AUTO_EXEC_COOLDOWN_MS = 30_000
const OPEN_SIGNAL_POLL_MS = 30_000
/**
 * Minimum gap between signal-change toast / Telegram notifications.
 *
 * Signals can flip BUY ↔ HOLD ↔ SELL multiple times per minute on noisy
 * markets — without this cooldown the user gets a wall of popups (the
 * symptom investors reported). 60s is long enough to feel calm but short
 * enough that genuine trend changes still surface within ~1 cycle.
 */
const SIGNAL_TOAST_COOLDOWN_MS = 60_000
const SAFE_DEFAULT_USDT_PER_TRADE = '5'
const SAFE_DEFAULT_MAX_DAILY_LOSS_USDT = '20'
const SAFE_DEFAULT_MAX_USDT_PER_TRADE_CAP = '5'
/**
 * Signal threshold in %. With smaPeriod=8 and a 15s price poll, the strategy
 * effectively asks "is price ≥ N% above the last ~2 minutes' average?". The
 * old default of 0.20% was too strict for real crypto pairs — majors like
 * BTC and ETH only move 0.02–0.10% in a typical 2-minute window, so the
 * signal stayed at HOLD almost permanently (the symptom investors reported:
 * "every coin gives HOLD signals only").
 *
 * 0.08% is calibrated against real BSC-pair tick data — frequent enough to
 * surface actionable trend moves, strict enough to filter the sub-tick
 * noise that would otherwise spam BUY/SELL flips every minute. Users who
 * want more or fewer signals can still tune the input directly.
 */
const SAFE_DEFAULT_SIGNAL_THRESHOLD = '0.08'
const SAFE_DEFAULT_SLIPPAGE_PERCENT = '1.0'
const SAFE_DEFAULT_FEAR_GREED_MAX = '75'
const SAFE_DEFAULT_MAX_BUYS_DAY = '6'
/** Extra auto BUYs while signal stays BUY and you remain in position (DCA). */
const SAFE_DEFAULT_SCALE_IN_INTERVAL_MIN = '5'
const SAFE_DEFAULT_SCALE_IN_MAX_ADDS = '3'
const SCALE_IN_POLL_MS = 10_000
/**
 * Take-profit / stop-loss defaults. These are **percentages off the entry
 * fill price**, not absolute dollar moves. TP must clear ~2× gas to make a
 * round-trip net-positive on $50+ trade sizes; SL is a defensive cap so a
 * single bad entry never bleeds more than a known amount.
 */
const SAFE_DEFAULT_TAKE_PROFIT_PCT = '1.5'
const SAFE_DEFAULT_STOP_LOSS_PCT = '1.0'
/** ON by default — without TP/SL the bot only exits on a SELL signal edge, which can take hours. */
const SAFE_DEFAULT_TP_SL_ENABLED = true
/**
 * Trailing stop-loss is OFF by default so the bot's behaviour stays
 * unchanged for users who don't opt in. When ON, the existing `stopLossPct`
 * is reinterpreted as the distance **below the running peak** (highest
 * price observed since entry), so winning trades that retrace lock in
 * profit instead of having to fall all the way back to entry − SL%.
 *
 * Strictly tighter than fixed SL when price moves up; identical to fixed
 * SL when price never goes above entry. There is no scenario where
 * enabling trailing makes the stop wider — so v1 doesn't expose a
 * separate trailing-distance field; users tune one number (`stopLossPct`)
 * and pick fixed vs trailing semantics via the checkbox.
 */
const SAFE_DEFAULT_TRAILING_STOP_ENABLED = false
const SAFE_PROFILE_VERSION = '2026-04-safe-v1'

/** Telegram copy for viem/wallet “wrong chain” errors so users know to pick BSC in MetaMask. */
function augmentDexSwapFailureDetail(message: string): string {
  const lower = message.toLowerCase()
  if (lower.includes('does not match') && lower.includes('chain')) {
    return `${message.trim()}\n\nTip: MetaMask must be on BNB Smart Chain (chain id 56). Ethereum mainnet (id 1) cannot sign PancakeSwap BSC swaps — switch networks and retry.`
  }
  return message
}
type DexScoutChain = 'bsc' | 'base' | 'arbitrum' | 'polygon'
type DexScoutVenue = 'pancakeswap' | 'uniswap' | 'auto'

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

type DelegateStatus = {
  enabled: boolean
  hotWalletConfigured: boolean
  remainingBuyUsdt?: number
}

async function fetchBinancePrice(binanceSymbol: string): Promise<number | null> {
  try {
    const res = await fetch(`https://api.binance.com/api/v3/ticker/price?symbol=${binanceSymbol}`)
    const data = (await res.json()) as { price?: string }
    if (!data.price) return null
    return parseFloat(data.price)
  } catch {
    return null
  }
}

/**
 * Pre-seeds the rolling price buffer so the strategy warmup (16 samples) is
 * satisfied the moment the page mounts — instead of waiting ~4 minutes for
 * fresh poll ticks to accumulate. Pulls the last `limit` 1-minute closes from
 * Binance's public klines endpoint. Returns an empty array if the request
 * fails (the live poller still works, just with a slower warmup).
 */
async function fetchBinanceKlineCloses(
  binanceSymbol: string,
  limit = 30,
  interval: '1m' | '5m' = '1m',
): Promise<number[]> {
  try {
    const res = await fetch(
      `https://api.binance.com/api/v3/klines?symbol=${binanceSymbol}&interval=${interval}&limit=${limit}`,
    )
    if (!res.ok) return []
    const rows = (await res.json()) as unknown[]
    if (!Array.isArray(rows)) return []
    const closes: number[] = []
    for (const row of rows) {
      if (!Array.isArray(row) || row.length < 5) continue
      const close = typeof row[4] === 'string' ? parseFloat(row[4]) : NaN
      if (Number.isFinite(close) && close > 0) closes.push(close)
    }
    return closes
  } catch {
    return []
  }
}

function parseBps(slippagePercent: string): bigint {
  const n = parseFloat(slippagePercent)
  if (!Number.isFinite(n) || n <= 0 || n > 50) return 100n
  return BigInt(Math.round(n * 100))
}

function symbolForPersonalWallet(selectedSymbol: string): string {
  // UI symbol "BTC" is represented as BTCB in the personal-wallet backend.
  if (selectedSymbol === 'BTC') return 'BTCB'
  return selectedSymbol
}

function toRawUnits(amount: number, decimals: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) return 0n
  const safeDecimals = Math.max(0, Math.min(decimals, 18))
  return parseUnits(amount.toFixed(safeDecimals), safeDecimals)
}

function formatCountdown(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds))
  const mm = Math.floor(s / 60)
  const ss = s % 60
  return `${mm}:${String(ss).padStart(2, '0')}`
}

export default function DexBotPage() {
  const searchParams = useSearchParams()
  const { address, isConnected, connector } = useAccount()
  const chainId = useChainId()
  const { connectors, connect, isPending: connectPending } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChain, switchChainAsync, isPending: switchPending } = useSwitchChain()
  const publicClient = usePublicClient()
  const bscPublicClient = usePublicClient({ chainId: bsc.id })
  const { writeContractAsync, isPending: writePending } = useWriteContract()
  const { data: bnbNative } = useBalance({
    address,
    chainId: bsc.id,
    query: { enabled: Boolean(address && chainId === bsc.id) },
  })

  // SSR-safe defaults — `localStorage` is hydrated in the effect below to
  // avoid server↔client hydration mismatches. Reading `localStorage` inside a
  // `useState` initializer would diverge between SSR (no window) and the
  // client's first render (window present), causing React to throw
  // "Hydration failed because the initial UI does not match what was rendered
  // on the server".
  const [selectedToken, setSelectedToken] = useState<BscToken>(DEFAULT_BSC_TOKEN)
  const tokenAddress = selectedToken.address
  const tokenDecimals = selectedToken.decimals
  const tokenSymbol = selectedToken.symbol
  // Swap quotes now go through `candidateSwapPaths` → `quoteBestPancakePath`
  // (see `executeBuy` / `executeSell`), which evaluates every candidate
  // route at execution time and picks the cheapest available one. This
  // replaces the previous hard-coded 2-hop USDT↔WBNB↔TOKEN path that
  // burned an extra 0.25% LP fee on every blue-chip swap.
  const candidateBuyPaths = useMemo(() => candidateSwapPaths(selectedToken, 'BUY'), [selectedToken])
  const candidateSellPaths = useMemo(() => candidateSwapPaths(selectedToken, 'SELL'), [selectedToken])
  const [tradeAdvisory, setTradeAdvisory] = useState<TradeAdvisory | null>(null)
  const [usdtPerTrade, setUsdtPerTrade] = useState(SAFE_DEFAULT_USDT_PER_TRADE)
  const [slippagePercent, setSlippagePercent] = useState(SAFE_DEFAULT_SLIPPAGE_PERCENT)
  const [smaPeriod, setSmaPeriod] = useState(8)
  const [dexStrategyMode, setDexStrategyMode] = useState<DexStrategyMode>('trend_rsi')
  const [fastSmaPeriod, setFastSmaPeriod] = useState(5)
  const [slowSmaPeriod, setSlowSmaPeriod] = useState(21)
  const [signalThreshold, setSignalThreshold] = useState(SAFE_DEFAULT_SIGNAL_THRESHOLD)
  const [useRsiFilter, setUseRsiFilter] = useState(false)
  const [maxDailyLossUsdt, setMaxDailyLossUsdt] = useState(SAFE_DEFAULT_MAX_DAILY_LOSS_USDT)
  const [maxUsdtPerTradeCap, setMaxUsdtPerTradeCap] = useState(SAFE_DEFAULT_MAX_USDT_PER_TRADE_CAP)
  const [fearGreedBuyMax, setFearGreedBuyMax] = useState(SAFE_DEFAULT_FEAR_GREED_MAX)
  const [maxBuysPerDay, setMaxBuysPerDay] = useState(SAFE_DEFAULT_MAX_BUYS_DAY)
  const [scaleInWhileBuyEnabled, setScaleInWhileBuyEnabled] = useState(false)
  const [scaleInIntervalMinutes, setScaleInIntervalMinutes] = useState(SAFE_DEFAULT_SCALE_IN_INTERVAL_MIN)
  const [scaleInMaxAdds, setScaleInMaxAdds] = useState(SAFE_DEFAULT_SCALE_IN_MAX_ADDS)
  const [nextScaleInEtaSec, setNextScaleInEtaSec] = useState<number | null>(null)
  /**
   * Take-profit / stop-loss auto-exit. When enabled, every price tick after
   * a BUY fill checks the move from `dexEntryPrice`; once it crosses TP or
   * -SL we fire `executeSell('auto')` and record the trigger reason for
   * Telegram + UI. Disabled by default so the bot's behaviour does not
   * change for existing users who have not opted in.
   */
  const [tpSlEnabled, setTpSlEnabled] = useState(SAFE_DEFAULT_TP_SL_ENABLED)
  const [takeProfitPct, setTakeProfitPct] = useState(SAFE_DEFAULT_TAKE_PROFIT_PCT)
  const [stopLossPct, setStopLossPct] = useState(SAFE_DEFAULT_STOP_LOSS_PCT)
  /**
   * When true the stop level trails the running peak instead of the fixed
   * entry price. Persisted to localStorage so power users keep their
   * preference across reloads. See `SAFE_DEFAULT_TRAILING_STOP_ENABLED`.
   */
  const [trailingStopEnabled, setTrailingStopEnabled] = useState(SAFE_DEFAULT_TRAILING_STOP_ENABLED)
  /** Entry mark price captured on a successful BUY (null when flat). */
  const [dexEntryPrice, setDexEntryPrice] = useState<number | null>(null)
  /**
   * Highest price observed since entry. Initialised to the fill price on
   * BUY, ratcheted upward by the TP/SL watcher on every tick, and cleared
   * to null on SELL. Persisted alongside `dexEntryPrice` so a page reload
   * mid-position doesn't reset the trailing floor to entry and give back
   * locked-in gains.
   */
  const [dexTrailingPeak, setDexTrailingPeak] = useState<number | null>(null)
  /** Live unrealized P/L percent vs entry — drives the dashboard badge. */
  const [dexUnrealizedPct, setDexUnrealizedPct] = useState<number | null>(null)
  /** Mirrors scaleInAddsUsedRef for UI (refs don’t re-render). */
  const [scaleInAddsUsedDisplay, setScaleInAddsUsedDisplay] = useState(0)
  const [tradingHalted, setTradingHalted] = useState(false)
  const [telegramEnabled, setTelegramEnabled] = useState(false)
  /** Pauses signal-driven auto BUY/SELL only; manual buttons and kill switch stay independent. */
  const [dexAutomationPaused, setDexAutomationPaused] = useState(false)
  // Hydrated from `localStorage` post-mount to avoid SSR mismatch (text differs).
  const [usePersonalWallet, setUsePersonalWallet] = useState(false)
  const [personalWalletAddress, setPersonalWalletAddress] = useState<string | null>(null)
  const [personalWalletReady, setPersonalWalletReady] = useState(false)
  const [personalWalletSummary, setPersonalWalletSummary] = useState<PersonalWalletSummary | null>(null)
  const [dexSuggestions, setDexSuggestions] = useState<DexAllocationSuggestionsResponse | null>(null)
  const [scoutChain, setScoutChain] = useState<DexScoutChain>('bsc')
  const [scoutVenue, setScoutVenue] = useState<DexScoutVenue>('auto')
  const [focusHint, setFocusHint] = useState<{
    signal: 'BUY' | 'SELL' | 'HOLD'
    refPrice: number
    buyRef: number
    sellRef: number
    text: string
  } | null>(null)
  const [focusHintBusy, setFocusHintBusy] = useState(false)
  const [lastPriceAt, setLastPriceAt] = useState<number | null>(null)
  const [fearGreed, setFearGreed] = useState<number | null>(null)
  const [openSignal, setOpenSignal] = useState<OpenSourceSignalResponse | null>(null)
  const [openSignalError, setOpenSignalError] = useState<string | null>(null)
  const [delegateStatus, setDelegateStatus] = useState<DelegateStatus | null>(null)

  const [botRunning, setBotRunning] = useState(true)
  /** When on, submits BUY/SELL txs when the strategy crosses into those signals (wallet prompts each time). */
  const [autoExecuteSwaps, setAutoExecuteSwaps] = useState(ENFORCE_AUTOMATED_EXECUTION)
  const [forcedFirstTrade, setForcedFirstTrade] = useState(false)
  const [prices, setPrices] = useState<number[]>([])
  const [lastPrice, setLastPrice] = useState<number | null>(null)
  const lastPriceRef = useRef<number | null>(null)
  lastPriceRef.current = lastPrice
  const [signal, setSignal] = useState<'BUY' | 'SELL' | 'HOLD'>('HOLD')
  const [smaDisplay, setSmaDisplay] = useState<number | null>(null)
  const [rsiDisplay, setRsiDisplay] = useState<number | null>(null)
  const [inPosition, setInPosition] = useState(false)
  /** Blocks prefs persistence until localStorage-backed UI state has hydrated (prevents SSR flash & wiping LS). */
  const [dexClientPrefsHydrated, setDexClientPrefsHydrated] = useState(false)
  const wrongChain = isConnected && chainId !== BSC_CHAIN_ID

  /** Wagmi `isConnected` is false on the server but may be true on first client paint — avoid branching UI before mount (DexWalletPicker vs address span). */
  const [clientMounted, setClientMounted] = useState(false)
  useEffect(() => {
    setClientMounted(true)
  }, [])

  const [usdtBal, setUsdtBal] = useState<bigint | null>(null)
  const [wbnbBal, setWbnbBal] = useState<bigint | null>(null)
  // SSR-safe: hydrate from localStorage in an effect to avoid server/client HTML mismatch.
  const [sessionStats, setSessionStats] = useState<DexSessionStats>({
    buysUsdtTotal: 0,
    sellsUsdtTotal: 0,
    buyCount: 0,
    sellCount: 0,
    dayKey: '',
  })

  const slippageBps = parseBps(slippagePercent)
  const usePersonalExecution = usePersonalWallet && personalWalletReady
  const effectiveConnected = usePersonalExecution ? true : isConnected
  const effectiveWrongChain = usePersonalExecution ? false : wrongChain
  const effectiveAddress = usePersonalExecution ? (personalWalletAddress as `0x${string}` | null) : (address as `0x${string}` | undefined)

  const personalUsdtBalance = useMemo(() => {
    const amount = personalWalletSummary?.balances.find((b) => b.asset === 'USDT')?.amount ?? 0
    return toRawUnits(amount, 18)
  }, [personalWalletSummary])
  const personalTokenBalance = useMemo(() => {
    const asset = symbolForPersonalWallet(tokenSymbol)
    const amount = personalWalletSummary?.balances.find((b) => b.asset === asset)?.amount ?? 0
    return toRawUnits(amount, tokenDecimals)
  }, [personalWalletSummary, tokenSymbol, tokenDecimals])
  const personalBnbGasBalance = useMemo(() => {
    const amount = personalWalletSummary?.balances.find((b) => b.asset === 'BNB')?.amount ?? 0
    return toRawUnits(amount, 18)
  }, [personalWalletSummary])
  const effectiveUsdtBal = usePersonalExecution ? personalUsdtBalance : usdtBal
  const effectiveTokenBal = usePersonalExecution ? personalTokenBalance : wbnbBal

  const refreshBalances = useCallback(async () => {
    if (!publicClient || !address || chainId !== BSC_CHAIN_ID) {
      setUsdtBal(null)
      setWbnbBal(null)
      return
    }
    try {
      const [u, w] = await Promise.all([
        publicClient.readContract({
          address: BSC_USDT,
          abi: erc20Abi,
          functionName: 'balanceOf',
          args: [address],
        }),
        publicClient.readContract({
          address: tokenAddress,
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
  }, [publicClient, address, chainId, tokenAddress])

  const refreshPersonalWalletStatus = useCallback(async () => {
    try {
      const result = await personalWallet.status()
      if (result.configured && result.wallet) {
        setPersonalWalletAddress(result.wallet.address)
        setPersonalWalletReady(true)
        setPersonalWalletSummary(result.wallet)
      } else {
        setPersonalWalletReady(false)
        setPersonalWalletAddress(null)
        setPersonalWalletSummary(null)
      }
    } catch {
      setPersonalWalletReady(false)
      setPersonalWalletSummary(null)
    }
  }, [])

  useEffect(() => {
    setSessionStats(loadDexSession())
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const profileKey = 'dex_safe_profile_version'
    const applied = localStorage.getItem(profileKey)
    if (applied === SAFE_PROFILE_VERSION) return

    setUsdtPerTrade(SAFE_DEFAULT_USDT_PER_TRADE)
    setSlippagePercent(SAFE_DEFAULT_SLIPPAGE_PERCENT)
    setSignalThreshold(SAFE_DEFAULT_SIGNAL_THRESHOLD)
    setMaxDailyLossUsdt(SAFE_DEFAULT_MAX_DAILY_LOSS_USDT)
    setMaxUsdtPerTradeCap(SAFE_DEFAULT_MAX_USDT_PER_TRADE_CAP)
    setFearGreedBuyMax(SAFE_DEFAULT_FEAR_GREED_MAX)
    setMaxBuysPerDay(SAFE_DEFAULT_MAX_BUYS_DAY)
    localStorage.setItem(profileKey, SAFE_PROFILE_VERSION)
  }, [])

  useEffect(() => {
    if (!dexClientPrefsHydrated) return
    localStorage.setItem('dex_in_position', inPosition ? '1' : '0')
  }, [inPosition, dexClientPrefsHydrated])

  useEffect(() => {
    if (!dexClientPrefsHydrated) return
    localStorage.setItem('dex_usdtPerTrade', usdtPerTrade)
    localStorage.setItem('dex_slippage', slippagePercent)
    localStorage.setItem('dex_sma', String(smaPeriod))
    localStorage.setItem('dex_strategyMode', dexStrategyMode)
    localStorage.setItem('dex_fastSma', String(fastSmaPeriod))
    localStorage.setItem('dex_slowSma', String(slowSmaPeriod))
    localStorage.setItem('dex_threshold', signalThreshold)
    localStorage.setItem('dex_rsi', useRsiFilter ? '1' : '0')
    localStorage.setItem('dex_maxLoss', maxDailyLossUsdt)
    localStorage.setItem('dex_maxCap', maxUsdtPerTradeCap)
    localStorage.setItem('dex_fgMax', fearGreedBuyMax)
    localStorage.setItem('dex_maxBuys', maxBuysPerDay)
    localStorage.setItem('dex_halted', tradingHalted ? '1' : '0')
    localStorage.setItem('dex_telegramAlerts', telegramEnabled ? '1' : '0')
    localStorage.setItem('dex_autoPaused', dexAutomationPaused ? '1' : '0')
    localStorage.setItem('dex_scaleIn', scaleInWhileBuyEnabled ? '1' : '0')
    localStorage.setItem('dex_scaleInMins', scaleInIntervalMinutes)
    localStorage.setItem('dex_scaleInMax', scaleInMaxAdds)
    localStorage.setItem('dex_tpSl', tpSlEnabled ? '1' : '0')
    localStorage.setItem('dex_tpPct', takeProfitPct)
    localStorage.setItem('dex_slPct', stopLossPct)
    localStorage.setItem('dex_trailingStop', trailingStopEnabled ? '1' : '0')
    localStorage.setItem('dex_scoutChain', scoutChain)
    localStorage.setItem('dex_scoutVenue', scoutVenue)
  }, [
    usdtPerTrade,
    slippagePercent,
    smaPeriod,
    dexStrategyMode,
    fastSmaPeriod,
    slowSmaPeriod,
    signalThreshold,
    useRsiFilter,
    maxDailyLossUsdt,
    maxUsdtPerTradeCap,
    fearGreedBuyMax,
    maxBuysPerDay,
    tradingHalted,
    telegramEnabled,
    dexAutomationPaused,
    scaleInWhileBuyEnabled,
    scaleInIntervalMinutes,
    scaleInMaxAdds,
    tpSlEnabled,
    takeProfitPct,
    stopLossPct,
    trailingStopEnabled,
    scoutChain,
    scoutVenue,
    dexClientPrefsHydrated,
  ])

  /**
   * Persist `dexEntryPrice` separately — it changes on BUY/SELL events, not
   * with the rest of the prefs, so it doesn't belong in the bulk save effect.
   * Cleared on SELL (null) to free localStorage and avoid stale TP/SL after
   * a manual exit.
   */
  useEffect(() => {
    if (!dexClientPrefsHydrated) return
    if (
      dexEntryPrice === null ||
      !Number.isFinite(dexEntryPrice) ||
      dexEntryPrice <= 0
    ) {
      localStorage.removeItem('dex_entryPrice')
    } else {
      localStorage.setItem('dex_entryPrice', String(dexEntryPrice))
    }
  }, [dexEntryPrice, dexClientPrefsHydrated])

  /**
   * Persist `dexTrailingPeak`. Same lifecycle as `dexEntryPrice` (changes
   * on every tick that beats the prior peak), so kept in its own effect to
   * isolate the dependency and avoid touching localStorage on unrelated
   * pref changes. Without this persistence a page reload would reset the
   * trailing floor to entry and quietly give back any locked-in profit
   * from a previous tab session.
   */
  useEffect(() => {
    if (!dexClientPrefsHydrated) return
    if (
      dexTrailingPeak === null ||
      !Number.isFinite(dexTrailingPeak) ||
      dexTrailingPeak <= 0
    ) {
      localStorage.removeItem('dex_trailingPeak')
    } else {
      localStorage.setItem('dex_trailingPeak', String(dexTrailingPeak))
    }
  }, [dexTrailingPeak, dexClientPrefsHydrated])

  useEffect(() => {
    if (ENFORCE_AUTOMATED_EXECUTION && !autoExecuteSwaps) {
      setAutoExecuteSwaps(true)
    }
  }, [autoExecuteSwaps])

  useEffect(() => {
    const load = async () => {
      const v = await fetchFearGreedIndex()
      setFearGreed(v)
    }
    void load()
  }, [])

  const refreshOpenSignals = useCallback(async () => {
    try {
      const payload = await engine.openSourceSignal()
      setOpenSignal(payload)
      setOpenSignalError(null)
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Failed to load open-source provider signals'
      setOpenSignalError(msg)
      setOpenSignal(null)
    }
  }, [])

  useEffect(() => {
    void refreshOpenSignals()
    const onRefresh = () => {
      void refreshOpenSignals()
    }
    window.addEventListener('dashboard:refresh', onRefresh)
    return () => {
      window.removeEventListener('dashboard:refresh', onRefresh)
    }
  }, [refreshOpenSignals])

  const refreshDelegateStatus = useCallback(async () => {
    try {
      const s = (await hotWallet.delegateStatus()) as DelegateStatus
      setDelegateStatus(s)
    } catch {
      setDelegateStatus(null)
    }
  }, [])

  useEffect(() => {
    void refreshDelegateStatus()
    const onRefresh = () => {
      void refreshDelegateStatus()
    }
    window.addEventListener('dashboard:refresh', onRefresh)
    window.addEventListener('trade:executed', onRefresh)
    return () => {
      window.removeEventListener('dashboard:refresh', onRefresh)
      window.removeEventListener('trade:executed', onRefresh)
    }
  }, [refreshDelegateStatus])

  /** Linked Telegram (Settings → Telegram) + opted in via checkbox below. */
  const pushDexTelegram = useCallback(async (payload: DexTelegramNotifyPayload) => {
    if (!telegramEnabled) return
    try {
      await dex.notify(payload)
    } catch {
      // User may be logged out; swap toasts still provide local feedback.
    }
  }, [telegramEnabled])

  useEffect(() => {
    refreshBalances()
  }, [refreshBalances])

  useEffect(() => {
    if (wbnbBal === null) return
    const hasWbnb = wbnbBal > 0n
    setInPosition((prev) => {
      if (prev === hasWbnb) return prev
      if (typeof window !== 'undefined') {
        localStorage.setItem('dex_in_position', hasWbnb ? '1' : '0')
      }
      return hasWbnb
    })
  }, [wbnbBal])

  /**
   * When the user holds tokens but landed on Dashboard (not DEX), the OPEN
   * trade row in the DB still has the entry fill. Hydrate `dexEntryPrice` so
   * TP/SL and the unrealized % badge work without a manual re-entry.
   */
  useEffect(() => {
    if (!usePersonalWallet || !personalWalletReady) return
    const pair = `${tokenSymbol}/USDT`
    void (async () => {
      try {
        const res = (await trades.list({ status: 'OPEN', page: 1, limit: 10 })) as {
          trades?: Array<{ pair: string; entryPrice: number; side?: string }>
        }
        const row = res.trades?.find((t) => t.pair === pair && (t.side === 'BUY' || !t.side))
        if (row && Number.isFinite(row.entryPrice) && row.entryPrice > 0) {
          setDexEntryPrice(row.entryPrice)
        }
      } catch {
        /* non-fatal */
      }
    })()
  }, [usePersonalWallet, personalWalletReady, tokenSymbol])

  useEffect(() => {
    let cancelled = false
    setPrices([])
    setLastPrice(null)
    setLastPriceAt(null)

    // 1) Seed the rolling buffer with the last ~30 1-minute closes so the
    //    strategy warmup gate (default 16 samples) is satisfied the moment
    //    the page mounts.
    void (async () => {
      const closes = await fetchBinanceKlineCloses(selectedToken.binanceSymbol, 30, '1m')
      if (cancelled || closes.length === 0) return
      setPrices((prev) => {
        const merged = [...closes, ...prev]
        return merged.length > 120 ? merged.slice(-120) : merged
      })
      const last = closes[closes.length - 1]
      if (typeof last === 'number') {
        setLastPrice(last)
        setLastPriceAt(Date.now())
      }
    })()

    // 2) Real-time WebSocket connection to Binance for continuous live price ticks
    let ws: WebSocket | null = null
    let reconnectTimer: ReturnType<typeof setTimeout> | null = null
    let lastTickTime = 0
    const streamSymbol = selectedToken.binanceSymbol.toLowerCase().replace('/', '')
    const url = `wss://stream.binance.com:9443/ws/${streamSymbol}@trade`

    const connect = () => {
      if (cancelled) return
      try {
        ws = new WebSocket(url)

        ws.onmessage = (event) => {
          if (cancelled) return
          try {
            const data = JSON.parse(event.data) as { p?: string; T?: number }
            if (!data?.p) return
            const p = parseFloat(data.p)
            if (!Number.isFinite(p) || p <= 0) return

            const now = data.T ?? Date.now()
            setLastPrice(p)
            setLastPriceAt(now)

            // Throttle rolling buffer updates to at most once every 500ms to avoid excessive recalculations
            if (now - lastTickTime >= 500) {
              lastTickTime = now
              setPrices((prev) => {
                const next = [...prev, p]
                if (next.length > 120) next.shift()
                return next
              })
            }
          } catch {
            /* ignore frame */
          }
        }

        ws.onclose = () => {
          ws = null
          if (!cancelled) {
            reconnectTimer = setTimeout(connect, 3_000)
          }
        }

        ws.onerror = () => {
          ws?.close()
        }
      } catch {
        if (!cancelled) {
          reconnectTimer = setTimeout(connect, 5_000)
        }
      }
    }

    connect()

    return () => {
      cancelled = true
      if (reconnectTimer) clearTimeout(reconnectTimer)
      if (ws) {
        ws.close()
        ws = null
      }
    }
  }, [selectedToken])

  // One-shot hydration of `localStorage`-backed UI preferences. Done in an
  // effect (post-mount) so the SSR HTML matches the first client render.
  // Every persisted DEX setting flows through this single block so that no
  // `useState` initializer ever touches `window`/`localStorage` directly.
  useEffect(() => {
    if (typeof window === 'undefined') return
    const get = (k: string) => localStorage.getItem(`dex_${k}`)
    const savedSymbol = localStorage.getItem('dex_selected_token')
    const savedToken = savedSymbol ? BSC_TOKEN_BY_SYMBOL[savedSymbol] : null
    if (savedToken && savedToken.symbol !== selectedToken.symbol) {
      setSelectedToken(savedToken)
    }
    if (localStorage.getItem('dex_usePersonalWallet') === '1') {
      setUsePersonalWallet(true)
    }
    const v1 = get('usdtPerTrade'); if (v1 !== null) setUsdtPerTrade(v1)
    const v2 = get('slippage'); if (v2 !== null) setSlippagePercent(v2)
    const v3 = get('sma'); if (v3 !== null) {
      const n = parseInt(v3, 10)
      if (Number.isFinite(n) && n > 0) setSmaPeriod(n)
    }
    const v4 = get('threshold'); if (v4 !== null) setSignalThreshold(v4)
    const v5 = get('rsi'); if (v5 !== null) setUseRsiFilter(v5 === '1')
    const v6 = get('maxLoss'); if (v6 !== null) setMaxDailyLossUsdt(v6)
    const v7 = get('maxCap'); if (v7 !== null) setMaxUsdtPerTradeCap(v7)
    const v8 = get('fgMax'); if (v8 !== null) setFearGreedBuyMax(v8)
    const v9 = get('maxBuys'); if (v9 !== null) setMaxBuysPerDay(v9)
    const v10 = get('halted'); if (v10 !== null) setTradingHalted(v10 === '1')
    const v11 = get('telegramAlerts'); if (v11 !== null) setTelegramEnabled(v11 === '1')
    const v12 = get('autoPaused'); if (v12 !== null) setDexAutomationPaused(v12 === '1')
    const v13 = get('scaleIn'); if (v13 !== null) setScaleInWhileBuyEnabled(v13 === '1')
    const v14 = get('scaleInMins'); if (v14 !== null) setScaleInIntervalMinutes(v14)
    const v15 = get('scaleInMax'); if (v15 !== null) setScaleInMaxAdds(v15)
    const tps = get('tpSl'); if (tps !== null) setTpSlEnabled(tps === '1')
    const tpp = get('tpPct'); if (tpp !== null) setTakeProfitPct(tpp)
    const slp = get('slPct'); if (slp !== null) setStopLossPct(slp)
    const trail = get('trailingStop'); if (trail !== null) setTrailingStopEnabled(trail === '1')
    const entryRaw = get('entryPrice')
    if (entryRaw !== null) {
      const n = parseFloat(entryRaw)
      if (Number.isFinite(n) && n > 0) setDexEntryPrice(n)
    }
    const peakRaw = get('trailingPeak')
    if (peakRaw !== null) {
      const n = parseFloat(peakRaw)
      if (Number.isFinite(n) && n > 0) setDexTrailingPeak(n)
    }
    const v16 = get('scoutChain')
    if (v16 === 'bsc' || v16 === 'base' || v16 === 'arbitrum' || v16 === 'polygon') setScoutChain(v16)
    const v17 = get('scoutVenue')
    if (v17 === 'auto' || v17 === 'pancakeswap' || v17 === 'uniswap') setScoutVenue(v17)
    const sm = get('strategyMode')
    if (sm === 'trend_rsi' || sm === 'ma_cross' || sm === 'scalping') setDexStrategyMode(sm)
    const fs = get('fastSma')
    if (fs !== null) {
      const n = parseInt(fs, 10)
      if (Number.isFinite(n) && n >= 2 && n < 60) setFastSmaPeriod(n)
    }
    const ss = get('slowSma')
    if (ss !== null) {
      const n = parseInt(ss, 10)
      if (Number.isFinite(n) && n >= 3 && n < 120) setSlowSmaPeriod(n)
    }
    setInPosition(localStorage.getItem('dex_in_position') === '1')
    setDexClientPrefsHydrated(true)
    // Run-once intentionally — subsequent updates flow through state setters.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    const q = (searchParams.get('symbol') || searchParams.get('token') || '').trim().toUpperCase()
    if (!q) return
    const fromQuery = BSC_TOKEN_BY_SYMBOL[q]
    if (!fromQuery) return
    setSelectedToken(fromQuery)
    if (typeof window !== 'undefined') {
      localStorage.setItem('dex_selected_token', fromQuery.symbol)
    }
  }, [searchParams])

  useEffect(() => {
    let cancelled = false
    setFocusHintBusy(true)
    const id = window.setTimeout(() => {
      void (async () => {
        try {
          let walletPayload:
            | { mode: 'personal' }
            | {
                mode: 'external'
                label?: string
                addressTail?: string
                usdtBalance: number
                baseUsdApprox: number
              }

          if (usePersonalExecution) {
            walletPayload = { mode: 'personal' }
          } else {
            let usdtN = 0
            let baseUsd = 0
            try {
              const client = bscPublicClient ?? publicClient
              if (client && address && isConnected) {
                const [usdtRaw, tokRaw] = await Promise.all([
                  client.readContract({
                    address: BSC_USDT,
                    abi: erc20Abi,
                    functionName: 'balanceOf',
                    args: [address],
                  }),
                  client.readContract({
                    address: tokenAddress,
                    abi: erc20Abi,
                    functionName: 'balanceOf',
                    args: [address],
                  }),
                ])
                usdtN = Number(formatUnits(usdtRaw as bigint, 18))
                const tokN = Number(formatUnits(tokRaw as bigint, tokenDecimals))
                const lp = lastPriceRef.current
                const refPx = lp != null && Number.isFinite(lp) && lp > 0 ? lp : 0
                baseUsd = refPx > 0 ? tokN * refPx : 0
              }
            } catch {
              /* ignore */
            }
            walletPayload = {
              mode: 'external',
              label: connector?.name ?? 'Browser wallet',
              addressTail: address ? address.slice(-4) : undefined,
              usdtBalance: usdtN,
              baseUsdApprox: baseUsd,
            }
          }

          const r = await tokenTrading.focusToken(selectedToken.binanceSymbol, {
            chain: scoutChain,
            venue: scoutVenue,
            wallet: walletPayload,
          })
          if (cancelled) return
          const plainHint =
            typeof r.popupBody === 'string' && r.popupBody.includes('\n---\n')
              ? (r.popupBody.split('\n---\n')[0]?.trim() ?? r.popupBody)
              : r.popupBody
          setFocusHint({
            signal: r.signal,
            refPrice: r.refPrice,
            buyRef: r.buyRef,
            sellRef: r.sellRef,
            text: plainHint,
          })
          toast.info(r.popupTitle, { description: plainHint, duration: 12_000 })
          if (r.inboxInserted) window.dispatchEvent(new CustomEvent('cf:inbox-updated'))
        } catch {
          if (!cancelled) setFocusHint(null)
        } finally {
          if (!cancelled) setFocusHintBusy(false)
        }
      })()
    }, 450)
    return () => {
      cancelled = true
      window.clearTimeout(id)
    }
  }, [
    selectedToken.binanceSymbol,
    scoutChain,
    scoutVenue,
    usePersonalExecution,
    connector,
    address,
    isConnected,
    publicClient,
    bscPublicClient,
    tokenAddress,
    tokenDecimals,
  ])

  useEffect(() => {
    void refreshPersonalWalletStatus()
    const onRefresh = () => {
      void refreshPersonalWalletStatus()
    }
    window.addEventListener('dashboard:refresh', onRefresh)
    window.addEventListener('trade:executed', onRefresh)
    window.addEventListener('portfolio:update', onRefresh)
    return () => {
      window.removeEventListener('dashboard:refresh', onRefresh)
      window.removeEventListener('trade:executed', onRefresh)
      window.removeEventListener('portfolio:update', onRefresh)
    }
  }, [refreshPersonalWalletStatus])

  useEffect(() => {
    if (typeof window === 'undefined' || !dexClientPrefsHydrated) return
    localStorage.setItem('dex_usePersonalWallet', usePersonalWallet ? '1' : '0')
  }, [usePersonalWallet, dexClientPrefsHydrated])

  useEffect(() => {
    if (!usePersonalWallet || !personalWalletReady) {
      setDexSuggestions(null)
      return
    }
    let cancelled = false
    const load = async () => {
      try {
        const d = await personalWallet.dexSuggestions()
        if (!cancelled) setDexSuggestions(d)
      } catch {
        if (!cancelled) setDexSuggestions(null)
      }
    }
    void load()
    const onRefresh = () => {
      void load()
    }
    window.addEventListener('dashboard:refresh', onRefresh)
    window.addEventListener('trade:executed', onRefresh)
    return () => {
      cancelled = true
      window.removeEventListener('dashboard:refresh', onRefresh)
      window.removeEventListener('trade:executed', onRefresh)
    }
  }, [usePersonalWallet, personalWalletReady])

  const handleSelectToken = useCallback((symbol: string) => {
    const next = BSC_TOKEN_BY_SYMBOL[symbol]
    if (!next) return
    setSelectedToken(next)
    if (typeof window !== 'undefined') {
      localStorage.setItem('dex_selected_token', next.symbol)
    }
    // Removed the noisy "Switched to X · path now ..." toast that fired
    // on every coin-selector click. The user already sees the active
    // symbol in the chart, the signal chip, the trade form, and the
    // header — a popup duplicating that info was pure noise.
  }, [])

  const thresholdNum = parseFloat(signalThreshold) / 100
  const minWarmup =
    dexStrategyMode === 'ma_cross'
      ? Math.max(16, slowSmaPeriod + 2, fastSmaPeriod + 2)
      : Math.max(16, smaPeriod)
  const prevSignal = useRef<'BUY' | 'SELL' | 'HOLD'>('HOLD')
  /**
   * Timestamp of the last user-facing signal notification (toast OR
   * Telegram). Used to enforce `SIGNAL_TOAST_COOLDOWN_MS` so a noisy
   * market doesn't bury the page in popups every 15s tick.
   */
  const lastSignalToastAtRef = useRef<number>(0)
  const dexBusyRef = useRef(false)
  const prevSignalAutoRef = useRef<'BUY' | 'SELL' | 'HOLD'>('HOLD')
  const wasAutoExecuteRef = useRef(false)
  // Tracks the last time the auto-executor fired a swap. We use a hard cooldown
  // (30s — see AUTO_EXEC_COOLDOWN_MS at module scope) so the bot does not retry
  // every time `signal` flickers BUY → HOLD → BUY on a noisy price feed.
  // Without this, a rejected/failed wallet confirmation would loop on every
  // signal oscillation.
  const lastAutoExecAtRef = useRef<number>(0)
  /** When scale-in is active: timer baseline for the next extra BUY while signal stays BUY. */
  const scaleInAnchorAtRef = useRef<number | null>(null)
  /** Count of successful scale-in BUYs since signal entered BUY with an open position. */
  const scaleInAddsUsedRef = useRef(0)
  const execRef = useRef({
    executeBuy: (_mode: 'strategy' | 'manual') => Promise.resolve(false),
    executeSell: (_trigger?: 'auto' | 'manual') => Promise.resolve(),
  })

  useEffect(() => {
    if (prices.length < minWarmup) {
      setSignal('HOLD')
      setSmaDisplay(null)
      setRsiDisplay(null)
      return
    }
    const thr = Number.isFinite(thresholdNum) && thresholdNum > 0 ? thresholdNum : 0.0015
    const { signal: s, smaValue, rsiValue } = computeDexSignal(prices, {
      mode: dexStrategyMode,
      smaPeriod,
      fastSmaPeriod,
      slowSmaPeriod,
      threshold: thr,
      useRsiFilter,
      rsiBuyMax: 70,
      rsiSellMin: 28,
    })
    setSignal(s)
    setSmaDisplay(smaValue)
    setRsiDisplay(rsiValue)

    // Signal-change notifications, with hysteresis and de-duplication.
    //
    // The previous implementation fired `toast.info(...)` on EVERY signal
    // transition. Combined with a too-strict threshold and a 15s polling
    // tick, that meant noisy markets produced a wall of BUY/HOLD/SELL/HOLD
    // popups every minute — completely unusable. Three guards now apply:
    //
    //   1) Stable toast id (`'dex-signal'`) — sonner deduplicates by id, so
    //      a new BUY toast replaces an older HOLD toast instead of stacking
    //      a fresh card in the corner.
    //   2) 60s cooldown via `lastSignalToastAtRef` — even if the signal
    //      genuinely flips multiple times within a minute, we only surface
    //      the FIRST transition during that window. The signal chip in the
    //      header always reflects the live state.
    //   3) Suppressed entirely when `autoExecuteSwaps` is on — the auto-
    //      executor already emits its own "Auto-exec: ... submitting trade"
    //      toast, and the signal toast would just be a confusing duplicate.
    //      Manual operators still get notified.
    //
    // Telegram alerts use the SAME cooldown so investors who opt in don't
    // get spammed either.
    if (botRunning && s !== prevSignal.current) {
      const now = Date.now()
      const sinceLastToast = now - lastSignalToastAtRef.current
      const cooldownOk = sinceLastToast >= SIGNAL_TOAST_COOLDOWN_MS
      const shouldNotify =
        cooldownOk &&
        !autoExecuteSwaps &&
        ((s === 'BUY' && !inPosition) || (s === 'SELL' && inPosition))

      if (shouldNotify) {
        lastSignalToastAtRef.current = now
        if (s === 'BUY') {
          toast.info('BUY signal — review risk settings, then confirm swap in your wallet.', {
            id: 'dex-signal',
          })
        } else if (s === 'SELL') {
          toast.info('SELL signal — confirm swap in your wallet when ready.', {
            id: 'dex-signal',
          })
        }
      }
      if (
        telegramEnabled &&
        cooldownOk &&
        (s === 'BUY' || s === 'SELL') &&
        prices.length >= minWarmup
      ) {
        // Sharing the cooldown timestamp between toasts and Telegram means
        // even if `shouldNotify` was false (e.g. signal=BUY but already in
        // position), we still don't flood the Telegram chat. The cooldown
        // counter is "any kind of signal notification", not "specifically
        // a toast".
        lastSignalToastAtRef.current = now
        const lp =
          lastPrice !== null && Number.isFinite(lastPrice) ? lastPrice : prices[prices.length - 1]
        void pushDexTelegram({
          kind: 'signal',
          symbol: `${tokenSymbol}/USDT`,
          signal: s,
          refPrice: lp !== undefined && Number.isFinite(lp) ? lp : undefined,
          fearGreed: fearGreed !== null && fearGreed !== undefined ? fearGreed : undefined,
        })
      }
    }
    prevSignal.current = s
  }, [
    prices,
    botRunning,
    inPosition,
    autoExecuteSwaps,
    dexStrategyMode,
    smaPeriod,
    fastSmaPeriod,
    slowSmaPeriod,
    thresholdNum,
    useRsiFilter,
    minWarmup,
    telegramEnabled,
    fearGreed,
    tokenSymbol,
    lastPrice,
    pushDexTelegram,
  ])

  const circuitTripped =
    sessionStats &&
    maxDailyLossUsdt &&
    parseFloat(maxDailyLossUsdt) > 0 &&
    estimatedSessionFlowUsdt(sessionStats) <= -parseFloat(maxDailyLossUsdt)

  const fgMaxParsed = parseInt(fearGreedBuyMax, 10)
  const maxBuysParsed = parseInt(maxBuysPerDay, 10)

  const buyChecks = useMemo(() => {
    return evaluateBuyPreTradeChecks({
      isConnected: effectiveConnected,
      chainId: usePersonalExecution ? BSC_CHAIN_ID : chainId,
      lastPriceAt,
      priceStaleMs: PRICE_STALE_MS,
      slippagePercent,
      usdtPerTrade,
      maxUsdtPerTradeCap,
      circuitTripped: !!circuitTripped,
      minWarmup,
      priceSampleCount: prices.length,
      usdtBal: effectiveUsdtBal,
      tradingHalted,
      fearGreedValue: fearGreed,
      fearGreedBuyMax: Number.isFinite(fgMaxParsed) ? fgMaxParsed : DEFAULT_FG_MAX,
      prices,
      signal,
      rsiDisplay,
      useRsiFilter,
      forceBuy: false,
      manualSwap: false,
      sessionBuyCount: sessionStats.buyCount,
      maxBuysPerDay: Number.isFinite(maxBuysParsed) && maxBuysParsed > 0 ? maxBuysParsed : DEFAULT_MAX_BUYS_DAY,
    })
  }, [
    effectiveConnected,
    chainId,
    lastPriceAt,
    slippagePercent,
    usdtPerTrade,
    maxUsdtPerTradeCap,
    circuitTripped,
    minWarmup,
    prices,
    effectiveUsdtBal,
    tradingHalted,
    fearGreed,
    fgMaxParsed,
    signal,
    rsiDisplay,
    useRsiFilter,
    sessionStats.buyCount,
    maxBuysParsed,
  ])

  const manualBuyChecks = useMemo(() => {
    return evaluateBuyPreTradeChecks({
      isConnected: effectiveConnected,
      chainId: usePersonalExecution ? BSC_CHAIN_ID : chainId,
      lastPriceAt,
      priceStaleMs: PRICE_STALE_MS,
      slippagePercent,
      usdtPerTrade,
      maxUsdtPerTradeCap,
      circuitTripped: !!circuitTripped,
      minWarmup,
      priceSampleCount: prices.length,
      usdtBal: effectiveUsdtBal,
      tradingHalted,
      fearGreedValue: fearGreed,
      fearGreedBuyMax: Number.isFinite(fgMaxParsed) ? fgMaxParsed : DEFAULT_FG_MAX,
      prices,
      signal,
      rsiDisplay,
      useRsiFilter,
      forceBuy: false,
      manualSwap: true,
      sessionBuyCount: sessionStats.buyCount,
      maxBuysPerDay: Number.isFinite(maxBuysParsed) && maxBuysParsed > 0 ? maxBuysParsed : DEFAULT_MAX_BUYS_DAY,
    })
  }, [
    effectiveConnected,
    chainId,
    lastPriceAt,
    slippagePercent,
    usdtPerTrade,
    maxUsdtPerTradeCap,
    circuitTripped,
    minWarmup,
    prices.length,
    effectiveUsdtBal,
    tradingHalted,
    fearGreed,
    fgMaxParsed,
    signal,
    rsiDisplay,
    useRsiFilter,
    sessionStats.buyCount,
    maxBuysParsed,
  ])

  const buyGatesOk = allChecksPass(buyChecks)
  const manualBuyGatesOk = allChecksPass(manualBuyChecks)
  const buyGateBlockReason = useMemo(() => {
    const bad = buyChecks.find((c) => !c.pass)
    if (!bad) return null
    return bad.detail ? `${bad.label}. ${bad.detail}` : bad.label
  }, [buyChecks])

  const strategyBuyDisabled = useMemo(() => {
    return (
      !effectiveConnected ||
      effectiveWrongChain ||
      writePending ||
      !buyGatesOk ||
      signal !== 'BUY' ||
      prices.length < minWarmup
    )
  }, [
    effectiveConnected,
    effectiveWrongChain,
    writePending,
    buyGatesOk,
    signal,
    prices.length,
    minWarmup,
  ])

  const strategyBuyDisabledExplanation = useMemo(() => {
    if (!strategyBuyDisabled) return null
    if (!effectiveConnected) return 'Connect your wallet on BSC.'
    if (effectiveWrongChain) return 'Switch MetaMask to BNB Smart Chain.'
    if (writePending) return 'Finish or dismiss the pending wallet request.'
    if (prices.length < minWarmup)
      return `Collecting chart history (${prices.length}/${minWarmup} samples). Strategy BUY stays off until warmup completes — use Manual BUY or Quick Buy to swap sooner.`
    if (signal !== 'BUY')
      return `On-chart strategy signal is ${signal} (Strategy BUY only fires on BUY). Manual BUY / Quick Buy still swap USDT → ${tokenSymbol} if you choose to.`
    if (!buyGatesOk && buyGateBlockReason) return buyGateBlockReason
    return null
  }, [
    strategyBuyDisabled,
    effectiveConnected,
    effectiveWrongChain,
    writePending,
    prices.length,
    minWarmup,
    signal,
    tokenSymbol,
    buyGatesOk,
    buyGateBlockReason,
  ])
  const manualBuyGateBlockReason = useMemo(() => {
    const bad = manualBuyChecks.find((c) => !c.pass)
    if (!bad) return null
    return bad.detail ? `${bad.label}. ${bad.detail}` : bad.label
  }, [manualBuyChecks])

  const autoGateRef = useRef({
    signal,
    buyGatesOk,
    inPosition,
    tradingHalted,
    dexAutomationPaused,
    circuitTripped,
    isConnected: effectiveConnected,
    wrongChain: effectiveWrongChain,
    address: effectiveAddress ?? undefined,
  })
  autoGateRef.current = {
    signal,
    buyGatesOk,
    inPosition,
    tradingHalted,
    dexAutomationPaused,
    circuitTripped,
    isConnected: effectiveConnected,
    wrongChain: effectiveWrongChain,
    address: effectiveAddress ?? undefined,
  }

  /**
   * Must match the wallet provider's eth_chainId (what viem uses to sign), not only wagmi's React snapshot —
   * MetaMask UI can show BSC while the injected provider wagmi bound is still on Ethereum (multi-wallet / stale sync).
   */
  const ensureBsc = async (): Promise<boolean> => {
    const live = await readConnectorChainId(connector)
    if (live === BSC_CHAIN_ID) return true

    try {
      if (typeof switchChainAsync === 'function') {
        await switchChainAsync({ chainId: BSC_CHAIN_ID })
      } else {
        switchChain?.({ chainId: BSC_CHAIN_ID })
        toast.info('Approve switching to BNB Smart Chain in your wallet.')
      }
      const synced = await waitForConnectorChain(connector, BSC_CHAIN_ID)
      if (!synced) {
        toast.error(
          'Could not confirm BNB Smart Chain (chain id 56) on your wallet. In MetaMask use Networks → BNB Chain (not Ethereum). Disconnect and reconnect with MetaMask if two wallets inject window.ethereum.',
        )
        return false
      }
      return true
    } catch {
      toast.error('Switch to BNB Smart Chain (chain id 56) in your wallet to use PancakeSwap.')
      return false
    }
  }

  const validateTradeSize = (mode: 'strategy' | 'manual'): boolean => {
    const amt = parseFloat(usdtPerTrade)
    const cap = parseFloat(maxUsdtPerTradeCap)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a valid USDT amount.')
      return false
    }
    // Strategy mode still enforces the per-trade cap as the lone hard
    // guardrail for the auto bot — without it a runaway signal could pull
    // arbitrary capital. Daily-loss circuit is now informational across both
    // modes per operator policy.
    if (mode === 'strategy' && Number.isFinite(cap) && cap > 0 && amt > cap) {
      toast.error(`Trade size exceeds your strategy cap (${cap} USDT). Use Manual BUY or raise the cap.`)
      return false
    }
    return true
  }

  /**
   * Quote every candidate Pancake V2 path for a given `amountIn` and return
   * the one that produces the most output (most tokens on BUY, most USDT
   * on SELL). Paths whose pool doesn't exist or reverts are silently
   * skipped — the whole point of having multiple candidates is graceful
   * fallback to the legacy WBNB-routed path.
   *
   * Why this lives in the component instead of `bscTokens.ts`:
   *   The quote needs a viem `publicClient`, which is React/wagmi-bound
   *   and only exists inside the component tree. The candidate generator
   *   (`candidateSwapPaths`) is pure and stays in the shared module.
   *
   * Throws when ALL candidates revert, which signals a real routing
   * problem (wrong token address, Pancake paused, etc.) — callers
   * should treat this as a hard failure, not a missing-pool warning.
   */
  const quoteBestPancakePath = async (
    amountIn: bigint,
    candidates: readonly (readonly `0x${string}`[])[],
  ): Promise<{ path: `0x${string}`[]; expectedOut: bigint }> => {
    if (!publicClient) throw new Error('Wallet client not ready for routing.')
    type Quote = { path: `0x${string}`[]; expectedOut: bigint }
    const results: Quote[] = []
    for (const path of candidates) {
      try {
        const amounts = await publicClient.readContract({
          address: PANCAKE_V2_ROUTER,
          abi: routerAbi,
          functionName: 'getAmountsOut',
          args: [amountIn, [...path]],
        })
        const expectedOut = amounts[amounts.length - 1] ?? 0n
        if (expectedOut > 0n) results.push({ path: [...path], expectedOut })
      } catch {
        /* pool absent or out of liquidity — try the next candidate */
      }
    }
    if (results.length === 0) {
      throw new Error('No Pancake V2 route available for this token right now.')
    }
    results.sort((a, b) =>
      b.expectedOut > a.expectedOut ? 1 : b.expectedOut < a.expectedOut ? -1 : 0,
    )
    return results[0]
  }

  const executeBuy = async (mode: 'strategy' | 'manual'): Promise<boolean> => {
    if (dexBusyRef.current) {
      toast.info('Another wallet transaction is already in progress.')
      return false
    }
    if (!usePersonalExecution && (!address || !publicClient)) return false
    if (!validateTradeSize(mode)) {
      return false
    }
    const gateList = mode === 'manual' ? manualBuyChecks : buyChecks
    if (!allChecksPass(gateList)) {
      const bad = gateList.find((c) => !c.pass)
      toast.error(bad ? `Pre-flight blocked: ${bad.label}` : 'Pre-flight blocked')
      return false
    }
    dexBusyRef.current = true
    try {
      // Highest-priority routing: user opted in to executing via Personal Wallet.
      // The platform signs the swap server-side — no MetaMask popup.
      if (usePersonalWallet && personalWalletReady) {
        toast.loading(`Personal wallet BUY ${tokenSymbol}…`, { id: 'dex-personal' })
        const result = await personalWallet.swap({
          side: 'BUY',
          tokenSymbol: symbolForPersonalWallet(tokenSymbol),
          amount: parseFloat(usdtPerTrade),
          slippageBps: Number(slippageBps),
        })
        toast.success(
          `Personal wallet BUY confirmed · ${result.expectedOut} ${tokenSymbol} (tx ${result.txHash.slice(0, 10)}…)`,
          { id: 'dex-personal' },
        )
        setInPosition(true)
        const fillEntry = result.trade?.entryPrice
        if (Number.isFinite(fillEntry) && fillEntry > 0) {
          setDexEntryPrice(fillEntry)
        } else if (Number.isFinite(lastPrice ?? NaN) && (lastPrice as number) > 0) {
          setDexEntryPrice(lastPrice as number)
        }
        const usdtFloat = parseFloat(usdtPerTrade)
        if (Number.isFinite(usdtFloat)) {
          setSessionStats((prev) => {
            const next: DexSessionStats = {
              ...prev,
              buysUsdtTotal: prev.buysUsdtTotal + usdtFloat,
              buyCount: prev.buyCount + 1,
            }
            saveDexSession(next)
            return next
          })
        }
        await refreshPersonalWalletStatus()
        return true
      }

      const delegatedReady = Boolean(delegateStatus?.enabled && delegateStatus?.hotWalletConfigured)
      if (delegatedReady) {
        toast.loading('Delegated BUY executing (server-signed)…', { id: 'dex-delegate' })
        await hotWallet.delegateSwap({ direction: 'buy', usdtAmount: parseFloat(usdtPerTrade) })
        toast.success('Delegated BUY executed.', { id: 'dex-delegate' })
        setInPosition(true)
        if (Number.isFinite(lastPrice ?? NaN) && (lastPrice as number) > 0) {
          setDexEntryPrice(lastPrice as number)
        }
        const usdtFloat = parseFloat(usdtPerTrade)
        if (Number.isFinite(usdtFloat)) {
          setSessionStats((prev) => {
            const next: DexSessionStats = {
              ...prev,
              buysUsdtTotal: prev.buysUsdtTotal + usdtFloat,
              buyCount: prev.buyCount + 1,
            }
            saveDexSession(next)
            return next
          })
        }
        await refreshDelegateStatus()
        return true
      }

      if (!publicClient || !address) {
        toast.error('Connect your wallet to complete this swap.')
        return false
      }

      const ok = await ensureBsc()
      if (!ok) return false

      let amountIn: bigint
      try {
        amountIn = parseUnits(usdtPerTrade, 18)
      } catch {
        toast.error('Invalid USDT amount.')
        return false
      }
      if (amountIn <= 0n) {
        toast.error('Amount must be positive.')
        return false
      }

      const allowance = await publicClient.readContract({
        address: BSC_USDT,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, PANCAKE_V2_ROUTER],
      })

      if (allowance < amountIn) {
        toast.loading('Approve USDT for Pancake router…', { id: 'dex-tx' })
        const hash = await writeContractAsync({
          chainId: bsc.id,
          address: BSC_USDT,
          abi: erc20Abi,
          functionName: 'approve',
          args: [PANCAKE_V2_ROUTER, maxUint256],
        })
        await publicClient.waitForTransactionReceipt({ hash })
        toast.dismiss('dex-tx')
      }

      const readBal = async (tokenAddr: `0x${string}`, decimals: number) =>
        Number(
          formatUnits(
            (await publicClient.readContract({
              address: tokenAddr,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [address],
            })) as bigint,
            decimals,
          ),
        )
      const usdtBalBeforeBuy = await readBal(BSC_USDT, 18)
      const tokBalBeforeBuy = await readBal(tokenAddress, tokenDecimals)

      // Pick the cheapest available Pancake V2 route at execution time.
      // For blue chips with deep direct USDT pools (BTCB, ETH, USDC) this
      // saves a full 0.25% LP fee + the price impact of the WBNB pool vs
      // the legacy 2-hop path. Falls back to the WBNB route automatically
      // when the direct pool is missing.
      const { path: bestBuyPath, expectedOut } = await quoteBestPancakePath(
        amountIn,
        candidateBuyPaths,
      )
      const amountOutMin = (expectedOut * (10_000n - slippageBps)) / 10_000n
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20)

      toast.loading('Confirm swap in wallet…', { id: 'dex-swap' })
      const hash = await writeContractAsync({
        chainId: bsc.id,
        address: PANCAKE_V2_ROUTER,
        abi: routerAbi,
        functionName: 'swapExactTokensForTokens',
        args: [amountIn, amountOutMin, [...bestBuyPath], address, deadline],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      toast.success('Buy swap submitted.', { id: 'dex-swap' })
      setInPosition(true)
      // Direct-wallet path computes a real fill price below from on-chain
      // balance deltas; we set the live tick first as a fallback so TP/SL
      // already arms even if the balance-diff calc fails for any reason.
      if (Number.isFinite(lastPrice ?? NaN) && (lastPrice as number) > 0) {
        setDexEntryPrice(lastPrice as number)
      }
      await refreshBalances()

      try {
        const usdtBalAfterBuy = await readBal(BSC_USDT, 18)
        const tokBalAfterBuy = await readBal(tokenAddress, tokenDecimals)
        const quotedOutNum = Number(formatUnits(expectedOut, tokenDecimals))
        const amountInNum = Number(formatUnits(amountIn, 18))
        const spentUsdt = usdtBalBeforeBuy - usdtBalAfterBuy
        const recvTok = tokBalAfterBuy - tokBalBeforeBuy
        const allocationUsd = Math.max(0, spentUsdt)
        const entryPriceEff =
          recvTok > 1e-18 ? spentUsdt / recvTok : amountInNum / Math.max(quotedOutNum, Number.EPSILON)
        // Replace the live-tick approximation with the actual fill price so
        // TP/SL trigger on the exact swap outcome (including pool slippage).
        if (Number.isFinite(entryPriceEff) && entryPriceEff > 0) {
          setDexEntryPrice(entryPriceEff)
        }
        const safePnl = dexBuyRealizedPnlUsd({
          spentUsdt,
          recvTok,
          amountInUsdt: amountInNum,
          quotedOutTok: quotedOutNum,
        })
        await trades.logExecution({
          pair: `${tokenSymbol}/USDT`,
          side: 'BUY',
          entryPrice: Number.isFinite(entryPriceEff) && entryPriceEff > 0 ? entryPriceEff : 0.00000001,
          ...(allocationUsd > 1e-9 ? { allocationUsd: Math.round(allocationUsd * 1e8) / 1e8 } : {}),
          pnl: safePnl,
        })
      } catch {
        /* trade row optional — swap already succeeded */
      }
      window.dispatchEvent(new Event('dashboard:refresh'))
      window.dispatchEvent(new Event('portfolio:update'))

      void pushDexTelegram({
        kind: 'swap_success',
        side: 'BUY',
        tokenSymbol,
        amountIn: `${usdtPerTrade} USDT`,
        expectedOut: `${formatUnits(expectedOut, tokenDecimals)} ${tokenSymbol}`,
        txHash: hash,
        trigger: mode === 'strategy' ? 'auto' : 'manual',
      })

      const usdtFloat = parseFloat(usdtPerTrade)
      if (Number.isFinite(usdtFloat)) {
        setSessionStats((prev) => {
          const next: DexSessionStats = {
            ...prev,
            buysUsdtTotal: prev.buysUsdtTotal + usdtFloat,
            buyCount: prev.buyCount + 1,
          }
          saveDexSession(next)
          return next
        })
      }
      return true
    } catch (e) {
      toast.dismiss('dex-delegate')
      toast.dismiss('dex-tx')
      toast.dismiss('dex-swap')
      const msg = e instanceof Error ? e.message : 'Swap failed'
      toast.error(msg)
      void pushDexTelegram({
        kind: 'swap_failed',
        message: augmentDexSwapFailureDetail(msg),
        side: 'BUY',
        tokenSymbol,
        trigger: mode === 'strategy' ? 'auto' : 'manual',
      })
      return false
    } finally {
      dexBusyRef.current = false
    }
  }

  const executeSell = async (sellTrigger: 'auto' | 'manual' = 'manual') => {
    if (dexBusyRef.current) {
      toast.info('Another wallet transaction is already in progress.')
      return
    }
    if (tradingHalted) {
      toast.error('Kill switch is on — disable halt to execute sells.')
      return
    }
    // Personal wallet route doesn't require MetaMask; everything else does.
    if (!usePersonalWallet || !personalWalletReady) {
      if (!address || !publicClient) return
      const okChain = await ensureBsc()
      if (!okChain) return
    if (!wbnbBal || wbnbBal === 0n) {
        toast.error(`No ${tokenSymbol} balance to sell.`)
      return
      }
    }
    dexBusyRef.current = true
    try {
      if (usePersonalWallet && personalWalletReady) {
        toast.loading(`Personal wallet SELL ${tokenSymbol}…`, { id: 'dex-personal' })
        const status = await personalWallet.status()
        const balance = status.wallet?.balances.find((b) => b.asset === tokenSymbol)?.amount ?? 0
        if (balance <= 0) {
          toast.error(`No ${tokenSymbol} in your personal wallet to sell.`, { id: 'dex-personal' })
          return
        }
        const result = await personalWallet.swap({
          side: 'SELL',
          tokenSymbol: symbolForPersonalWallet(tokenSymbol),
          amount: balance,
          slippageBps: Number(slippageBps),
        })
        const closed = result.trade?.side === 'CLOSED'
        const pnlUsd = closed && result.trade?.pnl != null ? result.trade.pnl : null
        const pnlLine =
          pnlUsd != null && Number.isFinite(pnlUsd)
            ? ` · Profit ${pnlUsd >= 0 ? '+' : ''}$${pnlUsd.toFixed(2)}`
            : ''
        toast.success(
          `Bot SELL ${tokenSymbol} · ~$${result.expectedOut} USDT${pnlLine}`,
          { id: 'dex-personal', duration: 10_000 },
        )
        setInPosition(false)
        // Clear entry mark — TP/SL is per-position and must not carry over.
        setDexEntryPrice(null)
        const quotedOut = parseFloat(result.expectedOut)
        if (Number.isFinite(quotedOut) && quotedOut > 0) {
          setSessionStats((prev) => {
            const next: DexSessionStats = {
              ...prev,
              sellsUsdtTotal: prev.sellsUsdtTotal + quotedOut,
              sellCount: prev.sellCount + 1,
            }
            saveDexSession(next)
            return next
          })
        }
        await refreshPersonalWalletStatus()
        window.dispatchEvent(new Event('dashboard:refresh'))
        window.dispatchEvent(new Event('portfolio:update'))
        return
      }
      const delegatedReady = Boolean(delegateStatus?.enabled && delegateStatus?.hotWalletConfigured)
      if (delegatedReady) {
        toast.loading('Delegated SELL executing (server-signed)…', { id: 'dex-delegate' })
        const result = await hotWallet.delegateSwap({ direction: 'sell' })
        toast.success('Delegated SELL executed.', { id: 'dex-delegate' })
        setInPosition(false)
        setDexEntryPrice(null)

        const quotedOut = Number(result?.result?.usdtNotional ?? 0)
        if (Number.isFinite(quotedOut) && quotedOut > 0) {
          setSessionStats((prev) => {
            const next: DexSessionStats = {
              ...prev,
              sellsUsdtTotal: prev.sellsUsdtTotal + quotedOut,
              sellCount: prev.sellCount + 1,
            }
            saveDexSession(next)
            return next
          })
        }
        await refreshDelegateStatus()
        return
      }

      // MetaMask path — guards above ensure these are present.
      if (!address || !publicClient || !wbnbBal) {
        toast.error('Wallet not ready for sell.')
        return
      }
      const amountIn: bigint = wbnbBal
      const allowance = await publicClient.readContract({
        address: tokenAddress,
        abi: erc20Abi,
        functionName: 'allowance',
        args: [address, PANCAKE_V2_ROUTER],
      })

      if (allowance < amountIn) {
        toast.loading(`Approve ${tokenSymbol} for Pancake router…`, { id: 'dex-tx' })
        const approveHash = await writeContractAsync({
          chainId: bsc.id,
          address: tokenAddress,
          abi: erc20Abi,
          functionName: 'approve',
          args: [PANCAKE_V2_ROUTER, maxUint256],
        })
        await publicClient.waitForTransactionReceipt({ hash: approveHash })
        toast.dismiss('dex-tx')
      }

      const readBalSell = async (tokenAddr: `0x${string}`, decimals: number) =>
        Number(
          formatUnits(
            (await publicClient.readContract({
              address: tokenAddr,
              abi: erc20Abi,
              functionName: 'balanceOf',
              args: [address],
            })) as bigint,
            decimals,
          ),
        )
      const usdtBalBeforeSell = await readBalSell(BSC_USDT, 18)
      const tokBalBeforeSell = await readBalSell(tokenAddress, tokenDecimals)

      // Same best-path routing as BUY: quote both direct TOKEN→USDT and
      // TOKEN→WBNB→USDT, pick the route that returns more USDT. The
      // legacy `swapPathSell` is retained above as a debug/fallback
      // reference only — the actual swap uses `bestSellPath`.
      const { path: bestSellPath, expectedOut: expectedUsdtOut } = await quoteBestPancakePath(
        amountIn,
        candidateSellPaths,
      )
      const amountOutMin = (expectedUsdtOut * (10_000n - slippageBps)) / 10_000n
      const deadline = BigInt(Math.floor(Date.now() / 1000) + 60 * 20)

      toast.loading('Confirm swap in wallet…', { id: 'dex-swap' })
      const hash = await writeContractAsync({
        chainId: bsc.id,
        address: PANCAKE_V2_ROUTER,
        abi: routerAbi,
        functionName: 'swapExactTokensForTokens',
        args: [amountIn, amountOutMin, [...bestSellPath], address, deadline],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      toast.success('Sell swap submitted.', { id: 'dex-swap' })
      setInPosition(false)
      setDexEntryPrice(null)
      await refreshBalances()

      try {
        const usdtBalAfterSell = await readBalSell(BSC_USDT, 18)
        const tokBalAfterSell = await readBalSell(tokenAddress, tokenDecimals)
        const quotedOutNum = Number(formatUnits(expectedUsdtOut, 18))
        const amountInNum = Number(formatUnits(amountIn, tokenDecimals))
        const recvUsdt = usdtBalAfterSell - usdtBalBeforeSell
        const soldTok = tokBalBeforeSell - tokBalAfterSell
        const allocationUsd = Math.max(0, recvUsdt)
        const entryPriceEff =
          soldTok > 1e-18 ? recvUsdt / soldTok : quotedOutNum / Math.max(amountInNum, Number.EPSILON)
        const safePnl = dexSellRealizedPnlUsd({
          recvUsdt,
          soldTok,
          amountInTok: amountInNum,
          quotedUsdtOut: quotedOutNum,
        })
        await trades.logExecution({
          pair: `${tokenSymbol}/USDT`,
          side: 'SELL',
          entryPrice: Number.isFinite(entryPriceEff) && entryPriceEff > 0 ? entryPriceEff : 0.00000001,
          ...(allocationUsd > 1e-9 ? { allocationUsd: Math.round(allocationUsd * 1e8) / 1e8 } : {}),
          pnl: safePnl,
        })
      } catch {
        /* trade row optional — swap already succeeded */
      }
      window.dispatchEvent(new Event('dashboard:refresh'))
      window.dispatchEvent(new Event('portfolio:update'))

      void pushDexTelegram({
        kind: 'swap_success',
        side: 'SELL',
        tokenSymbol,
        amountIn: `${formatUnits(amountIn, tokenDecimals)} ${tokenSymbol}`,
        expectedOut: `${formatUnits(expectedUsdtOut, 18)} USDT`,
        txHash: hash,
        trigger: sellTrigger,
      })

      const usdtReceived = parseFloat(formatUnits(expectedUsdtOut, 18))
      if (Number.isFinite(usdtReceived)) {
        setSessionStats((prev) => {
          const next: DexSessionStats = {
            ...prev,
            sellsUsdtTotal: prev.sellsUsdtTotal + usdtReceived,
            sellCount: prev.sellCount + 1,
          }
          saveDexSession(next)
          return next
        })
      }
    } catch (e) {
      toast.dismiss('dex-delegate')
      toast.dismiss('dex-tx')
      toast.dismiss('dex-swap')
      const msg = e instanceof Error ? e.message : 'Swap failed'
      toast.error(msg)
      void pushDexTelegram({
        kind: 'swap_failed',
        message: augmentDexSwapFailureDetail(msg),
        side: 'SELL',
        tokenSymbol,
        trigger: sellTrigger,
      })
    } finally {
      dexBusyRef.current = false
    }
  }

  execRef.current = {
    executeBuy,
    executeSell: (t?: 'auto' | 'manual') => executeSell(t ?? 'manual'),
  }

  // Reset scale-in streak when not BUY or flat; arm anchor when entering BUY + position.
  useEffect(() => {
    if (!scaleInWhileBuyEnabled || signal !== 'BUY' || !inPosition) {
      scaleInAnchorAtRef.current = null
      scaleInAddsUsedRef.current = 0
      setScaleInAddsUsedDisplay(0)
      return
    }
    if (scaleInAnchorAtRef.current === null) {
      scaleInAnchorAtRef.current = Date.now()
    }
  }, [signal, inPosition, scaleInWhileBuyEnabled])

  // Timer-based scale-in BUYs while signal stays BUY (DCA-style additions).
  useEffect(() => {
    if (!scaleInWhileBuyEnabled || !autoExecuteSwaps || dexAutomationPaused) return
    if (!effectiveConnected || effectiveWrongChain || !effectiveAddress) return

    const tick = () => {
      if (!scaleInWhileBuyEnabled || dexAutomationPaused || tradingHalted) return
      if (!autoExecuteSwaps || signal !== 'BUY' || !inPosition) return
      const maxAdds = Math.max(0, Math.min(50, parseInt(scaleInMaxAdds, 10) || 0))
      if (maxAdds <= 0) return
      if (scaleInAddsUsedRef.current >= maxAdds) return
      if (!buyGatesOk) return
    if (dexBusyRef.current) return
      const anchor = scaleInAnchorAtRef.current
      if (anchor === null) return
      const mins = Math.max(1, Math.min(24 * 60, parseInt(scaleInIntervalMinutes, 10) || 5))
      const intervalMs = mins * 60_000
      const sinceAnchor = Date.now() - anchor
      if (sinceAnchor < intervalMs) return
      const sinceLastExec = Date.now() - lastAutoExecAtRef.current
      if (sinceLastExec < AUTO_EXEC_COOLDOWN_MS) return

      lastAutoExecAtRef.current = Date.now()
      void (async () => {
        const ok = await execRef.current.executeBuy('strategy')
        if (ok) {
          scaleInAddsUsedRef.current += 1
          scaleInAnchorAtRef.current = Date.now()
          const n = scaleInAddsUsedRef.current
          setScaleInAddsUsedDisplay(n)
          toast.success(`Scale-in BUY ${n}/${maxAdds} filled — still in BUY.`)
        }
      })()
    }

    const id = window.setInterval(tick, SCALE_IN_POLL_MS)
    return () => window.clearInterval(id)
  }, [
    scaleInWhileBuyEnabled,
    autoExecuteSwaps,
    dexAutomationPaused,
    effectiveConnected,
    effectiveWrongChain,
    effectiveAddress,
    tradingHalted,
    signal,
    inPosition,
    scaleInMaxAdds,
    scaleInIntervalMinutes,
    buyGatesOk,
  ])

  // Live countdown for the next scale-in window.
  useEffect(() => {
    if (!scaleInWhileBuyEnabled) {
      setNextScaleInEtaSec(null)
      return
    }

    const tick = () => {
      const maxAdds = Math.max(0, Math.min(50, parseInt(scaleInMaxAdds, 10) || 0))
      if (
        !autoExecuteSwaps ||
        dexAutomationPaused ||
        tradingHalted ||
        signal !== 'BUY' ||
        !inPosition ||
        !effectiveConnected ||
        effectiveWrongChain ||
        !effectiveAddress ||
        !buyGatesOk ||
        maxAdds <= 0 ||
        scaleInAddsUsedRef.current >= maxAdds
      ) {
        setNextScaleInEtaSec(null)
        return
      }

      const anchor = scaleInAnchorAtRef.current
      if (anchor === null) {
        setNextScaleInEtaSec(null)
        return
      }
      const mins = Math.max(1, Math.min(24 * 60, parseInt(scaleInIntervalMinutes, 10) || 5))
      const intervalMs = mins * 60_000
      const remainingMs = Math.max(0, intervalMs - (Date.now() - anchor))
      setNextScaleInEtaSec(Math.ceil(remainingMs / 1000))
    }

    tick()
    const id = window.setInterval(tick, 1000)
    return () => window.clearInterval(id)
  }, [
    scaleInWhileBuyEnabled,
    scaleInMaxAdds,
    scaleInIntervalMinutes,
    autoExecuteSwaps,
    dexAutomationPaused,
    tradingHalted,
    signal,
    inPosition,
    effectiveConnected,
    effectiveWrongChain,
    effectiveAddress,
    buyGatesOk,
    scaleInAddsUsedDisplay,
  ])

  /**
   * Take-profit / stop-loss / trailing-stop watcher.
   *
   * Runs every time the live tick updates while a position is open and the
   * feature is enabled. Maintains three derived values per tick:
   *   1. `pct`  — current unrealized P/L vs entry (drives the UI badge).
   *   2. `peak` — running maximum price observed since entry (ratcheted
   *               upward each tick; never lowered). Lazy-initialised to the
   *               entry on the first tick after BUY and persisted to
   *               localStorage so refreshes don't reset the locked-in floor.
   *   3. Auto-exit triggers:
   *        - if pct ≥ takeProfitPct                            → auto-SELL
   *        - if trailingStopEnabled && cur ≤ peak·(1 − SL%)    → auto-SELL
   *        - else if !trailingStopEnabled && pct ≤ −SL%        → auto-SELL
   *
   * Why centralising the peak here:
   *   - Six different BUY paths set `dexEntryPrice`. Mirroring a
   *     `setDexTrailingPeak` next to each would be six places to forget.
   *     Letting the watcher lazily bootstrap (peak = entry on first tick
   *     where it's null) means there's exactly one place to reason about
   *     trailing state and the BUY/SELL handlers stay untouched.
   *   - Same `inPosition === false` exit clears peak too — no stale ratchet
   *     leaks across trades.
   *
   * Other design notes:
   *   - We piggyback on the existing `lastPrice` polling so there is **no
   *     extra setInterval**. Cost is one arithmetic comparison per tick.
   *   - The same hard `AUTO_EXEC_COOLDOWN_MS` and `dexBusyRef` guards used by
   *     the signal-driven auto-executor protect against double-fires when a
   *     tick lands during an in-flight swap.
   *   - We respect `tradingHalted` (kill switch) and `dexAutomationPaused`
   *     so an operator can hold a position through TP/SL temporarily.
   *   - `setDexUnrealizedPct(pct)` always runs first so the UI badge updates
   *     even when TP/SL is disabled or auto-exec is off — purely informational
   *     in that case.
   *   - Telegram: `executeSell('auto')` already emits a `swap_success` event
   *     downstream, so we only add a one-line trigger toast here (no extra
   *     network call from this effect).
   */
  useEffect(() => {
    if (!inPosition) {
      setDexUnrealizedPct(null)
      // Leaving a position must clear the peak too; otherwise the next
      // BUY would inherit a ratchet from a previous (possibly losing)
      // trade and arm the trailing stop too tight.
      if (dexTrailingPeak !== null) setDexTrailingPeak(null)
      return
    }
    if (
      dexEntryPrice === null ||
      !Number.isFinite(dexEntryPrice) ||
      dexEntryPrice <= 0
    ) {
      setDexUnrealizedPct(null)
      return
    }
    if (!Number.isFinite(lastPrice ?? NaN) || (lastPrice as number) <= 0) return

    const entry = dexEntryPrice
    const cur = lastPrice as number
    const pct = ((cur - entry) / entry) * 100
    setDexUnrealizedPct(pct)

    // Ratchet the trailing peak. `prevPeak` defaults to entry on first
    // tick of a position (lazy init) or whenever a persisted peak is
    // somehow below entry (defensive clamp). Then `nextPeak` only
    // increases — it never moves down.
    const prevPeak =
      dexTrailingPeak !== null &&
      Number.isFinite(dexTrailingPeak) &&
      dexTrailingPeak >= entry
        ? dexTrailingPeak
        : entry
    const nextPeak = cur > prevPeak ? cur : prevPeak
    if (nextPeak !== dexTrailingPeak) {
      setDexTrailingPeak(nextPeak)
    }

    // The UI badge updates regardless; only the auto-sell trigger is gated.
    if (!tpSlEnabled) return
    if (!autoExecuteSwaps || dexAutomationPaused || tradingHalted) return
    if (dexBusyRef.current) return

    const tp = parseFloat(takeProfitPct)
    const sl = parseFloat(stopLossPct)
    const tpArmed = Number.isFinite(tp) && tp > 0
    const slArmed = Number.isFinite(sl) && sl > 0
    if (!tpArmed && !slArmed) return

    const sinceLastExec = Date.now() - lastAutoExecAtRef.current
    if (sinceLastExec < AUTO_EXEC_COOLDOWN_MS) return

    // TP gets evaluated FIRST so a tick that crosses both TP and (any) SL
    // simultaneously settles as the more-profitable exit. Realistic for
    // a single tick to do both only on illiquid pools or stale ticks; we
    // still want the friendlier outcome when it happens.
    if (tpArmed && pct >= tp) {
      lastAutoExecAtRef.current = Date.now()
      toast.success(`Take-profit hit (+${pct.toFixed(2)}%) — auto-selling`, {
        id: 'dex-tpsl',
      })
      void execRef.current.executeSell('auto')
      return
    }
    if (slArmed) {
      if (trailingStopEnabled) {
        // Trailing exit: stop level rides `slPct` below the running peak.
        // `peakPct` = how far the peak has moved above entry; useful in
        // the toast so the operator sees why the stop fired (e.g. peak
        // ran +3% but we exited at +1.8% because price retraced 1.2%).
        const stopLevel = nextPeak * (1 - sl / 100)
        if (cur <= stopLevel) {
          lastAutoExecAtRef.current = Date.now()
          const peakPct = ((nextPeak - entry) / entry) * 100
          toast.warning(
            `Trailing stop fired at ${pct.toFixed(2)}% (peak was +${peakPct.toFixed(2)}%) — auto-selling`,
            { id: 'dex-tpsl' },
          )
          void execRef.current.executeSell('auto')
          return
        }
      } else if (pct <= -sl) {
        // Classic fixed stop: distance from entry, ignores any ratchet.
        lastAutoExecAtRef.current = Date.now()
        toast.warning(`Stop-loss hit (${pct.toFixed(2)}%) — auto-selling`, {
          id: 'dex-tpsl',
        })
        void execRef.current.executeSell('auto')
        return
      }
    }
  }, [
    tpSlEnabled,
    trailingStopEnabled,
    inPosition,
    dexEntryPrice,
    dexTrailingPeak,
    lastPrice,
    takeProfitPct,
    stopLossPct,
    autoExecuteSwaps,
    dexAutomationPaused,
    tradingHalted,
  ])

  // Disabled: previously this effect auto-fired a manual BUY the moment the
  // wallet connected and gates passed. That bypassed every cooldown and
  // triggered a MetaMask popup loop without the user clicking anything.
  // Trades now require an explicit click on Quick Buy / Strategy BUY / Manual
  // BUY, or the cooldown-gated signal-driven auto-executor below.
  useEffect(() => {
    if (!forcedFirstTrade) setForcedFirstTrade(true)
  }, [forcedFirstTrade])

  // On mount, clear any stale "Confirm swap in wallet…" toasts left over
  // from a previous render or hot-reload. Without this, the loading toast
  // can appear to persist across reloads even though no swap is in flight.
  useEffect(() => {
    toast.dismiss('dex-swap')
    toast.dismiss('dex-tx')
    toast.dismiss('dex-delegate')
    toast.dismiss('dex-personal')
  }, [])

  const preApproveUsdtForRouter = async () => {
    if (dexBusyRef.current) {
      toast.info('Another wallet transaction is already in progress.')
      return
    }
    if (!address || !publicClient || usePersonalExecution) return
    dexBusyRef.current = true
    try {
      const ok = await ensureBsc()
      if (!ok) return
      toast.loading('Approve USDT for Pancake router…', { id: 'dex-tx' })
      const hash = await writeContractAsync({
        chainId: bsc.id,
        address: BSC_USDT,
        abi: erc20Abi,
        functionName: 'approve',
        args: [PANCAKE_V2_ROUTER, maxUint256],
      })
      await publicClient.waitForTransactionReceipt({ hash })
      toast.success('USDT allowance set — future BUYs only need the swap signature.', { id: 'dex-tx' })
      await refreshBalances()
    } catch (e) {
      toast.dismiss('dex-tx')
      const msg = e instanceof Error ? e.message : 'Approve failed'
      toast.error(msg)
    } finally {
      dexBusyRef.current = false
    }
  }

  useEffect(() => {
    const justOn = autoExecuteSwaps && !wasAutoExecuteRef.current
    wasAutoExecuteRef.current = autoExecuteSwaps
    if (!justOn) return
    const t = window.setTimeout(() => {
      const g = autoGateRef.current
      // Permissive auto-arm: only the user's master kill switch can prevent
      // an AI-signal-driven trade from firing. Daily-loss circuit is now an
      // informational warning, not a hard stop, per operator policy.
      if (
        g.signal === 'BUY' &&
        !g.inPosition &&
        g.buyGatesOk &&
        !g.tradingHalted &&
        !g.dexAutomationPaused &&
        g.isConnected &&
        !g.wrongChain &&
        g.address &&
        !dexBusyRef.current &&
        Date.now() - lastAutoExecAtRef.current >= AUTO_EXEC_COOLDOWN_MS
      ) {
        lastAutoExecAtRef.current = Date.now()
        toast.info('Auto-exec: AI signal is BUY — submitting trade.')
        void execRef.current.executeBuy('strategy')
      }
    }, 500)
    return () => window.clearTimeout(t)
  }, [autoExecuteSwaps])

  useEffect(() => {
    if (!autoExecuteSwaps) {
      prevSignalAutoRef.current = signal
      return
    }
    if (dexAutomationPaused) {
      prevSignalAutoRef.current = signal
      return
    }
    if (!effectiveConnected || effectiveWrongChain || !effectiveAddress) {
      prevSignalAutoRef.current = signal
      return
    }

    const prev = prevSignalAutoRef.current
    prevSignalAutoRef.current = signal
    if (prev === signal) return

    if (signal === 'BUY' && prev !== 'BUY' && !inPosition) {
      // Only the master kill switch stops auto-trading. Circuit breaker is
      // informational; the server-side 15% account drawdown remains the final
      // safety net.
      if (tradingHalted) {
        toast.warning('Auto BUY skipped — master kill switch is ON.')
        return
      }
      if (!buyGatesOk) {
        toast.warning('Auto BUY skipped — wallet/balance/chain not ready.')
        return
      }
      if (dexBusyRef.current) return
      const sinceLast = Date.now() - lastAutoExecAtRef.current
      if (sinceLast < AUTO_EXEC_COOLDOWN_MS) {
        // Silently skip — log only at the head of a cooldown window so the
        // user is not spammed with toasts every signal flip.
        return
      }
      if (circuitTripped) {
        toast.warning('Daily-loss circuit tripped — proceeding anyway (informational only).')
      }
      lastAutoExecAtRef.current = Date.now()
      toast.info('Auto BUY firing — AI signal aligned.')
      void execRef.current.executeBuy('strategy')
      return
    }

    if (signal === 'SELL' && prev !== 'SELL' && inPosition) {
      if (tradingHalted) {
        toast.warning('Auto SELL skipped — kill switch is on.')
        return
      }
      if (!effectiveTokenBal || effectiveTokenBal === 0n) {
        toast.warning(`Auto SELL skipped — no ${tokenSymbol} to sell.`)
        return
      }
      if (dexBusyRef.current) return
      const sinceLast = Date.now() - lastAutoExecAtRef.current
      if (sinceLast < AUTO_EXEC_COOLDOWN_MS) return
      lastAutoExecAtRef.current = Date.now()
      toast.info('Auto SELL firing — exit signal aligned.')
      void execRef.current.executeSell('auto')
    }
  }, [
    autoExecuteSwaps,
    dexAutomationPaused,
    signal,
    isConnected,
    wrongChain,
    address,
    effectiveConnected,
    effectiveWrongChain,
    effectiveAddress,
    inPosition,
    buyGatesOk,
    tradingHalted,
    circuitTripped,
    wbnbBal,
    effectiveTokenBal,
    tokenSymbol,
  ])

  /**
   * "Armed-and-ready" auto-BUY trigger.
   *
   * The original auto-executor was edge-triggered (fires only when signal
   * flips HOLD→BUY) plus a one-shot kick-start when `autoExecuteSwaps` flips
   * on. That left a real-world dead zone: if the user toggles auto-trading
   * while signal is *already* BUY and gates aren't ready yet (warmup not
   * complete, personal-wallet balance still loading, etc.), the kick-start
   * silently bails and the edge has long since passed — so nothing ever
   * fires until the next HOLD→BUY transition, which on a trending pair
   * may not come for hours.
   *
   * This effect closes that gap by firing once whenever ALL favorable
   * conditions are simultaneously true. We use a ref-based "fired" latch
   * that auto-clears on any unfavorable change (signal leaves BUY, position
   * opens, wallet disconnects, auto-exec paused), so the next favorable
   * window can fire again without ever double-firing within the same one.
   *
   * The cooldown ref + `dexBusyRef` + `inPosition` check provide additional
   * thundering-herd protection — even if React re-runs this effect rapidly,
   * a successful fire bumps the cooldown timestamp so subsequent calls
   * short-circuit on the cooldown guard.
   *
   * Why this matters specifically for personal-wallet users:
   *   `personalWalletReady` flips to true asynchronously after the wallet
   *   status fetch completes, which is AFTER the user toggles auto-exec.
   *   So the kick-start always saw `usePersonalExecution=false`, and gates
   *   were evaluated against the empty MetaMask connection. By the time
   *   the personal wallet loaded, kick-start had already bailed.
   */
  const armedReadyFiredRef = useRef(false)
  useEffect(() => {
    // Bail early on any unfavorable state; reset the latch so the next
    // favorable window is allowed to fire.
    if (!autoExecuteSwaps || dexAutomationPaused || tradingHalted) {
      armedReadyFiredRef.current = false
      return
    }
    if (signal !== 'BUY' || inPosition) {
      armedReadyFiredRef.current = false
      return
    }
    if (!effectiveConnected || effectiveWrongChain || !effectiveAddress) return
    if (!buyGatesOk) return
    if (dexBusyRef.current) return
    if (Date.now() - lastAutoExecAtRef.current < AUTO_EXEC_COOLDOWN_MS) return
    if (armedReadyFiredRef.current) return

    armedReadyFiredRef.current = true
    lastAutoExecAtRef.current = Date.now()
    toast.info('Auto-exec: AI signal is BUY and gates ready — submitting trade.')
    void execRef.current.executeBuy('strategy')
  }, [
    autoExecuteSwaps,
    dexAutomationPaused,
    tradingHalted,
    signal,
    inPosition,
    effectiveConnected,
    effectiveWrongChain,
    effectiveAddress,
    buyGatesOk,
  ])

  /** Mirror of armed-ready BUY: fire auto-SELL when signal is SELL and we hold. */
  const armedSellReadyFiredRef = useRef(false)
  useEffect(() => {
    if (!autoExecuteSwaps || dexAutomationPaused || tradingHalted) {
      armedSellReadyFiredRef.current = false
      return
    }
    if (signal !== 'SELL' || !inPosition) {
      armedSellReadyFiredRef.current = false
      return
    }
    if (!effectiveConnected || effectiveWrongChain || !effectiveAddress) return
    if (!effectiveTokenBal || effectiveTokenBal === 0n) return
    if (dexBusyRef.current) return
    if (Date.now() - lastAutoExecAtRef.current < AUTO_EXEC_COOLDOWN_MS) return
    if (armedSellReadyFiredRef.current) return

    armedSellReadyFiredRef.current = true
    lastAutoExecAtRef.current = Date.now()
    toast.info(`Auto-exec: SELL signal — selling ${tokenSymbol}`, { id: 'dex-signal' })
    void execRef.current.executeSell('auto')
  }, [
    autoExecuteSwaps,
    dexAutomationPaused,
    tradingHalted,
    signal,
    inPosition,
    effectiveConnected,
    effectiveWrongChain,
    effectiveAddress,
    effectiveTokenBal,
    tokenSymbol,
  ])

  /**
   * Human-readable diagnostic for why auto-trading is/isn't firing right now.
   *
   * Surfaced in the UI next to the existing "Auto-exec" indicator so the
   * operator can see at a glance which gate is the current blocker — no
   * more "I turned it on but nothing happened". The order below is roughly
   * "most-likely-to-be-the-problem" first, so the first matching reason
   * is the most informative diagnosis.
   */
  const autoExecStatus = useMemo<{
    label: string
    tone: 'red' | 'amber' | 'sky' | 'emerald'
  }>(() => {
    if (!autoExecuteSwaps) return { label: 'Off', tone: 'red' }
    if (tradingHalted) return { label: 'Blocked — kill switch ON', tone: 'red' }
    if (dexAutomationPaused) return { label: 'Paused — resume to re-arm', tone: 'amber' }
    if (usePersonalWallet && !personalWalletReady)
      return { label: 'Loading personal wallet…', tone: 'amber' }
    if (!effectiveConnected)
      return {
        label: usePersonalWallet ? 'Personal wallet not ready' : 'Wallet not connected',
        tone: 'red',
      }
    if (effectiveWrongChain) return { label: 'Wrong network (switch to BSC)', tone: 'red' }
    if (!effectiveAddress) return { label: 'Wallet address missing', tone: 'red' }
    if (prices.length < minWarmup)
      return {
        label: `Warming up ${prices.length}/${minWarmup} samples`,
        tone: 'amber',
      }
    if (!buyGatesOk) {
      const bad = buyChecks.find((c) => !c.pass)
      return { label: `Blocked — ${bad?.label ?? 'pre-trade check failed'}`, tone: 'amber' }
    }
    if (inPosition) {
      return signal === 'SELL'
        ? { label: 'In position — armed for auto SELL on signal', tone: 'sky' }
        : { label: 'In position — TP/SL & SELL watcher active', tone: 'sky' }
    }
    if (signal !== 'BUY')
      return { label: `Armed — waiting for BUY signal (now ${signal})`, tone: 'sky' }
    const cooldownLeft = AUTO_EXEC_COOLDOWN_MS - (Date.now() - lastAutoExecAtRef.current)
    if (cooldownLeft > 0)
      return {
        label: `Armed — cooldown ${Math.ceil(cooldownLeft / 1000)}s`,
        tone: 'sky',
      }
    if (dexBusyRef.current) return { label: 'Submitting trade…', tone: 'emerald' }
    return { label: 'Armed & ready — firing on next tick', tone: 'emerald' }
  }, [
    autoExecuteSwaps,
    tradingHalted,
    dexAutomationPaused,
    usePersonalWallet,
    personalWalletReady,
    effectiveConnected,
    effectiveWrongChain,
    effectiveAddress,
    prices.length,
    minWarmup,
    buyGatesOk,
    buyChecks,
    inPosition,
    signal,
  ])

  const flowEstimate = sessionStats ? estimatedSessionFlowUsdt(sessionStats) : 0

  return (
    <div className="space-y-6 max-w-6xl">
      <Card className="overflow-hidden border-emerald-500/30 bg-gradient-to-br from-emerald-950/35 via-[#0a0c12] to-[#101320] shadow-[0_0_40px_rgba(16,185,129,0.12)]">
        <CardContent className="pt-6 pb-6">
          <p className="text-[10px] font-mono text-emerald-400 tracking-widest mb-2">// DEX TRADING · BSC · PANCAKE V2</p>
        <h1 className="text-3xl md:text-4xl font-bold text-white font-mono tracking-tight">
            DEX Trading Terminal
        </h1>
        </CardContent>
      </Card>

      {false && <Card className="pb-panel border-emerald-500/35">
        <CardHeader className="pb-2">
          <CardTitle className="text-emerald-100 font-mono text-sm">0 · Why balances are $0</CardTitle>
        </CardHeader>
        <CardContent className="font-mono text-xs text-gray-400 space-y-2">
          <p>
            Funds live in <strong className="text-white">your wallet</strong>, not on koie.fin. Send <strong className="text-white">USDT (BEP-20)</strong> and a little <strong className="text-white">BNB</strong> for gas to this address on BSC — then refresh below.
          </p>
          <Button asChild variant="outline" size="sm" className="border-emerald-500/40 text-emerald-300 font-mono">
            <Link href="/dashboard#fund">Full funding guide</Link>
          </Button>
        </CardContent>
      </Card>}

      {false && <Card className="border-red-500/35 bg-red-950/20 backdrop-blur-sm">
        <CardHeader className="pb-2">
          <CardTitle className="text-red-300/90 text-base font-mono">Risk disclosure</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-red-200/80 leading-relaxed space-y-2 font-mono">
          <p>
            Digital asset trading is highly volatile and can result in <strong className="text-white">total loss of capital</strong>.
            This bot provides <strong className="text-white">signals and tooling only</strong> — not investment advice, not a profit
            guarantee, and <strong className="text-white">no outcome is assured</strong>. Past performance does not
            predict future results. You alone decide to sign transactions; protocol, smart-contract, and bridge risks apply.
          </p>
          <p className="text-red-200/80">
            koie.fin does not underwrite your trades or absorb losses. Use risk limits below and only funds you can afford to
            lose.
          </p>
        </CardContent>
      </Card>}

      <Card className="pb-panel border-white/10 bg-[#0b0d13]/90 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
        <CardHeader>
          <CardTitle className="text-emerald-100 font-mono text-base tracking-tight">1. Connect wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!clientMounted ? (
            <div className="min-h-[52px] rounded-md border border-white/10 bg-white/[0.03]" aria-busy aria-label="Loading wallet status" />
          ) : !effectiveConnected ? (
            <DexWalletPicker
              connectors={connectors}
              connectPending={connectPending}
              onConnect={(c) =>
                connect(
                  { connector: c },
                  {
                    onError(err) {
                      toast.error(err.message ?? 'Could not connect wallet')
                    },
                  },
                )
              }
            />
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <span className="text-sm text-gray-400 font-mono">
                {usePersonalExecution ? personalWalletAddress : address}
              </span>
              {!usePersonalExecution ? (
              <Button variant="outline" size="sm" onClick={() => disconnect()}>
                Disconnect
              </Button>
              ) : null}
            </div>
          )}
          {clientMounted && !usePersonalExecution && wrongChain && (
            <Button type="button" disabled={switchPending} onClick={() => switchChain?.({ chainId: BSC_CHAIN_ID })}>
              {switchPending ? 'Switching…' : 'Switch to BNB Smart Chain'}
            </Button>
          )}
        </CardContent>
      </Card>

      {false && <Card className="border-blue-500/25 bg-blue-950/15 pb-panel">
        <CardHeader className="pb-2">
          <CardTitle className="text-blue-200/90 font-mono text-base tracking-tight">Hyperliquid & other venues</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 font-mono text-xs text-gray-400 leading-relaxed">
          <p>
            <strong className="text-white">Hyperliquid</strong> is a separate perps exchange (its own stack + wallet flow), not BSC
            Pancake swaps. To trade there, open the official app and connect the wallet they support (often via their own connect UI
            and Arbitrum USDC flows).
          </p>
          <div className="flex flex-wrap gap-2">
            <Button asChild variant="outline" size="sm" className="border-blue-500/40 text-blue-200 font-mono">
              <a href="https://app.hyperliquid.xyz" target="_blank" rel="noreferrer">
                Open Hyperliquid →
              </a>
            </Button>
            <Button asChild variant="ghost" size="sm" className="text-gray-500 font-mono">
              <a href="https://hyperliquid.gitbook.io/hyperliquid-docs" target="_blank" rel="noreferrer">
                Docs
              </a>
            </Button>
          </div>
          <p className="text-[11px] text-gray-600">
            This koie.fin terminal keeps <strong className="text-gray-400">BSC + Pancake</strong> execution here; we do not embed Hyperliquid
            trading. Use the link above for HL perps.
          </p>
        </CardContent>
      </Card>}

      <Card className="pb-panel border-white/10 bg-[#0b0d13]/90 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
        <CardHeader>
          <CardTitle className="text-emerald-100 font-mono text-base tracking-tight">2. Balances (BSC)</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-300 space-y-1">
          <p>
            BNB <span className="text-gray-600">(gas)</span>:{' '}
            <span className="text-white font-mono">
              {usePersonalExecution
                ? personalBnbGasBalance > 0n
                  ? formatEther(personalBnbGasBalance)
                  : '—'
                : bnbNative
                ? formatEther(bnbNative.value)
                : chainId === bsc.id
                ? '—'
                : 'Switch to BSC'}
            </span>
          </p>
          <p>
            USDT:{' '}
            <span className="text-white font-mono">
              {effectiveUsdtBal !== null ? formatUnits(effectiveUsdtBal, 18) : '—'}
            </span>
          </p>
          <p>
            {tokenSymbol}{tokenSymbol === 'BNB' ? ' (WBNB on-chain)' : ''}:{' '}
            <span className="text-white font-mono">
              {effectiveTokenBal !== null ? formatUnits(effectiveTokenBal, tokenDecimals) : '—'}
            </span>
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-2 px-0"
            onClick={() => {
              if (usePersonalExecution) {
                void refreshPersonalWalletStatus()
              } else {
                void refreshBalances()
              }
            }}
          >
            Refresh
          </Button>
        </CardContent>
      </Card>

      {usePersonalExecution && dexSuggestions?.enabled && dexSuggestions.items.length > 0 ? (
        <Card className="pb-panel border-violet-500/20 bg-violet-950/10">
          <CardHeader>
            <CardTitle className="text-violet-100 font-mono text-base tracking-tight">
              Ideas from your balance
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            <p className="text-xs text-gray-400">
              Spare USDT (wallet):{' '}
              <span className="text-white font-mono">{dexSuggestions.usdtFree.toFixed(2)}</span>
            </p>
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full text-left text-xs font-mono">
                <thead className="bg-black/30 text-gray-500">
                  <tr>
                    <th className="p-2">Token</th>
                    <th className="p-2">24h %</th>
                    <th className="p-2">In wallet $</th>
                    <th className="p-2">Stance</th>
                  </tr>
                </thead>
                <tbody>
                  {dexSuggestions.items.map((row) => (
                    <tr key={row.symbol} className="border-t border-white/5">
                      <td className="p-2 text-white">{row.symbol}</td>
                      <td className="p-2">
                        {row.change24hPct != null && Number.isFinite(row.change24hPct)
                          ? `${row.change24hPct >= 0 ? '+' : ''}${row.change24hPct.toFixed(2)}%`
                          : '—'}
                      </td>
                      <td className="p-2 text-gray-300">${row.walletUsd.toFixed(2)}</td>
                      <td className="p-2 text-gray-300 capitalize">{row.stance.replace(/_/g, ' ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <Card className="pb-panel border-white/10 bg-[#0b0d13]/90 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
        <CardHeader>
          <CardTitle className="text-emerald-100 font-mono text-base tracking-tight">3. Risk controls</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          <p className="text-xs text-emerald-300/80 font-mono">
            Safe mode defaults are preloaded for real-funds validation (small size, strict loss caps, fewer entries/day).
          </p>
          <div>
            <label className="block text-gray-400 mb-1">Strategy mode (reference price signals)</label>
            <select
              className="w-full max-w-md rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white font-mono"
              value={dexStrategyMode}
              onChange={(e) => setDexStrategyMode(e.target.value as DexStrategyMode)}
            >
              <option value="trend_rsi">Trend + RSI — price vs SMA with optional RSI filter</option>
              <option value="ma_cross">MA crossover — fast vs slow SMA cross (classic golden/death style)</option>
              <option value="scalping">Scalping-style — tighter distance + RSI bands</option>
            </select>
            <p className="text-[11px] text-gray-500 mt-1">
              Indicative only (Binance spot as proxy for BSC). Not investment advice — see{' '}
              <a
                href="https://www.ig.com/en-ch/trading-strategies/the-5-crypto-trading-strategies-that-every-trader-needs-to-know-221123"
                className="underline text-emerald-400/90"
                target="_blank"
                rel="noreferrer"
              >
                IG overview of common strategy types
              </a>
              .
            </p>
          </div>
          {dexStrategyMode === 'ma_cross' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label className="block text-gray-400 mb-1">Fast SMA (samples)</label>
                <Input
                  type="number"
                  min={2}
                  max={30}
                  value={fastSmaPeriod}
                  onChange={(e) => {
                    const f = Math.max(2, Math.min(30, parseInt(e.target.value, 10) || 5))
                    setFastSmaPeriod(f)
                    if (f >= slowSmaPeriod) setSlowSmaPeriod(Math.min(80, f + 1))
                  }}
                  className="pb-input"
                />
              </div>
              <div>
                <label className="block text-gray-400 mb-1">Slow SMA (samples)</label>
                <Input
                  type="number"
                  min={5}
                  max={80}
                  value={slowSmaPeriod}
                  onChange={(e) => {
                    const s = Math.max(5, Math.min(80, parseInt(e.target.value, 10) || 21))
                    setSlowSmaPeriod(s)
                    if (s <= fastSmaPeriod) setFastSmaPeriod(Math.max(2, s - 2))
                  }}
                  className="pb-input"
                />
              </div>
            </div>
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-gray-400 mb-1">Max USDT per trade</label>
              <Input
                value={maxUsdtPerTradeCap}
                onChange={(e) => setMaxUsdtPerTradeCap(e.target.value)}
                className="pb-input"
              />
            </div>
            <div>
              <label className="block text-gray-400 mb-1">Max estimated daily loss (USDT)</label>
              <Input
                value={maxDailyLossUsdt}
                onChange={(e) => setMaxDailyLossUsdt(e.target.value)}
                className="pb-input"
              />
              <p className="text-xs text-gray-500 mt-1">Blocks new buys when session flow ≤ this loss (see §6).</p>
            </div>
            <div>
              <label className="block text-gray-400 mb-1">Slippage tolerance (%)</label>
              <Input
                value={slippagePercent}
                onChange={(e) => setSlippagePercent(e.target.value)}
                className="pb-input"
              />
            </div>
            <div>
              <label className="block text-gray-400 mb-1">
                SMA period (samples){dexStrategyMode === 'ma_cross' ? ' — unused in MA cross mode' : ''}
              </label>
              <Input
                type="number"
                min={5}
                max={60}
                value={smaPeriod}
                onChange={(e) => setSmaPeriod(Math.max(5, Math.min(60, parseInt(e.target.value, 10) || 20)))}
                className="pb-input"
                disabled={dexStrategyMode === 'ma_cross'}
              />
            </div>
          </div>
          <div>
            <label className="block text-gray-400 mb-1">Signal threshold (% away from SMA)</label>
            <Input
              value={signalThreshold}
              onChange={(e) => setSignalThreshold(e.target.value)}
              className="max-w-xs pb-input"
            />
            <p className="text-xs text-gray-500 mt-1">
              Default <strong>0.08%</strong>. Raise (e.g. 0.20%) to filter out micro-moves and trade only
              strong trends; lower (e.g. 0.04%) to react sooner. Above 0.30% on majors will rarely
              fire — that&apos;s the &quot;everything stays HOLD&quot; bug that used to ship by default.
            </p>
          </div>
          <label className="flex items-center gap-2 text-gray-400">
            <input
              type="checkbox"
              checked={useRsiFilter}
              onChange={(e) => setUseRsiFilter(e.target.checked)}
            />
            Use RSI filter (reduces entries when momentum is extended)
          </label>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <label className="block text-gray-400 mb-1">Fear &amp; Greed max for buys (0–100)</label>
              <Input
                value={fearGreedBuyMax}
                onChange={(e) => setFearGreedBuyMax(e.target.value)}
                className="pb-input"
              />
              <p className="text-xs text-gray-500 mt-1">Blocks buys in extreme greed (API: alternative.me).</p>
            </div>
            <div>
              <label className="block text-gray-400 mb-1">Max buys / session day</label>
              <Input
                value={maxBuysPerDay}
                onChange={(e) => setMaxBuysPerDay(e.target.value)}
                className="pb-input"
              />
            </div>
          </div>
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-3">
            <label className="flex items-start gap-2 text-zinc-200">
              <input
                type="checkbox"
                className="mt-1"
                checked={scaleInWhileBuyEnabled}
                onChange={(e) => setScaleInWhileBuyEnabled(e.target.checked)}
              />
              <span>
                <strong className="text-white">Scale-in while BUY (DCA)</strong> — while the signal stays{' '}
                <strong className="text-white">BUY</strong> and you hold the token, repeat{' '}
                <strong className="text-white">strategy-sized</strong> buys on a timer (first slice can be auto-edge BUY or manual). Respects max buys/session, cooldown, pause/kill switch, and the same pre-trade gates.
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <label className="block text-gray-400 mb-1">Minutes between scale-in BUYs</label>
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={scaleInIntervalMinutes}
                  onChange={(e) => setScaleInIntervalMinutes(e.target.value)}
                  className="pb-input"
                  disabled={!scaleInWhileBuyEnabled}
                />
              </div>
              <div>
                <label className="block text-gray-400 mb-1">Max extra BUYs per BUY streak</label>
                <Input
                  type="number"
                  min={0}
                  max={50}
                  value={scaleInMaxAdds}
                  onChange={(e) => setScaleInMaxAdds(e.target.value)}
                  className="pb-input"
                  disabled={!scaleInWhileBuyEnabled}
                />
                <p className="text-xs text-gray-500 mt-1">0 disables additions. First entry is still the normal signal-edge BUY.</p>
              </div>
            </div>
            {scaleInWhileBuyEnabled && (
              <p className="text-xs font-mono text-zinc-400">
                {nextScaleInEtaSec === null
                  ? 'Countdown arms when signal is BUY, position is open, and auto gates are ready.'
                  : `Next scale-in BUY in ${formatCountdown(nextScaleInEtaSec)} (${scaleInAddsUsedDisplay}/${Math.max(0, Math.min(50, parseInt(scaleInMaxAdds, 10) || 0))} extras used)`}
              </p>
            )}
          </div>

          {/* Take-profit / stop-loss controls. Locks gains without waiting for
              the SMA to flip SELL — fixes the "trade closed at break-even
              after fees" pattern. */}
          <div className="rounded-lg border border-white/10 bg-white/[0.03] p-3 space-y-3">
            <label className="flex items-start gap-2 text-zinc-200">
              <input
                type="checkbox"
                className="mt-1"
                checked={tpSlEnabled}
                onChange={(e) => setTpSlEnabled(e.target.checked)}
              />
              <span>
                <strong className="text-white">Take-profit / Stop-loss</strong> — auto-SELL based on % move from your fill price. <strong className="text-white">Locks winners</strong> when price hits TP, <strong className="text-white">caps losers</strong> when price hits SL. Independent of the SMA signal so each round-trip has a defined upside and a known max loss.
              </span>
            </label>
            <div className="grid gap-3 sm:grid-cols-2 text-sm">
              <div>
                <label className="block text-gray-400 mb-1">Take-profit (%)</label>
                <Input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={takeProfitPct}
                  onChange={(e) => setTakeProfitPct(e.target.value)}
                  className="pb-input"
                  disabled={!tpSlEnabled}
                />
                <p className="text-xs text-gray-500 mt-1">Auto-sell when price ≥ entry × (1 + TP%). Set above 2× gas-as-pct of your trade size.</p>
              </div>
              <div>
                <label className="block text-gray-400 mb-1">Stop-loss (%)</label>
                <Input
                  type="number"
                  min={0.1}
                  step={0.1}
                  value={stopLossPct}
                  onChange={(e) => setStopLossPct(e.target.value)}
                  className="pb-input"
                  disabled={!tpSlEnabled}
                />
                <p className="text-xs text-gray-500 mt-1">
                  Fixed mode: auto-sell when price ≤ entry × (1 − SL%). Trailing mode: auto-sell
                  when price ≤ peak × (1 − SL%). Tighter = more whipsaw exits; looser = larger max
                  loss per trade.
                </p>
              </div>
            </div>

            {/*
              Trailing stop toggle. Off by default so existing users see no
              behaviour change. When on, the stop level "ratchets up" with
              every new peak — winners that retrace lock in some profit
              instead of having to fall all the way back to entry − SL%.
              Strictly tighter than fixed SL in profit; identical in losses.
            */}
            <label className="flex items-start gap-2 text-zinc-200">
              <input
                type="checkbox"
                className="mt-1"
                checked={trailingStopEnabled}
                onChange={(e) => setTrailingStopEnabled(e.target.checked)}
                disabled={!tpSlEnabled}
              />
              <span className="text-sm">
                <strong className="text-white">Trailing stop</strong> — the stop level
                <strong className="text-white"> follows the highest price</strong> seen since
                entry (instead of staying at entry − SL%). Locks in profit on winning trades that
                retrace. <span className="text-emerald-300/90">Recommended</span> for trending
                pairs.
              </span>
            </label>

            {tpSlEnabled && (
              <p className="text-xs font-mono text-zinc-400">
                {inPosition && dexEntryPrice !== null && dexEntryPrice > 0 ? (
                  <>
                    Entry: <span className="text-zinc-200">{dexEntryPrice.toLocaleString(undefined, { maximumFractionDigits: 8 })}</span>{' '}
                    ·{' '}
                    {dexUnrealizedPct !== null ? (
                      <span className={dexUnrealizedPct >= 0 ? 'text-emerald-300' : 'text-red-300'}>
                        {dexUnrealizedPct >= 0 ? '+' : ''}
                        {dexUnrealizedPct.toFixed(2)}%
                      </span>
                    ) : (
                      'Tracking…'
                    )}
                    {trailingStopEnabled && dexTrailingPeak !== null && dexTrailingPeak > 0 ? (
                      <>
                        {' · '}Peak:{' '}
                        <span className="text-zinc-200">
                          {dexTrailingPeak.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                        </span>
                        {(() => {
                          // Surface the live trailing stop level so the operator can
                          // see exactly where the auto-sell would fire on the next
                          // adverse tick. We recompute here (vs. carrying another
                          // state value) because it's a pure function of two state
                          // values already in scope — cheap and avoids one more
                          // setState per tick.
                          const sl = parseFloat(stopLossPct)
                          if (!Number.isFinite(sl) || sl <= 0) return null
                          const stopLevel = dexTrailingPeak * (1 - sl / 100)
                          return (
                            <>
                              {' · '}Stop:{' '}
                              <span className="text-amber-300">
                                {stopLevel.toLocaleString(undefined, { maximumFractionDigits: 8 })}
                              </span>
                            </>
                          )
                        })()}
                      </>
                    ) : null}
                  </>
                ) : (
                  'TP/SL arms after your next BUY fill — wait for an entry, then this row shows live unrealized %.'
                )}
              </p>
            )}
          </div>

          <label className="flex items-center gap-2 text-emerald-300/90">
            <input
              type="checkbox"
              checked={tradingHalted}
              onChange={(e) => setTradingHalted(e.target.checked)}
            />
            Kill switch — halt all swaps (emergency)
          </label>
          <label className="flex items-center gap-2 text-gray-400">
            <input
              type="checkbox"
              checked={telegramEnabled}
              onChange={(e) => setTelegramEnabled(e.target.checked)}
            />
            Telegram alerts for this terminal (requires login + linked bot in Settings → Telegram; uses your chat, not a shared webhook)
          </label>
          {circuitTripped && (
            <p className="text-emerald-400 text-sm font-medium font-mono">
              Circuit: daily loss limit hit — buys disabled until you reset session stats or adjust limits.
            </p>
          )}
        </CardContent>
      </Card>

      <Card className="pb-panel border-white/10 bg-[#0b0d13]/90 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
        <CardHeader>
          <CardTitle className="text-emerald-100 font-mono text-base tracking-tight">
            4. Pick a coin to trade on PancakeSwap
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-gray-400">
            All swaps route through WBNB on PancakeSwap V2. Switching here updates the chart, signals, balances and BUY/SELL paths in lock-step.
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="block text-gray-400 mb-1 text-xs">Strategy scouting chain</label>
              <select
                className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                value={scoutChain}
                onChange={(e) => setScoutChain(e.target.value as DexScoutChain)}
              >
                <option value="bsc">BSC</option>
                <option value="base">Base</option>
                <option value="arbitrum">Arbitrum</option>
                <option value="polygon">Polygon</option>
              </select>
            </div>
            <div>
              <label className="block text-gray-400 mb-1 text-xs">Strategy venue target</label>
              <select
                className="w-full rounded-md border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                value={scoutVenue}
                onChange={(e) => setScoutVenue(e.target.value as DexScoutVenue)}
              >
                <option value="auto">Auto</option>
                <option value="pancakeswap">PancakeSwap</option>
                <option value="uniswap">Uniswap</option>
              </select>
            </div>
          </div>
          <CoinSelector
            options={BSC_TOKENS.map<CoinSelectorOption>((t) => ({
              pairKey: t.symbol,
              binanceSymbol: t.binanceSymbol,
              label: t.label,
              logo: t.logo,
              glyph: t.symbol.slice(0, 1),
            }))}
            value={selectedToken.symbol}
            onChange={handleSelectToken}
          />
          <p className="text-[11px] text-gray-500">
            Active path: <span className="text-emerald-300">{selectedToken.symbol === 'BNB' ? 'USDT ⇄ WBNB' : `USDT ⇄ WBNB ⇄ ${selectedToken.symbol}`}</span>
            {' · contract '}
            <code className="text-gray-400">{selectedToken.address.slice(0, 10)}…{selectedToken.address.slice(-6)}</code>
          </p>
          <div className="rounded-md border border-white/10 bg-black/30 p-3 text-xs">
            <p className="text-gray-400">
              AI focus suggestion:{' '}
              <span className="text-white">
                {focusHintBusy
                  ? 'Updating...'
                  : focusHint
                    ? `${focusHint.signal} · ref ${focusHint.refPrice.toFixed(4)} · buy ${focusHint.buyRef.toFixed(4)} · sell ${focusHint.sellRef.toFixed(4)}`
                    : 'Unavailable'}
              </span>
            </p>
            {focusHint ? <p className="mt-1 text-gray-500">{focusHint.text}</p> : null}
          </div>
        </CardContent>
      </Card>

      <LiveCandle
        symbol={selectedToken.binanceSymbol}
        pairLabel={`${selectedToken.symbol}/USDT`}
      />

      <Card className="pb-panel border-white/10 bg-[#0b0d13]/90 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
        <CardHeader>
          <CardTitle className="text-emerald-100 font-mono text-base tracking-tight">5. Strategy signal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-white/[0.03] p-3">
            <Button
              type="button"
              size="sm"
              variant={dexAutomationPaused ? 'default' : 'destructive'}
              className={
                dexAutomationPaused
                  ? 'bg-emerald-600 hover:bg-emerald-500 text-white font-mono'
                  : 'font-mono'
              }
              onClick={() => {
                if (dexAutomationPaused) {
                  setDexAutomationPaused(false)
                  void pushDexTelegram({ kind: 'automation_resume', detail: 'DEX automatic trading resumed from the terminal.' })
                  toast.success('Automatic trading resumed.')
                } else {
                  setDexAutomationPaused(true)
                  void pushDexTelegram({ kind: 'automation_pause', detail: 'DEX automatic trading paused from the terminal.' })
                  toast.info('Automatic trading paused — manual BUY/SELL still available unless kill switch is on.')
                }
              }}
            >
              {dexAutomationPaused ? 'Resume automatic trading' : 'Pause automatic trading'}
            </Button>
          </div>
          <TradingViewEmbed symbol={selectedToken.tradingViewSymbol} height={360} />
          <div className="flex flex-wrap gap-4 text-sm">
            <span className="text-gray-400">
              BNB/USDT:{' '}
              <span className="text-white font-mono">{lastPrice !== null ? lastPrice.toFixed(2) : '…'}</span>
            </span>
            {smaDisplay !== null && (
              <span className="text-gray-400">
                SMA: <span className="text-white font-mono">{smaDisplay.toFixed(2)}</span>
              </span>
            )}
            {rsiDisplay !== null && (
              <span className="text-gray-400">
                RSI(14): <span className="text-white font-mono">{rsiDisplay.toFixed(1)}</span>
              </span>
            )}
            <span className="text-gray-400">
              Signal:{' '}
              <span
                className={
                  signal === 'BUY'
                    ? 'text-green-400'
                    : signal === 'SELL'
                      ? 'text-red-400'
                      : 'text-gray-300'
                }
              >
                {prices.length < minWarmup ? `Warming up (${prices.length}/${minWarmup})` : signal}
              </span>
            </span>
            <span className="text-gray-400">
              Toasts:{' '}
              <span className="text-white">{botRunning ? 'On' : 'Off'}</span>
            </span>
            <span className="text-gray-400">
              Auto-exec:{' '}
              <span className={autoExecuteSwaps ? 'text-sky-300' : 'text-white'}>
                {dexAutomationPaused
                  ? 'Paused'
                  : autoExecuteSwaps
                    ? usePersonalExecution
                      ? 'On (personal wallet auto-sign)'
                      : delegateStatus?.enabled && delegateStatus?.hotWalletConfigured
                        ? 'On (delegated auto-sign)'
                        : 'On (wallet prompts)'
                    : 'Off'}
              </span>
            </span>
            {/*
              Live diagnostic for why auto-trading is / isn't firing right
              now. Surfaced inline with the other status chips so the
              operator never has to wonder "I turned it on, why nothing?"
              — every blocking gate (warmup, signal, wallet, cooldown)
              names itself here. See `autoExecStatus` for the logic.
            */}
            {autoExecuteSwaps && (
              <span className="text-gray-400">
                Status:{' '}
                <span
                  className={
                    autoExecStatus.tone === 'red'
                      ? 'text-rose-400 font-mono'
                      : autoExecStatus.tone === 'amber'
                        ? 'text-amber-300 font-mono'
                        : autoExecStatus.tone === 'sky'
                          ? 'text-sky-300 font-mono'
                          : 'text-emerald-400 font-mono'
                  }
                >
                  {autoExecStatus.label}
                </span>
              </span>
            )}
            <span className="text-gray-400">
              F&amp;G:{' '}
              <span className="text-white font-mono">{fearGreed !== null ? fearGreed : '…'}</span>
            </span>
            {openSignal && (
              <span className="text-gray-400">
                Open-source consensus:{' '}
                <span
                  className={
                    openSignal.consensus.signal === 'BUY'
                      ? 'text-emerald-400 font-mono'
                      : openSignal.consensus.signal === 'SELL'
                        ? 'text-red-400 font-mono'
                        : 'text-gray-300 font-mono'
                  }
                >
                  {openSignal.consensus.signal} ({Math.round(openSignal.consensus.confidence * 100)}%)
                </span>
              </span>
            )}
            <span className="text-gray-400">
              Delegated auto-sign:{' '}
              <span
                className={
                  delegateStatus?.enabled && delegateStatus?.hotWalletConfigured
                    ? 'text-emerald-400 font-mono'
                    : 'text-gray-300 font-mono'
                }
              >
                {delegateStatus?.enabled && delegateStatus?.hotWalletConfigured ? 'On' : 'Off'}
              </span>
            </span>
          </div>
          <label className="flex items-center gap-2 text-sm text-gray-400">
            <input type="checkbox" checked={botRunning} onChange={(e) => setBotRunning(e.target.checked)} />
            Toast on BUY/SELL transitions (notifications only)
          </label>
          <label className="flex items-start gap-2 text-sm text-emerald-200/90">
            <input type="checkbox" className="mt-1" checked={autoExecuteSwaps} disabled />
            <span>
              <strong className="text-white">Auto-execute strategy swaps</strong> — when the signal crosses into BUY or SELL, this
              page submits the same transactions as the buttons below. With a{' '}
              <strong className="text-white">personal wallet</strong> or <strong className="text-white">delegated hot wallet</strong>, swaps are signed server-side with no popups; otherwise MetaMask (etc.) asks you to{' '}
              <strong className="text-white">sign each approve and each swap</strong>. USDT approval is the standard Pancake router allowance (not a deposit to koie.fin).
            </span>
          </label>
          <p className="text-xs font-mono text-emerald-300/80">
            Investor policy: execution automation is enforced in this terminal.
          </p>
          {delegateStatus?.enabled && delegateStatus?.hotWalletConfigured && (
            <p className="text-xs font-mono text-emerald-300/80">
              DEX fix active: auto BUY/SELL uses delegated server signing (wallet popups are skipped), remaining delegated budget:{' '}
              {typeof delegateStatus.remainingBuyUsdt === 'number'
                ? `${delegateStatus.remainingBuyUsdt.toFixed(2)} USDT`
                : '—'}
            </p>
          )}
          <EnhancedSignalsPanel symbol={selectedToken.binanceSymbol} showMultiLeaderboard />

          <div className="rounded-lg border border-white/10 bg-white/5 p-3">
            <p className="text-[11px] uppercase tracking-widest text-zinc-500">Open-source signal providers</p>
            {openSignalError ? (
              <p className="mt-2 text-xs text-zinc-400">Provider update pending: {openSignalError}</p>
            ) : !openSignal ? (
              <p className="mt-2 text-xs text-zinc-400">Loading provider signals...</p>
            ) : (
              <div className="mt-2 space-y-2 text-xs">
                <p className="text-zinc-400">
                  {openSignal.symbol} consensus: <span className="text-white">{openSignal.consensus.signal}</span> ({Math.round(openSignal.consensus.confidence * 100)}%)
                </p>
                <p className="text-zinc-500">
                  BUY {openSignal.consensus.counts.buy} · SELL {openSignal.consensus.counts.sell} · HOLD {openSignal.consensus.counts.hold}
                </p>
                {openSignal.providers.map((provider) => (
                  <div key={provider.id} className="rounded-md bg-white/5 px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-white">{provider.name}</span>
                      <span
                        className={
                          provider.signal === 'BUY'
                            ? 'text-emerald-400'
                            : provider.signal === 'SELL'
                              ? 'text-red-400'
                              : 'text-zinc-300'
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
            )}
          </div>
        </CardContent>
      </Card>

      <Card className="pb-panel border-white/10 bg-[#0b0d13]/90 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
        <CardHeader>
          <CardTitle className="text-emerald-100 font-mono text-base tracking-tight">6. Pre-flight checks</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <p className="text-xs text-gray-500 font-mono mb-2">Strategy BUY (all gates)</p>
            <ul className="space-y-1.5 text-sm font-mono">
              {buyChecks.map((c) => (
                <li key={c.id} className="space-y-1 border-b border-white/5 pb-1.5">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="text-gray-400">{c.label}</span>
                    <span
                      className={
                        !clientMounted ? 'text-zinc-500' : c.pass ? 'text-emerald-400' : 'text-red-400'
                      }
                    >
                      {clientMounted ? (c.pass ? 'PASS' : 'FAIL') : '—'}
                    </span>
                  </div>
                  {clientMounted && c.detail ? <p className="text-[11px] text-gray-500">{c.detail}</p> : null}
                </li>
              ))}
            </ul>
          </div>
          <div>
            <p className="text-xs text-gray-500 font-mono mb-2">Manual BUY (wallet safety only — use when you just want to swap)</p>
            <ul className="space-y-1.5 text-sm font-mono">
              {manualBuyChecks.map((c) => (
                <li key={`m-${c.id}`} className="space-y-1 border-b border-white/5 pb-1.5">
                  <div className="flex flex-wrap justify-between gap-2">
                    <span className="text-gray-400">{c.label}</span>
                    <span
                      className={
                        !clientMounted ? 'text-zinc-500' : c.pass ? 'text-emerald-400' : 'text-red-400'
                      }
                    >
                      {clientMounted ? (c.pass ? 'PASS' : 'FAIL') : '—'}
                    </span>
                  </div>
                  {clientMounted && c.detail ? <p className="text-[11px] text-gray-500">{c.detail}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        </CardContent>
      </Card>

      <Card className="pb-panel border-white/10 bg-[#0b0d13]/90 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
        <CardHeader>
          <CardTitle className="text-emerald-100 font-mono text-base tracking-tight">7. Session estimate</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-gray-300 space-y-2">
          <>
              <p>
                Buys (USDT notional):{' '}
                <span className="text-white font-mono">{sessionStats.buysUsdtTotal.toFixed(2)}</span> ({sessionStats.buyCount}{' '}
                swaps)
              </p>
              <p>
                Sells (USDT quoted out):{' '}
                <span className="text-white font-mono">{sessionStats.sellsUsdtTotal.toFixed(2)}</span> ({sessionStats.sellCount}{' '}
                swaps)
              </p>
              <p>
                Net flow (sell quotes − buy notionals):{' '}
                <span className={flowEstimate >= 0 ? 'text-green-400 font-mono' : 'text-red-400 font-mono'}>
                  {flowEstimate.toFixed(2)} USDT
                </span>
              </p>
              <p className="text-xs text-gray-500">
                Indicative only — not tax, accounting, or guaranteed P&amp;L; actual fills may differ from quotes.
              </p>
              <Button type="button" variant="outline" size="sm" onClick={() => {
                resetDexSession()
                setSessionStats(loadDexSession())
                toast.success('Session stats reset')
              }}>
                Reset session stats
              </Button>
          </>
        </CardContent>
      </Card>

      <Card className="pb-panel border-emerald-500/30">
        <CardHeader>
          <CardTitle className="text-emerald-100 font-mono text-base tracking-tight">
            8. Execution mode
          </CardTitle>
          <p className="text-xs text-gray-400 mt-1">
            Choose how trades are signed. Personal Wallet eliminates MetaMask popups for every trade —
            ideal for hands-off automated trading.
          </p>
        </CardHeader>
        <CardContent className="space-y-3">
          <label
            className={`flex items-start gap-3 rounded-lg border px-4 py-3 cursor-pointer transition ${
              usePersonalWallet ? 'border-emerald-500/60 bg-emerald-500/5' : 'border-white/10 bg-white/[0.02]'
            }`}
          >
            <input
              type="checkbox"
              className="mt-1"
              checked={usePersonalWallet}
              onChange={(e) => setUsePersonalWallet(e.target.checked)}
              disabled={!personalWalletReady}
            />
            <div className="flex-1">
              <p className="text-sm text-white">Use my Personal Wallet for trades</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {personalWalletReady
                  ? `Server signs swaps from ${personalWalletAddress?.slice(0, 6)}…${personalWalletAddress?.slice(-4)} — no MetaMask prompts. Set up in `
                  : 'Set up your personal wallet first in '}
                <Link href="/wallet" className="text-emerald-300 underline">/wallet</Link>.
              </p>
            </div>
          </label>
          {usePersonalWallet && !personalWalletReady ? (
            <p className="text-xs text-zinc-400">Personal wallet setup is pending. Wallet signing remains available.</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="pb-panel border-white/10 bg-[#0b0d13]/90 shadow-[0_8px_30px_rgba(0,0,0,0.25)]">
        <CardHeader>
          <CardTitle className="text-emerald-100 font-mono text-base tracking-tight">9. Execute swap</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">USDT per BUY (BEP-20)</label>
            <Input
              value={usdtPerTrade}
              onChange={(e) => setUsdtPerTrade(e.target.value)}
              className="max-w-xs pb-input"
            />
          </div>

          {/*
            Small-trade friction warning.

            This is the answer to "why are all my $5 trades closing at $0
            realized?" — gas + LP fees (round-trip) are roughly fixed in
            absolute terms (~$0.10 gas + ~$0.025 LP fee per hop × 2 ×
            round-trip), so on a $5 trade they swallow 3–6% before the
            strategy even gets a chance to express edge. We surface this
            BEFORE the swap so users size up (or stop blaming the bot).

            Math we display:
              gas       ≈ $0.12  (BSC swap, both BUY and SELL legs)
              LP fee    ≈ 0.50% round-trip with best-path routing (was
                          1.00% before the routing fix — half came from
                          the redundant WBNB hop)
              spread    ≈ 0.05–0.15% per pool, ~0.20% round-trip
                          (already absorbed in slippage tolerance)
              ⇒ baseline round-trip friction ≈ $0.25 + ~0.7% of notional.
          */}
          {(() => {
            const trade = parseFloat(usdtPerTrade)
            if (!Number.isFinite(trade) || trade <= 0) return null
            // BSC swap gas: ~0.0003 BNB × ~$600/BNB ≈ $0.18 per leg, both
            // legs of a round-trip total ~$0.36. We round down to $0.30
            // as a conservative-but-honest floor.
            const roundTripGasUsd = 0.3
            const lpAndSpreadPct = 0.7 // round-trip best-path estimate
            const dollarFee = roundTripGasUsd + (trade * lpAndSpreadPct) / 100
            const totalFrictionPct = (dollarFee / trade) * 100
            if (totalFrictionPct < 2) return null // Healthy size — no need to warn.
            const severity =
              totalFrictionPct >= 5
                ? 'rose'
                : totalFrictionPct >= 3
                  ? 'amber'
                  : 'sky'
            const palette =
              severity === 'rose'
                ? 'border-rose-500/40 bg-rose-500/10 text-rose-200'
                : severity === 'amber'
                  ? 'border-amber-500/40 bg-amber-500/10 text-amber-200'
                  : 'border-sky-500/40 bg-sky-500/10 text-sky-200'
            return (
              <p
                className={`text-xs leading-relaxed rounded-md border px-3 py-2 ${palette}`}
              >
                <strong>Trade size note:</strong> at <strong>${trade.toFixed(2)}</strong>{' '}
                per BUY, baseline round-trip friction (gas + LP fees) is roughly{' '}
                <strong>${dollarFee.toFixed(2)}</strong> ≈{' '}
                <strong>{totalFrictionPct.toFixed(1)}%</strong> of your trade size.{' '}
                {severity === 'rose'
                  ? 'The strategy needs to capture more than this just to break even, which is why small trades often close at $0.00 realized. Recommend ≥ $20 per BUY.'
                  : severity === 'amber'
                    ? 'Profitable trades will leave a thin margin; consider ≥ $20 per BUY for clearer outcomes.'
                    : 'Friction is acceptable but tight. Larger trades show edge more cleanly.'}
              </p>
            )
          })()}

          <TradeAdvisor
            symbol={selectedToken.binanceSymbol}
            side="BUY"
            sizeUsdt={parseFloat(usdtPerTrade) || 0}
            onAdvisoryChange={setTradeAdvisory}
          />

          {/* Primary "Quick Buy" CTA — instant, friction-free swap. Skips
              warmup, signal direction, advisor, and circuit gates. The only
              checks left are real wallet-safety: connected, BSC chain,
              positive amount, sufficient USDT balance, kill switch off. */}
          <Button
            type="button"
            disabled={
              !effectiveConnected ||
              effectiveWrongChain ||
              writePending ||
              !manualBuyGatesOk
            }
            onClick={() => executeBuy('manual')}
            className="w-full justify-center bg-emerald-500 text-emerald-950 hover:bg-emerald-400 font-mono text-base font-bold tracking-wide py-6"
            title="Quick Buy is a discretionary, instant swap. Skips strategy gates, advisor, and warmup."
          >
            {writePending
              ? 'Confirm in wallet…'
              : `Quick buy ${parseFloat(usdtPerTrade) || 0} USDT → ${tokenSymbol}`}
          </Button>
          <p className="text-[11px] text-emerald-300/80 -mt-2">
            Quick Buy bypasses all strategy gates — fires the swap immediately at your discretion.
          </p>

          <div className="flex flex-wrap gap-2 pt-2 border-t border-zinc-800/60">
            <Button
              type="button"
              variant="secondary"
              disabled={usePersonalExecution || !isConnected || wrongChain || writePending}
              onClick={() => preApproveUsdtForRouter()}
            >
              Pre-approve USDT (router)
            </Button>
            <Button
              type="button"
              // Strategy BUY button is now permissive: only real wallet-safety,
              // an active BUY signal, and warmup gate the click. Advisor BLOCK
              // and daily-loss circuit are informational under the operator's
              // AI-automation profile.
              disabled={
                !effectiveConnected ||
                effectiveWrongChain ||
                writePending ||
                !buyGatesOk ||
                signal !== 'BUY' ||
                prices.length < minWarmup
              }
              onClick={() => executeBuy('strategy')}
              title={
                tradeAdvisory?.decision === 'block'
                  ? 'Advisor flagged caution — proceeding will fire the strategy BUY anyway (informational only).'
                  : undefined
              }
            >
              {writePending ? 'Wallet…' : `Strategy BUY: USDT → ${tokenSymbol}`}
            </Button>
            <Button
              type="button"
              variant="outline"
              // Manual BUY is "user-at-their-discretion": only wallet-safety
              // gates apply. It deliberately ignores the daily-loss circuit,
              // trade advisor, and strategy gates so the operator can swap
              // when their own conviction overrides the model.
              disabled={
                !effectiveConnected ||
                effectiveWrongChain ||
                writePending ||
                !manualBuyGatesOk
              }
              onClick={() => executeBuy('manual')}
              title={
                circuitTripped
                  ? 'Daily loss circuit is tripped — Manual BUY proceeds anyway at your discretion.'
                  : tradeAdvisory?.decision === 'block'
                  ? 'Advisor recommends against buying right now — Manual BUY proceeds anyway at your discretion.'
                  : undefined
              }
            >
              Manual BUY (skip strategy gates)
            </Button>
            <Button
              type="button"
              variant="outline"
              className="border-red-500/40 text-red-400"
              disabled={!effectiveConnected || effectiveWrongChain || writePending || tradingHalted || !effectiveTokenBal || effectiveTokenBal === 0n}
              onClick={() => executeSell()}
            >
              SELL: {tokenSymbol} → USDT (full balance)
            </Button>
          </div>
          <div className="space-y-2 text-xs text-gray-300">
            {strategyBuyDisabled && strategyBuyDisabledExplanation ? (
              <p className="text-amber-200/90 font-mono">{strategyBuyDisabledExplanation}</p>
            ) : null}
            {manualBuyGateBlockReason && !manualBuyGatesOk && (
              <p className="text-emerald-300">Manual BUY / Quick Buy status: {manualBuyGateBlockReason}</p>
            )}
            {tradingHalted && (
              <p className="text-zinc-300">Trading pause is active. Resume to execute swaps.</p>
            )}
            {(!effectiveTokenBal || effectiveTokenBal === 0n) && (
              <p className="text-zinc-300">{tokenSymbol} balance is currently 0 for SELL.</p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
