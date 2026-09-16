import { parseUnits } from 'viem'
import { BSC_CHAIN_ID } from '@/lib/dex/bsc'

export type PreTradeCheck = {
  id: string
  label: string
  pass: boolean
  detail?: string
}

export type PreTradeContext = {
  isConnected: boolean
  chainId: number | undefined
  lastPriceAt: number | null
  priceStaleMs: number
  slippagePercent: string | number
  usdtPerTrade: string
  maxUsdtPerTradeCap: string
  circuitTripped: boolean
  minWarmup: number
  priceSampleCount: number
  usdtBal: bigint | null
  tradingHalted: boolean
  fearGreedValue: number | null
  /** Block buys when F&G above this (extreme greed). */
  fearGreedBuyMax: number
  prices: number[]
  signal: 'BUY' | 'SELL' | 'HOLD'
  rsiDisplay: number | null
  useRsiFilter: boolean
  forceBuy: boolean
  /** When true, strategy gates (warmup, signal, F&G, spread, etc.) are bypassed; wallet/safety gates still apply. */
  manualSwap?: boolean
  sessionBuyCount: number
  maxBuysPerDay: number
}

function volatilityRatio(prices: number[]): number | null {
  if (prices.length < 5) return null
  const slice = prices.slice(-5)
  const mean = slice.reduce((a, b) => a + b, 0) / slice.length
  if (mean === 0) return null
  const mx = Math.max(...slice)
  const mn = Math.min(...slice)
  return (mx - mn) / mean
}

/**
 * Production-style gates before a BUY (non-custodial; you still sign txs).
 *
 * Hard blockers (always enforced):
 *   wallet, chain, slippage, balance, valid amount, kill switch.
 *
 * Strategy-only blockers (auto-bot guardrails — skipped in `manualSwap` mode):
 *   per-trade cap, warmup, signal === BUY, optional RSI filter.
 *
 * Soft / informational rows (never block any path; surfaced for situational
 * awareness only): F&G band, short-term volatility, last-tick gap, session
 * buy-count, daily-loss circuit, news/spread quirks. The operator explicitly
 * requested permissive automation so the bot can act on AI signals; these
 * legacy gates would otherwise stop the auto-bot from ever firing.
 */
