/**
 * On-chain DEX signals — indicative only, not investment advice.
 * Uses spot reference price (CEX ticker) as a proxy for BNB/USD momentum.
 *
 * Strategy modes map loosely to common retail concepts (trend / MA cross / RSI / scalping);
 * see e.g. IG Bank educational material on MA, RSI, scalping, DCA (not CFD-specific).
 */

export type DexSignal = 'BUY' | 'SELL' | 'HOLD'

/** Simple moving average over the last `period` closes (inclusive). */
export function sma(closes: number[], period: number): number | null {
  if (closes.length < period) return null
  const slice = closes.slice(-period)
  return slice.reduce((a, b) => a + b, 0) / period
}

/**
 * Wilder RSI (14) from closing prices. Needs at least period + 1 samples.
 */
export function rsi(closes: number[], period = 14): number | null {
  if (closes.length < period + 1) return null
  let gains = 0
  let losses = 0
  for (let i = closes.length - period; i < closes.length; i++) {
    const delta = closes[i]! - closes[i - 1]!
    if (delta >= 0) gains += delta
    else losses -= delta
  }
  const avgGain = gains / period
  const avgLoss = losses / period
  if (avgLoss === 0) return avgGain === 0 ? 50 : 100
  const rs = avgGain / avgLoss
  return 100 - 100 / (1 + rs)
}

/** How the DEX page combines momentum, MA cross, and RSI filters. */
export type DexStrategyMode = 'trend_rsi' | 'ma_cross' | 'scalping'

export type SignalOptions = {
  mode: DexStrategyMode
  /** SMA lookback in samples (each sample = one price tick). */
  smaPeriod: number
  /** Fast / slow MA for `ma_cross` (samples). */
  fastSmaPeriod: number
  slowSmaPeriod: number
  /** Fractional distance from SMA to trigger signal, e.g. 0.0015 = 0.15%. */
  threshold: number
  /** When true, block BUY when RSI suggests overbought. */
  useRsiFilter: boolean
  rsiBuyMax: number
  rsiSellMin: number
}

function maCrossSignal(
  closes: number[],
  fast: number,
  slow: number,
  rsiValue: number | null,
  useRsiFilter: boolean,
  rsiBuyMax: number,
  rsiSellMin: number,
): DexSignal {
  if (closes.length < slow + 2) return 'HOLD'
  const prev = closes.slice(0, -1)
  const fNow = sma(closes, fast)
  const sNow = sma(closes, slow)
  const fPrev = sma(prev, fast)
  const sPrev = sma(prev, slow)
  if (fNow == null || sNow == null || fPrev == null || sPrev == null) return 'HOLD'
  let signal: DexSignal = 'HOLD'
  if (fPrev <= sPrev && fNow > sNow) signal = 'BUY'
  else if (fPrev >= sPrev && fNow < sNow) signal = 'SELL'
  if (useRsiFilter && rsiValue !== null) {
    if (signal === 'BUY' && rsiValue >= rsiBuyMax) return 'HOLD'
    if (signal === 'SELL' && rsiValue <= rsiSellMin) return 'HOLD'
  }
  return signal
}

export function computeDexSignal(
  closes: number[],
  opts: SignalOptions,
): { signal: DexSignal; smaValue: number | null; rsiValue: number | null } {
  const {
    mode,
    smaPeriod,
    fastSmaPeriod,
    slowSmaPeriod,
    threshold,
    useRsiFilter,
    rsiBuyMax,
    rsiSellMin,
  } = opts

  const rsiValue = rsi(closes, 14)
  const thr =
    mode === 'scalping' ? threshold * 0.65 : mode === 'ma_cross' ? threshold * 0.85 : threshold
  const rsiBuy = mode === 'scalping' ? Math.min(78, rsiBuyMax + 4) : rsiBuyMax
  const rsiSell = mode === 'scalping' ? Math.max(22, rsiSellMin - 4) : rsiSellMin

  if (mode === 'ma_cross') {
    const sig = maCrossSignal(closes, fastSmaPeriod, slowSmaPeriod, rsiValue, useRsiFilter, rsiBuy, rsiSell)
    const smaValue = sma(closes, slowSmaPeriod)
    return { signal: sig, smaValue, rsiValue }
  }

  const smaValue = sma(closes, smaPeriod)
  if (smaValue === null || closes.length === 0) {
    return { signal: 'HOLD', smaValue: null, rsiValue }
  }

  const last = closes[closes.length - 1]!
  const diff = (last - smaValue) / smaValue

  let signal: DexSignal = 'HOLD'
  if (diff > thr) {
    if (!useRsiFilter || rsiValue === null || rsiValue < rsiBuy) signal = 'BUY'
    else signal = 'HOLD'
  } else if (diff < -thr) {
    if (!useRsiFilter || rsiValue === null || rsiValue > rsiSell) signal = 'SELL'
    else signal = 'HOLD'
  }

  return { signal, smaValue, rsiValue }
}