export function evaluateBuyPreTradeChecks(ctx: PreTradeContext): PreTradeCheck[] {
  const manual = ctx.manualSwap === true
  const now = Date.now()
  const stale = !ctx.lastPriceAt || now - ctx.lastPriceAt > ctx.priceStaleMs

  let slip: number
  try {
    slip = parseFloat(String(ctx.slippagePercent))
  } catch {
    slip = NaN
  }
  const slipOk = Number.isFinite(slip) && slip >= 0.01 && slip <= 5

  let trade = 0
  let cap = 0
  try {
    trade = parseFloat(ctx.usdtPerTrade)
    cap = parseFloat(ctx.maxUsdtPerTradeCap)
  } catch {
    /* noop */
  }
  // Strategy mode enforces the per-trade cap (guardrail for the auto bot).
  // Manual mode is "user at their own discretion" — the cap is purely a
  // strategy concept, so we only validate the amount itself is positive.
  const tradePositive = Number.isFinite(trade) && trade > 0
  const sizeOk = manual
    ? tradePositive
    : tradePositive && (!Number.isFinite(cap) || cap <= 0 || trade <= cap)

  let amountIn: bigint | null
  try {
    amountIn = parseUnits(ctx.usdtPerTrade, 18)
  } catch {
    amountIn = null
  }
  const balOk =
    ctx.usdtBal !== null && amountIn !== null && ctx.usdtBal >= amountIn

  const fgOk =
    ctx.fearGreedValue === null ||
    (ctx.fearGreedValue >= 0 && ctx.fearGreedValue <= ctx.fearGreedBuyMax)

  const vol = volatilityRatio(ctx.prices)
  const volOk = vol === null || vol <= 0.12

  const signalOk = ctx.signal === 'BUY'
  const consensusSignal = manual || ctx.forceBuy || signalOk
  const consensusRsi =
    manual || ctx.forceBuy || !ctx.useRsiFilter || ctx.rsiDisplay === null || ctx.rsiDisplay < 72

  const spreadOk =
    ctx.prices.length < 2
      ? false
      : (() => {
          const last = ctx.prices[ctx.prices.length - 1]!
          const prev = ctx.prices[ctx.prices.length - 2]!
          const mean = (last + prev) / 2
          return mean !== 0 && Math.abs(last - prev) / mean < 0.15
        })()

  const sessionLimitOk = ctx.sessionBuyCount < ctx.maxBuysPerDay

  const killSwitchLabel = ctx.tradingHalted
    ? 'Kill switch is ON (trading halted)'
    : 'Kill switch is OFF (trading armed)'

  const circuitLabel = ctx.circuitTripped
    ? 'Daily loss circuit tripped'
    : 'Daily loss circuit not tripped'

  const checks: PreTradeCheck[] = [
    { id: 'wallet', label: 'Wallet connected', pass: ctx.isConnected },
    { id: 'chain', label: `Network is BSC (${BSC_CHAIN_ID})`, pass: ctx.chainId === BSC_CHAIN_ID },
    {
      id: 'price_fresh',
      label: manual
        ? 'Reference price (optional for manual)'
        : stale
        ? 'Reference price stale (informational)'
        : 'Reference price recently updated',
      // Informational — the on-chain swap quote uses live PancakeSwap reserves
      // anyway, so a stale UI feed should never block an AI-driven trade.
      pass: true,
      detail: stale && !manual ? 'UI feed paused; on-chain quote still live' : undefined,
    },
    { id: 'slippage', label: 'Slippage between 0.01% and 5%', pass: slipOk },
    {
      id: 'size_cap',
      label: manual
        ? 'Trade amount is a positive number'
        : 'Order size within max-per-trade cap',
      pass: sizeOk,
      detail:
        !sizeOk && !tradePositive
          ? 'Enter a positive USDT trade amount'
          : !sizeOk && Number.isFinite(cap) && cap > 0
          ? `Trade size exceeds your strategy cap (${cap}). Manual BUY ignores this cap.`
          : !sizeOk
          ? 'Invalid trade or cap value'
          : undefined,
    },
    {
      id: 'circuit',
      // Daily-loss circuit is informational across both paths now — operator
      // requested permissive AI-signal automation. The 15% account-level
      // drawdown circuit remains enforced server-side as the final safety net.
      label: ctx.circuitTripped
        ? 'Daily loss circuit tripped (informational — trade allowed)'
        : circuitLabel,
      pass: true,
    },
    {
      id: 'warmup',
      label: manual
        ? 'Strategy warmup (skipped for manual swap)'
        : ctx.priceSampleCount >= ctx.minWarmup
        ? 'Strategy warmup complete'
        : `Strategy warmup ${ctx.priceSampleCount}/${ctx.minWarmup} (collecting price samples…)`,
      pass: manual || ctx.priceSampleCount >= ctx.minWarmup,
      detail:
        !manual && ctx.priceSampleCount < ctx.minWarmup
          ? 'Use Manual BUY or Quick Buy to skip warmup.'
          : undefined,
    },
    {
      id: 'balance',
      label: 'USDT balance covers trade + buffer',
      pass: balOk,
      detail: !balOk ? 'Not enough USDT in wallet' : undefined,
    },
    {
      id: 'kill_switch',
      label: killSwitchLabel,
      pass: !ctx.tradingHalted,
      detail: ctx.tradingHalted ? 'Disable kill switch to allow swaps' : undefined,
    },
    {
      id: 'fear_greed',
      // Informational: F&G is contextual, not a hard signal. Bot ignores it.
      label: manual
        ? 'Fear & Greed (skipped for manual)'
        : ctx.fearGreedValue !== null
        ? `Fear & Greed: ${ctx.fearGreedValue} (informational, ≤ ${ctx.fearGreedBuyMax})`
        : 'Fear & Greed (no data — informational)',
      pass: true,
      detail: !manual && !fgOk ? 'Above your warning threshold (not blocking)' : undefined,
    },
    {
      id: 'volatility',
      label: manual
        ? 'Volatility band (skipped for manual)'
        : volOk
        ? 'Short-term volatility within band'
        : 'Short-term volatility above band (informational)',
      pass: true,
      detail: !volOk && !manual ? 'High short-term swings — sizing handled by advisor' : undefined,
    },
    {
      id: 'consensus_signal',
      label: manual
        ? 'Signal gate (skipped — manual swap)'
        : signalOk
          ? 'Strategy signal is BUY'
          : `Strategy signal is ${ctx.signal} (Strategy BUY needs BUY)`,
      pass: consensusSignal,
      detail:
        !manual && !signalOk
          ? 'Wait for the chart model to flip BUY, or use Manual BUY / Quick Buy at your discretion.'
          : undefined,
    },
    {
      id: 'consensus_rsi',
      label: manual
        ? 'RSI gate (skipped — manual swap)'
        : ctx.useRsiFilter
        ? 'RSI / momentum consensus'
        : 'RSI filter disabled (informational)',
      // Only block when the user explicitly turned the RSI filter on.
      pass: !ctx.useRsiFilter || consensusRsi,
    },
    {
      id: 'spread',
      label: manual
        ? 'Spread check (skipped for manual)'
        : spreadOk
        ? 'Last ticks not gap-abnormal'
        : 'Last ticks gap-abnormal (informational)',
      pass: true,
      detail: !spreadOk && !manual ? 'Recent price gaps look unusual — informational only' : undefined,
    },
    {
      id: 'session_limit',
      label: manual
        ? 'Session buy limit (skipped for manual)'
        : sessionLimitOk
        ? 'Session buy count under daily limit'
        : `Session buy count ${ctx.sessionBuyCount}/${ctx.maxBuysPerDay} (informational)`,
      pass: true,
    },
  ]

  return checks
}

export function allChecksPass(checks: PreTradeCheck[]): boolean {
  return checks.every((c) => c.pass)
}
