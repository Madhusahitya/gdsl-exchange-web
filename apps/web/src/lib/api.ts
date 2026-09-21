import axios from 'axios'
import { AUTH_GUARD_ENABLED } from './authGuard'
import { getApiBaseUrl } from './apiBaseUrl'

const api = axios.create({
  baseURL: getApiBaseUrl(),
  headers: { 'Content-Type': 'application/json' },
  withCredentials: true,
  timeout: 28_000,
})

function getCookie(name: string): string | null {
  if (typeof window === 'undefined') return null
  // Prefer last match when duplicates exist.
  let value: string | null = null
  for (const part of document.cookie.split('; ')) {
    if (!part.startsWith(`${name}=`)) continue
    value = part.slice(name.length + 1)
  }
  return value
}

function hasReadableSessionHint(): boolean {
  // cf_csrf is the only auth cookie readable from JS; if missing, a proactive
  // refresh will only produce noise / logout storms.
  return Boolean(getCookie('cf_csrf'))
}

api.interceptors.request.use((config) => {
  if (typeof window !== 'undefined') {
    config.baseURL = getApiBaseUrl()
  }
  const method = String(config.method ?? 'get').toUpperCase()
  if (!['GET', 'HEAD', 'OPTIONS'].includes(method)) {
    const csrf = getCookie('cf_csrf')
    if (csrf) {
      config.headers['x-csrf-token'] = csrf
    }
  }
  return config
})

// Coalesce concurrent refresh attempts. If 20 parallel requests all see a
// 401 at once we must NOT fire 20 refreshes (each one rotates the refresh
// token / session row server-side and the late ones would log the user out).
let refreshInFlight: Promise<void> | null = null
let hardLogoutInFlight: Promise<void> | null = null

function doRefreshOnce(): Promise<void> {
  if (refreshInFlight) return refreshInFlight
  refreshInFlight = (async () => {
    try {
      await axios.post(
        `${getApiBaseUrl()}/api/auth/refresh`,
        {},
        {
          withCredentials: true,
          headers: { 'x-csrf-token': getCookie('cf_csrf') || '' },
        },
      )
    } finally {
      // Allow a new refresh after the current cycle completes (success OR
      // failure — successive 401s after a hard logout get their own attempt).
      setTimeout(() => {
        refreshInFlight = null
      }, 1500)
    }
  })()
  return refreshInFlight
}

async function hardLogoutOnce(): Promise<void> {
  if (hardLogoutInFlight) return hardLogoutInFlight
  hardLogoutInFlight = (async () => {
    try {
      await axios.post(`${getApiBaseUrl()}/api/auth/logout`, {}, { withCredentials: true })
    } catch {
      // ignore — cookies may already be cleared server-side on failed refresh
    }
    if (typeof window !== 'undefined' && !window.location.pathname.startsWith('/login')) {
      window.location.href = '/login'
    }
  })()
  return hardLogoutInFlight
}

api.interceptors.response.use(
  (res) => res,
  async (error) => {
    if (!AUTH_GUARD_ENABLED) {
      return Promise.reject(error)
    }
    const original = error.config || {}
    // Never auto-refresh / auto-redirect for the public auth endpoints — they own
    // their own 401/403 semantics (bad password, unverified email, expired OTP …).
    const url: string = original.url || ''
    const isAuthEndpoint = /\/api\/auth\/(login|register|verify-email|resend-otp|refresh|logout)\b/.test(url)
    if (isAuthEndpoint) {
      return Promise.reject(error)
    }

    const status: number | undefined = error.response?.status
    // Transient infra errors (429 rate limit, 502/503/504 from nginx/upstream
    // restarts) must NOT log the user out — that was the "random logout"
    // symptom reported on the demo droplet. Treat them as retryable network
    // blips and let the caller decide. The next user interaction will retry.
    const isTransient =
      status === 429 ||
      status === 502 ||
      status === 503 ||
      status === 504 ||
      error.code === 'ECONNABORTED' ||
      error.code === 'ERR_NETWORK'
    if (isTransient) {
      return Promise.reject(error)
    }

    if ((status === 401 || status === 403) && !original._retry) {
      original._retry = true
      try {
        await doRefreshOnce()
        return api(original)
      } catch (refreshErr) {
        // Only force a hard logout when the refresh itself returns an
        // **authentication** failure (cookie expired/revoked). Anything else
        // (server-side 429, 502, network timeout) leaves the session intact
        // so a brief outage doesn't kick everyone to /login.
        const refreshStatus = (refreshErr as { response?: { status?: number } } | undefined)
          ?.response?.status
        // Only 401 means the session is dead. 403 on refresh is often CSRF /
        // CORS misconfig — do NOT kick the user to /login for that.
        const refreshIsAuthFailure = refreshStatus === 401
        if (refreshIsAuthFailure) {
          // Sibling-tab race: wait briefly and retry once before kicking out.
          await new Promise((r) => setTimeout(r, 900))
          try {
            await doRefreshOnce()
            return api(original)
          } catch {
            await hardLogoutOnce()
          }
        }
      }
    }
    return Promise.reject(error)
  }
)

export default api

let lastEnsureAt = 0
const ENSURE_MIN_GAP_MS = 5 * 60_000

/**
 * Soft session keep-alive. Prefers /api/auth/me (no rotation). Only rotates
 * refresh when access is actually expired. Throttled so focus spam can't
 * multi-rotate and log the user out.
 */
export async function ensureAuthSession(): Promise<boolean> {
  if (typeof window !== 'undefined' && !hasReadableSessionHint()) {
    return false
  }
  const now = Date.now()
  if (now - lastEnsureAt < ENSURE_MIN_GAP_MS) {
    return true
  }
  try {
    await api.get('/api/auth/me')
    lastEnsureAt = Date.now()
    return true
  } catch (err) {
    const status = (err as { response?: { status?: number } } | undefined)?.response?.status
    if (status !== 401) return false
    try {
      await doRefreshOnce()
      lastEnsureAt = Date.now()
      return true
    } catch {
      return false
    }
  }
}

/** Clears cached `/api/auth/me` (call after logout paths that clear cookies). */
export function invalidateAuthMeCache() {
  authMeCache = null
}

let authMeCache: { data: unknown; at: number } | null = null
const AUTH_ME_TTL_MS = 8000

export const auth = {
  /**
   * `identifier` may be either an email address or a username — the API
   * dispatches based on whether it contains `@`.
   */
  login: async (identifier: string, password: string) => {
    const response = await api.post('/api/auth/login', { identifier, password })
    invalidateAuthMeCache()
    return response.data
  },
  register: async (email: string, password: string) => {
    const response = await api.post('/api/auth/register', { email, password })
    invalidateAuthMeCache()
    return response.data
  },
  /** Public config (unauthenticated). Returns `{ registrationOpen, appName }`. */
  config: async () => {
    const response = await api.get('/api/auth/config')
    return response.data as { registrationOpen: boolean; appName: string }
  },
  verifyEmail: async (email: string, code: string) => {
    const response = await api.post('/api/auth/verify-email', { email, code })
    invalidateAuthMeCache()
    return response.data
  },
  resendOtp: async (email: string) => {
    const response = await api.post('/api/auth/resend-otp', { email })
    return response.data
  },
  logout: async () => {
    const response = await api.post('/api/auth/logout', {})
    invalidateAuthMeCache()
    return response.data
  },
  me: async () => {
    const now = Date.now()
    if (authMeCache && now - authMeCache.at < AUTH_ME_TTL_MS) {
      return authMeCache.data
    }
    const data = (await api.get('/api/auth/me')).data
    authMeCache = { data, at: now }
    return data
  },
}

export const support = {
  contact: async (payload: { subject: string; message: string; email?: string }) =>
    (await api.post('/api/support/contact', payload)).data as Promise<{ ok: true; id: string }>,
}

export const portfolio = {
  get: async () => (await api.get('/api/portfolio')).data,
}

export const trades = {
  list: async (params?: { status?: string; pair?: string; page?: number; limit?: number }) =>
    (await api.get('/api/trades', { params, timeout: 20_000 })).data,
  get: async (id: string) => (await api.get(`/api/trades/${id}`)).data,
  logExecution: async (payload: {
    pair: string
    side: 'BUY' | 'SELL'
    entryPrice: number
    allocationUsd?: number
    pnl?: number
    exitPrice?: number
  }) =>
    (await api.post('/api/trades/log-execution', payload)).data as Promise<{
      id: string
      pair: string
      side: 'BUY' | 'SELL'
      status: 'OPEN' | 'CLOSED' | 'CANCELLED'
    }>,
}

export const bot = {
  start: async (
    strategyId: string,
    pair = 'BTC/USDT',
    opts?: { mode?: 'wallet' | 'live'; orderSizeUsdt?: number; tradeSizePct?: number }
  ) =>
    (await api.post('/api/bot/start', {
      strategyId,
      pair,
      mode: opts?.mode ?? 'live',
      orderSizeUsdt: opts?.orderSizeUsdt,
      tradeSizePct: opts?.tradeSizePct,
    })).data,
  stop: async () => (await api.post('/api/bot/stop')).data,
  status: async () => (await api.get('/api/bot/status')).data,
}

export type SignalDirection = 'BUY' | 'SELL' | 'HOLD'

export type SignalProvider = {
  id: string
  name: string
  sourceUrl: string
  signal: SignalDirection
  confidence: number
  note?: string
  features?: Record<string, unknown> | null
  weight?: number
}

export type AdvisorySeverity = 'info' | 'warning' | 'block'

export type AdvisoryReason = {
  code: string
  severity: AdvisorySeverity
  message: string
  source: string
  sourceUrl?: string
}

export type TradeAdvisory = {
  symbol: string
  side: 'BUY' | 'SELL'
  decision: 'ok' | 'caution' | 'block'
  allow: boolean
  highestSeverity: AdvisorySeverity
  reasons: AdvisoryReason[]
  projectedWorstCaseLossUsdt: number | null
  expectedAdverseMovePct: number | null
  recommendedSizeUsdt: number
  capitalCapPct: number
  cooldownSecs: number
  evaluatedAt: string
  snapshot: EnhancedSignalSnapshot
}

export type EnhancedSignalSnapshot = {
  symbol: string
  updatedAt: string
  providerCount: number
  consensus: {
    signal: SignalDirection
    confidence: number
    counts: { buy: number; sell: number; hold: number }
  }
  providers: SignalProvider[]
  recommendation: {
    action: SignalDirection
    sizingPct: number
    sizingLabel: 'avoid' | 'small' | 'moderate' | 'aggressive'
    rationale: string[]
    riskNotes: string[]
    invest: 'yes' | 'wait' | 'no'
    capitalFraction: number
  }
  market: {
    lastPrice: number | null
    change24hPct: number | null
    volume24hUsd: number | null
    high24h: number | null
    low24h: number | null
  }
}

export type MarketTimeframeRead = {
  interval: string
  bars: number
  close: number | null
  ema20: number | null
  ema50: number | null
  rsi14: number | null
  macdHist: number | null
  adx: number | null
  changePct: number | null
  bias: 'up' | 'down' | 'flat'
}

/** Multi-timeframe view assembled from the stored candle history. */
export type MarketContext = {
  symbol: string
  updatedAt: string
  available: boolean
  dataQuality: 'deep' | 'partial' | 'thin' | 'none'
  longHorizon: {
    bars: number
    coveredDays: number
    high52w: number
    low52w: number
    pctFromHigh52w: number
    pctFromLow52w: number
    rangePosition: number
    return30dPct: number | null
    return90dPct: number | null
    return365dPct: number | null
    sma50: number | null
    sma200: number | null
    goldenCross: boolean | null
    annualizedVolPct: number | null
    maxDrawdown1yPct: number | null
    trend: 'bull' | 'bear' | 'range'
  } | null
  timeframes: MarketTimeframeRead[]
  alignment: { bullish: number; bearish: number; total: number; score: number }
  regime: 'trending_up' | 'trending_down' | 'choppy' | 'high_volatility' | 'unknown'
  headline: string
  notes: string[]
}

export type ManualDesk = {
  symbol: string
  tradeSymbol: string
  quoteAsset: 'USDT' | 'USDC'
  pair: string
  baseAsset: string
  connectionId: string | null
  readiness: { ready: boolean; blockers: string[] }
  balances: {
    freeUsdt: number
    freeUsdc: number
    freeQuoteUsd: number
    freeBase: number
    error?: string | null
  }
  book: { bid: number | null; ask: number | null; mid: number | null; spreadBps: number | null } | null
  rules: { minQty: number; stepSize: number; minNotional: number } | null
  limits: { maxOrderUsd: number }
  signal: {
    consensus: string
    confidence: number
    technical: { vote: string; confidence: number; reason: string; rsi14: number | null }
    orderBookImbalance: number | null
    change24hPct: number | null
    context: MarketContext | null
  }
  suggestion: {
    action: 'BUY' | 'SELL' | 'WAIT'
    sizeUsd: number
    conviction: number
    reasons: string[]
    cautions: string[]
    entryHint: number | null
    takeProfitHint: number | null
    stopLossHint: number | null
  }
  openPosition: { symbol: string; baseQty: number; entryPrice: number; pnlPct: number | null } | null
  updatedAt: string
}

export type ManualTradeRequest = {
  symbol: string
  side: 'BUY' | 'SELL'
  quoteOrderQty?: number
  quantity?: number
  fraction?: number
  attachExits?: boolean
}

export type ManualPreflight = {
  ok: boolean
  blockers: string[]
  warnings: string[]
  order: {
    symbol: string
    side: 'BUY' | 'SELL'
    quoteOrderQty: number | null
    quantity: number | null
    estPrice: number | null
    estBaseQty: number | null
    estQuoteValue: number | null
    minNotional: number | null
    stepSize: number | null
  }
  signalAlignment: 'with' | 'against' | 'neutral'
}

/** Jupiter manual desk — same shape for the platform wallet and a connected wallet. */
export type JupiterDesk = {
  binanceSymbol: string
  pair: string
  baseSymbol: string
  wallet: {
    source: 'platform' | 'browser'
    address: string | null
    botCanTrade: boolean
    sol: number
    usdc: number
    baseQty: number
  }
  price: { buy: number | null; sell: number | null; spreadBps: number | null }
  profit: {
    breakEvenSellPrice: number | null
    minMoveToBreakEvenPct: number | null
    upsideToBreakEvenPct: number | null
    openEntryPrice: number | null
    estNetPnlUsd: number | null
    entryQuality: 'good' | 'caution' | 'poor' | null
    entryQualityNote: string | null
  }
  exits: {
    takeProfitPct: number
    stopLossPct: number
    takeProfitPrice: number | null
    stopLossPrice: number | null
  }
  context: MarketContext | null
  suggestion: {
    action: 'BUY' | 'SELL' | 'WAIT'
    sizeUsd: number
    conviction: number
    reasons: string[]
    cautions: string[]
  }
  updatedAt: string
}

export type JupiterPreflight = {
  ok: boolean
  blockers: string[]
  warnings: string[]
  profitCase: string | null
  order: {
    side: 'BUY' | 'SELL'
    binanceSymbol: string
    pair: string
    amount: number
    spendSymbol: string
    estPrice: number | null
    estReceive: number | null
    estValueUsd: number | null
    breakEvenSellPrice: number | null
    minMoveToBreakEvenPct: number | null
    spreadBps: number | null
    priceImpactPct: number | null
  }
  signalAlignment: 'with' | 'against' | 'neutral'
}

/** AI engine: signals, logs, positions, metrics (preferred over legacy bot routes) */
export const engine = {
  signal: async () => (await api.get('/api/engine/signal')).data as Promise<{
    signal: string
    confidence: number
    minConfidenceRequired: number | null
    features: Record<string, unknown> | null
    updatedAt: string | null
  }>,
  openSourceSignal: async () =>
    (await api.get('/api/engine/signal/open-source')).data as Promise<{
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
    }>,
  enhancedSignal: async (symbol = 'BTCUSDT') =>
    (await api.get('/api/engine/signal/enhanced', { params: { symbol } })).data as Promise<EnhancedSignalSnapshot>,
  tradeAdvice: async (input: {
    symbol: string
    side: 'BUY' | 'SELL'
    sizeUsdt: number
    accountEquityUsdt?: number | null
  }) =>
    (await api.post('/api/engine/trade-advice', input)).data as Promise<TradeAdvisory>,
  multiSignal: async (symbols?: string[]) =>
    (await api.get('/api/engine/signal/multi', {
      params: { symbols: symbols?.join(',') },
    })).data as Promise<{
      updatedAt: string
      symbols: EnhancedSignalSnapshot[]
      topPicks: Array<{
        symbol: string
        score: number
        action: 'BUY' | 'SELL' | 'HOLD'
        sizingLabel: 'avoid' | 'small' | 'moderate' | 'aggressive'
      }>
    }>,
  signalReadiness: async (symbol = 'BTCUSDT') =>
    (await api.get('/api/engine/signal/readiness', { params: { symbol } })).data as Promise<{
      ok: boolean
      symbol?: string
      minProviderCount: number
      minConsensusConfidence: number
      maxSignalAgeMs: number
      signalAgeMs: number | null
      blockers: string[]
      venue?: { id: string; venueClass: string; label: string; routerModel: string; vsJupiter: string }
      snapshot: {
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
    }>,
  positions: async () =>
    (await api.get('/api/engine/positions')).data as Promise<{
      positions: Array<{
        id: string
        token: string
        pair: string
        entryPrice: number
        currentPrice: number | null
        midPrice?: number | null
        pnlUsd: number | null
        pnlPct: number | null
        status: string
        openedAt: string
      }>
    }>,
  logs: async (limit = 80) =>
    (await api.get('/api/engine/logs', { params: { limit } })).data as Promise<{
      logs: Array<{ id: string; kind: string; message: string; metadata: unknown; createdAt: string }>
    }>,
  metrics: async () =>
    (await api.get('/api/engine/metrics')).data as Promise<{
      totalTrades: number
      winRate: number
      winRatePct: number
      totalPnl: number
      portfolioBookUsd?: number
      realizedPnlLifetime?: number
      unrealizedPnlOpen?: number
      liveAccountValueUsd?: number
      liveSpreadBps?: number | null
      bscGasGwei?: number | null
      estSwapGasBnb?: number | null
      estSwapGasUsd?: number | null
      estSwapGasUnits?: number
      bnbUsdt?: number | null
    }>,
  start: async (
    strategyId: string,
    pair = 'BTC/USDT',
    opts?: {
      mode?: 'wallet' | 'live'
      orderSizeUsdt?: number
      tradeSizePct?: number
      exchangeConnectionId?: string
      pairs?: Array<'BTC/USDT' | 'ETH/USDT' | 'SOL/USDT' | 'DOGE/USDT'>
    }
  ) =>
    (await api.post('/api/engine/start', {
      strategyId,
      pair,
      mode: opts?.mode ?? 'live',
      orderSizeUsdt: opts?.orderSizeUsdt,
      tradeSizePct: opts?.tradeSizePct,
      exchangeConnectionId: opts?.exchangeConnectionId,
      pairs: opts?.pairs,
    })).data,
  stop: async () => (await api.post('/api/engine/stop')).data,
  cexExit: async () =>
    (await api.get('/api/engine/cex-exit')).data as Promise<{
      settings: {
        enabled: boolean
        takeProfitPct: number
        stopLossPct: number
        profitSkim: boolean
        trailingStop: boolean
        trailingActivationPct: number
        trailingDeltaPct: number
      }
      defaults: { takeProfitPct: number; stopLossPct: number; maxOrderUsdt: number }
      note: string
    }>,
  setCexExit: async (body: {
    enabled?: boolean
    takeProfitPct?: number
    stopLossPct?: number
    profitSkim?: boolean
    trailingStop?: boolean
    trailingActivationPct?: number
    trailingDeltaPct?: number
  }) =>
    (await api.put('/api/engine/cex-exit', body)).data as Promise<{
      settings: {
        enabled: boolean
        takeProfitPct: number
        stopLossPct: number
        profitSkim: boolean
        trailingStop: boolean
        trailingActivationPct: number
        trailingDeltaPct: number
      }
    }>,
  /** Retune TP/SL/trailing on the running Auto Binance lot (null clears to global). */
  setCexPositionExitOverrides: async (overrides: {
    takeProfitPct?: number | null
    stopLossPct?: number | null
    trailingStop?: boolean | null
  }) =>
    (await api.put('/api/engine/cex-super-machine/position/exit-overrides', overrides)).data as Promise<{
      updated: boolean
    }>,
  /** Bank the profit slice of the Auto Binance lot into USDT — position keeps running. */
  skimCexPosition: async () =>
    (await api.post('/api/engine/cex-super-machine/position/skim', {}, { timeout: 60_000 })).data as Promise<{
      pair: string
      soldQty: number
      markPrice: number
      pnlPct: number
      skimmedUsdTotal: number
    }>,
  cexSuperMachine: async () => (await api.get('/api/engine/cex-super-machine')).data as Promise<{
    venue: 'binance-cex'
    running: boolean
    settings: {
      enabled: boolean
      exchangeConnectionId: string | null
      watchSymbol: string
      maxTradeUsd: number
      emergencyStop: boolean
    }
    readiness: { ready: boolean; blockers: string[] }
    openPosition: {
      symbol: string
      pair: string
      entryPrice: number
      baseQty: number
      quoteSpent: number
      openedAt: number
      skimmedUsd: number
      takeProfitPct: number | null
      stopLossPct: number | null
      trailingStop: boolean | null
      trailingPeak: number | null
      markPrice: number | null
      pnlPct: number | null
      pnlUsd: number | null
      effectiveTakeProfitPct: number
      effectiveStopLossPct: number
      effectiveTrailingStop: boolean
      effectiveProfitSkim: boolean
      /** USDT a Skim would bank right now (0 when blocked). */
      skimmableUsd: number
      /** Why Skim is unavailable right now, or null when it can run. */
      skimBlockedReason: string | null
      /** Whole lot is under Binance's $5 minimum order — no sell can execute yet. */
      belowMinOrder: boolean
      minSellNotionalUsd: number
    } | null
    lastDecisions: Array<{
      id: string
      action: string
      consensus: number
      symbol: string | null
      reasons: string[]
      timestamp: string
    }>
    note: string
  }>,
  setCexSuperMachine: async (body: {
    enabled?: boolean
    exchangeConnectionId?: string | null
    watchSymbol?: string
    maxTradeUsd?: number
    emergencyStop?: boolean
  }) => (await api.put('/api/engine/cex-super-machine', body)).data,
  cexCouncilStatus: async () =>
    (await api.get('/api/engine/cex-council/status')).data as Promise<{
      venue: 'binance-cex'
      agents: Array<{
        id: string
        label: string
        weight: number
        accuracyPct: number | null
        samples: number
        lastVote: { vote: string; confidence: number; reason: string } | null
      }>
      llmConfigured: boolean
      threshold: number
      lastDecision: CouncilDecision | null
    }>,
  cexCouncilDecisions: async (limit = 40) =>
    (await api.get('/api/engine/cex-council/decisions', { params: { limit } })).data as Promise<{
      decisions: CouncilDecision[]
      venue: 'binance-cex'
    }>,
  orderBook: async (symbol = 'BTCUSDT', limit = 20) =>
    (await api.get('/api/engine/order-book', { params: { symbol, limit } })).data as Promise<{
      symbol: string
      bids: Array<{ price: number; qty: number }>
      asks: Array<{ price: number; qty: number }>
      mid: number | null
      spreadBps: number | null
      obi: number | null
      updatedAt: string
    }>,
  marketBoard: async (limit = 40) =>
    (await api.get('/api/engine/market-board', { params: { limit } })).data as Promise<{
      rows: Array<{
        symbol: string
        lastPrice: number
        priceChangePercent: number
        highPrice: number
        lowPrice: number
        quoteVolume: number
        baseVolume: number
      }>
      updatedAt: string
      cached: boolean
    }>,
  marketContext: async (symbol: string) =>
    (await api.get('/api/engine/market-context', { params: { symbol } })).data as Promise<MarketContext>,
  candleCoverage: async () =>
    (await api.get('/api/engine/candle-coverage')).data as Promise<{
      trackedSymbols: string[]
      backfillRunning: boolean
      series: Array<{ symbol: string; interval: string; bars: number; oldest: string | null; newest: string | null }>
    }>,
  manualDesk: async (symbol: string) =>
    (await api.get('/api/engine/manual/desk', { params: { symbol }, timeout: 25_000 })).data as Promise<ManualDesk>,
  manualPreflight: async (body: ManualTradeRequest) =>
    (await api.post('/api/engine/manual/preflight', body, { timeout: 25_000 })).data as Promise<ManualPreflight>,
  manualTrade: async (body: ManualTradeRequest) =>
    (await api.post('/api/engine/manual/trade', body, { timeout: 40_000 })).data as Promise<{
      ok: true
      orderId: string
      side: 'BUY' | 'SELL'
      pair: string
      filledQty: number
      quoteValue: number
      avgPrice: number | null
      exitsAttached: boolean
      note: string | null
    }>,
}

export const strategies = {
  list: async () => (await api.get('/api/strategies')).data,
}

export const withdraw = {
  create: async (amount: number, walletAddress: string, network: string) =>
    (await api.post('/api/withdraw', { amount, walletAddress, network })).data,
  history: async () => (await api.get('/api/withdraw/history')).data,
}

export const analytics = {
  summary: async (period: '7d' | '30d' | '90d' | 'all' = '30d') =>
    (await api.get('/api/analytics/summary', { params: { period } })).data,
  equityCurve: async (period: '7d' | '30d' | '90d' | 'all' = '30d') =>
    (await api.get('/api/analytics/equity-curve', { params: { period } })).data,
  byStrategy: async (period: '7d' | '30d' | '90d' | 'all' = '30d') =>
    (await api.get('/api/analytics/by-strategy', { params: { period } })).data,
  byPair: async (period: '7d' | '30d' | '90d' | 'all' = '30d') =>
    (await api.get('/api/analytics/by-pair', { params: { period } })).data,
}

export const performance = {
  live:   async () => (await api.get('/api/performance/live')).data,
  models: async () => (await api.get('/api/performance/models')).data,
  recent: async () => (await api.get('/api/performance/recent')).data,
}

export const exchange = {
  listConnections: async () => (await api.get('/api/exchange/connections')).data,
  createConnection: async (payload: { exchange: 'BINANCE'; label?: string; apiKey: string; apiSecret: string }) =>
    (await api.post('/api/exchange/connections', payload)).data,
  testConnection: async (id: string) => (await api.post(`/api/exchange/connections/${id}/test`)).data,
  deactivateConnection: async (id: string) => (await api.delete(`/api/exchange/connections/${id}`)).data,
  /** Public IPv4/IPv6 this API server uses for outbound calls (Binance IP whitelist). */
  outboundIp: async () =>
    (await api.get('/api/exchange/outbound-ip')).data as Promise<{
      ip: string | null
      source?: string
      note?: string
      error?: string
      detail?: string
    }>,
  /** Live Binance spot balances for the connected API key. */
  balances: async (base = 'BTC') =>
    (await api.get('/api/exchange/balances', { params: { base }, timeout: 20_000 })).data as Promise<{
      connected: boolean
      connectionId: string | null
      label: string | null
      quoteTotalUsd: number
      freeUsdt: number
      freeUsdc: number
      freeBase: number
      baseAsset: string
      assets: Array<{ asset: string; free: number; locked: number }>
      error: string | null
      updatedAt: string
    }>,
}

export type TelegramAlertCategory =
  | 'tradeOpened'
  | 'tradeClosed'
  | 'tradeFailed'
  | 'botLifecycle'
  | 'riskEvents'
  | 'advisor'
  | 'dailySummary'
  | 'marketShocks'
  | 'dexAutomation'

export type TelegramPrefs = Record<TelegramAlertCategory, boolean>

export type TelegramLinkInfo = {
  id: string
  isActive: boolean
  username: string | null
  firstName: string | null
  linkedAt: string
  prefs: TelegramPrefs
}

export type TelegramStatus = {
  configured: boolean
  botUsername: string | null
  botVerified?: boolean
  botError?: string | null
  maxLinks: number
  links: TelegramLinkInfo[]
  link: TelegramLinkInfo | null
  categories: Array<{ key: TelegramAlertCategory; label: string; description: string }>
}

export const telegram = {
  status: async () => (await api.get('/api/telegram/status')).data as Promise<TelegramStatus>,
  startLink: async () =>
    (await api.post('/api/telegram/link/start')).data as Promise<{
      ok: boolean
      code: string
      deepLink: string | null
      command: string
      expiresAt: string
      ttlMinutes: number
      error?: string
      message?: string
    }>,
  disconnect: async (linkId?: string) =>
    (await api.post('/api/telegram/link/disconnect', linkId ? { linkId } : {})).data as Promise<{ ok: boolean }>,
  test: async () => (await api.post('/api/telegram/test')).data as Promise<{ ok: boolean; error?: string }>,
  updatePrefs: async (prefs: Partial<TelegramPrefs>) =>
    (await api.post('/api/telegram/preferences', prefs)).data as Promise<{
      ok: boolean
      prefs?: TelegramPrefs
      error?: string
    }>,
}

export type LiveCandle = {
  openTime: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  closeTime: number
}

export const candles = {
  fetch: async (symbol: string, interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' = '1m', limit = 120) =>
    (await api.get(`/api/prices/candles/${symbol}`, { params: { interval, limit } })).data as Promise<{
      symbol: string
      interval: string
      count: number
      updatedAt: string
      candles: LiveCandle[]
    }>,
}

export const wallet = {
  sync: async () => (await api.post('/api/wallet/sync')).data,
  balances: async () => (await api.get('/api/wallet/balances')).data,
  history: async () => (await api.get('/api/wallet/history')).data,
}

/** BSC hot wallet configured via HOT_WALLET_PRIVATE_KEY on the API (never in frontend). */
export const hotWallet = {
  status: async () => (await api.get('/api/hot-wallet/status')).data,
  delegateStatus: async () => (await api.get('/api/hot-wallet/delegate/status')).data,
  delegateSwap: async (payload: { direction: 'buy' | 'sell'; usdtAmount?: number; wbnbAmount?: number }) =>
    (await api.post('/api/hot-wallet/delegate/swap', payload)).data,
}

/** Authenticated: sends to the Telegram chat linked under Settings (not NEXT_PUBLIC server webhook). */
export type DexTelegramNotifyPayload =
  | {
      kind: 'signal'
      symbol: string
      signal: 'BUY' | 'SELL'
      refPrice?: number
      fearGreed?: number
    }
  | {
      kind: 'swap_success'
      side: 'BUY' | 'SELL'
      tokenSymbol: string
      amountIn: string
      expectedOut: string
      txHash: string
      trigger?: 'auto' | 'manual'
    }
  | {
      kind: 'swap_failed'
      message: string
      side?: 'BUY' | 'SELL'
      tokenSymbol?: string
      trigger?: 'auto' | 'manual'
    }
  | { kind: 'automation_pause'; detail?: string }
  | { kind: 'automation_resume'; detail?: string }

export const dex = {
  notify: async (payload: DexTelegramNotifyPayload) =>
    (await api.post('/api/dex/notify', payload)).data as Promise<{ ok: boolean; delivered?: boolean }>,
}

export type DashboardOpenPosition = {
  symbol: string
  pair?: string
  openTradeIds?: string[]
  quantity: number
  avgEntryPrice: number | null
  markPrice: number | null
  binanceRefPrice?: number | null
  strategyBook?: string
  markSource?: 'binance_spot' | 'oneinch_quote' | 'jupiter_quote' | 'wallet_live'
  marketValueUsd: number
  costBasisUsd: number
  unrealizedPnlUsd: number
  unrealizedPnlPct: number | null
  updatedAt: string
  /** Profit already sold to stables via skims while the position stays open. */
  skimmedUsd?: number
}

export type DashboardNewsItem = {
  id: string
  title: string
  url: string
  source: string
  publishedAt: string
  sentimentScore: number
}

export type DashboardSummary = {
  email: string
  referralCode: string | null

  walletBalance: number
  walletChangePercent: number
  walletChangeUsd: number
  cashEquity: number
  equitySource?: 'ledger' | 'personal_wallet_live' | 'browser_wallet_live'
  walletLastSyncedAt?: string
  /** Last 4 hex chars of connected address when equitySource is browser_wallet_live */
  walletBrowserTail?: string | null

  totalDeposits: number
  totalWithdrawals: number
  depositsToday: number
  withdrawalsToday: number
  depositChangePercent: number
  withdrawChangePercent: number

  todayProfit: number
  weekProfit: number
  totalProfit: number
  realizedPnlAllTime: number

  unrealizedPnl: number
  openPositionsMarketValue: number
  openPositionsCostBasis: number
  openPositions: DashboardOpenPosition[]

  tradesToday: number
  winsToday: number
  lossesToday: number
  winRateToday: number
  bestTradeToday: number
  worstTradeToday: number
  /** Mean USD profit per winning trade in today's UTC window. 0 if no wins. */
  avgWinTodayUsd: number
  /** Mean USD loss (positive number) per losing trade today. 0 if no losses. */
  avgLossTodayUsd: number
  /** Expectancy in USD per trade for today: (winRate × avgWin) − (lossRate × avgLoss). */
  expectancyTodayUsd: number
  /** avgWin / avgLoss for today. 0 when no losses yet (denominator undefined). */
  payoffRatioToday: number
  tradesThisWeek: number
  winRateThisWeek: number
  avgWinWeekUsd: number
  avgLossWeekUsd: number
  expectancyWeekUsd: number
  payoffRatioWeek: number
  closedTradesAllTime: number
  openTradesAllTime: number
  lastTradeAt: string | null
  lastTradePnl: number | null
  lastTradePair: string | null

  referralReward: number
  todayRewards: number
  todayReferrals: number
  trialFunds: number
  activePlans: number

  bot: {
    label: string
    hashRateLabel: string
    changePercent: number
    dollarChange: number
    startedAt: string | null
  }

  news: DashboardNewsItem[]
  generatedAt: string
  /** API returned partial fallbacks (RPC timeout, etc.) — numbers may be incomplete. */
  degraded?: boolean
  degradedReasons?: string[]
  dexAutoExit?: {
    enabled: boolean
    takeProfitPct: number
    stopLossPct: number
  }
}

export const dashboard = {
  summary: async (params?: Record<string, string | number | undefined>) => {
    const cleaned =
      params &&
      Object.fromEntries(
        Object.entries(params).filter(([, v]) => v !== undefined && v !== null && String(v) !== ''),
      )
    return (
      await api.get('/api/dashboard/summary', {
        params: cleaned && Object.keys(cleaned).length > 0 ? cleaned : undefined,
        timeout: 45_000,
      })
    ).data as Promise<DashboardSummary>
  },
}

export type PersonalWalletAssetBalance = {
  asset: string
  address: string | null
  amount: number
  amountRaw: string
  usdPrice: number | null
  usdValue: number
  role?: 'gas' | 'wrapped' | 'token'
  displayLabel?: string
  depositHint?: string
}

export type PersonalWalletSummary = {
  address: string
  chainId: number
  enabled: boolean
  balances: PersonalWalletAssetBalance[]
  totalUsdValue: number
  todayChangeUsd?: number
  dayAnchorUtcDate?: string | null
  dayAnchorTotalUsd?: number
  lastSyncedAt: string | null
  createdAt: string
}

export type DexSuggestionItem = {
  symbol: string
  binanceSymbol: string
  change24hPct: number | null
  lastPriceUsd: number | null
  walletUsd: number
  stance: 'stable' | 'momentum_up' | 'pullback' | 'risk_off'
  rationale: string
}

export type DexAllocationSuggestionsResponse = {
  enabled: boolean
  usdtFree: number
  items: DexSuggestionItem[]
  disclaimer: string
}

export type PersonalWalletWithdrawalRow = {
  id: string
  asset: string
  amount: number
  toAddress: string
  txHash: string | null
  status: 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED'
  feeUsd: number
  errorMessage: string | null
  requestedAt: string
  processedAt: string | null
}

export type WalletActivityItem = {
  id: string
  at: string
  chain: 'BSC' | 'Solana' | 'Cross-chain'
  type: 'Withdraw' | 'Convert' | 'Transfer'
  detail: string
  amount: string
  status: string
  txLink?: string
  txLink2?: string
  transferId?: string
  canRetryCredit?: boolean
  statusNote?: string
}

export const personalWallet = {
  status: async () =>
    (await api.get('/api/personal-wallet')).data as Promise<{
      configured: boolean
      wallet: PersonalWalletSummary | null
      supportedAssets?: string[]
      message?: string
    }>,
  create: async () => (await api.post('/api/personal-wallet/create')).data as Promise<{ address: string; created: boolean }>,
  withdraw: async (payload: { asset: string; amount: number; toAddress: string }) =>
    (await api.post('/api/personal-wallet/withdraw', payload)).data as Promise<{
      id: string
      txHash: string
      status: string
    }>,
  withdrawals: async () =>
    (await api.get('/api/personal-wallet/withdrawals')).data as Promise<{
      items: PersonalWalletWithdrawalRow[]
    }>,
  activity: async (params?: { scope?: 'bsc' | 'solana' | 'cross' | 'all'; limit?: number }) =>
    (await api.get('/api/personal-wallet/activity', { params })).data as Promise<{
      items: WalletActivityItem[]
    }>,
  swap: async (payload: { side: 'BUY' | 'SELL'; tokenSymbol: string; amount: number; slippageBps?: number }) =>
    (await api.post('/api/personal-wallet/swap', payload)).data as Promise<{
      txHash: string
      side: 'BUY' | 'SELL'
      tokenSymbol: string
      amountIn: string
      expectedOut: string
      minOut: string
      trade: {
        id: string
        pair: string
        allocationUsd: number
        entryPrice: number
        pnl: number | null
        exitPrice: number | null
        side: 'BUY' | 'SELL' | 'CLOSED'
        status: 'OPEN' | 'CLOSED'
      }
    }>,
  /** Sell full personal-wallet position for a symbol (dashboard open-positions table). */
  sellOpen: async (payload: { symbol: string }) =>
    (await api.post('/api/personal-wallet/sell-open', payload)).data as Promise<{
      txHash: string
      trade: { id: string; pair: string; pnl: number | null; side: string; status: string }
    }>,
  dexSuggestions: async () =>
    (await api.get('/api/personal-wallet/dex-suggestions')).data as Promise<DexAllocationSuggestionsResponse>,
  // ---- Cross-chain USDC transfer (BSC <-> Solana personal wallets) ----
  crossChainStatus: async (direction?: 'BSC_TO_SOL' | 'SOL_TO_BSC') =>
    (await api.get('/api/personal-wallet/cross-chain/status', {
      params: direction ? { direction } : undefined,
    })).data as Promise<{
      enabled: boolean
      feeUsd: number
      minAmount: number
      maxAmount: number
      directions: Array<'BSC_TO_SOL' | 'SOL_TO_BSC'>
      message: string | null
      operatorLiquidity?: { bscUsdc: number; solUsdc: number }
      operatorAddresses?: { bsc: string; solana: string }
      supportedSymbols?: string[]
    }>,
  crossChainAssets: async (direction: 'BSC_TO_SOL' | 'SOL_TO_BSC') =>
    (await api.get('/api/personal-wallet/cross-chain/assets', { params: { direction } })).data as Promise<{
      items: Array<{
        symbol: string
        balance: number
        usdValue: number | null
        crossChainReady: boolean
        hint: string | null
        destinationSymbol: string | null
      }>
    }>,
  crossChainQuote: async (params: {
    amount: number
    direction?: 'BSC_TO_SOL' | 'SOL_TO_BSC'
    sourceSymbol?: string
    destSymbol?: string
  }) =>
    (await api.get('/api/personal-wallet/cross-chain/quote', { params })).data as Promise<{
      asset: string
      amount: number
      feeUsd: number
      creditAmount: number
      minAmount: number
      maxAmount: number
      destinationSymbol: string
      sourceSymbol?: string
      sourceAmount?: number
      tokenUsdPrice?: number | null
      destTokenUsdPrice?: number | null
      estimated?: boolean
    }>,
  crossChainTransfer: async (payload: {
    direction: 'BSC_TO_SOL' | 'SOL_TO_BSC'
    amount: number
    sourceSymbol?: string
    destSymbol?: string
  }) =>
    (await api.post('/api/personal-wallet/cross-chain/transfer', payload, { timeout: 120_000 })).data as Promise<{
      id: string
      status: string
      direction: 'BSC_TO_SOL' | 'SOL_TO_BSC'
      amount: number
      creditAmount: number
      feeUsd: number
      debitTxRef: string
      creditTxRef: string
    }>,
  crossChainTransfers: async () =>
    (await api.get('/api/personal-wallet/cross-chain/transfers')).data as Promise<{
      items: Array<{
        id: string
        direction: 'BSC_TO_SOL' | 'SOL_TO_BSC'
        asset: string
        destAsset: string | null
        amount: number
        creditAmount: number
        feeUsd: number
        status: string
        debitTxRef: string | null
        creditTxRef: string | null
        errorMessage: string | null
        requestedAt: string
        processedAt: string | null
      }>
    }>,
  crossChainRetry: async (id: string) =>
    (await api.post(`/api/personal-wallet/cross-chain/retry/${id}`, {}, { timeout: 180_000 })).data as Promise<{
      id: string
      status: string
      creditTxRef: string
    }>,
  /** BSC same-chain convert (Pancake, no trade book). */
  convertCatalog: async () =>
    (await api.get('/api/personal-wallet/convert/catalog')).data as Promise<{
      items: Array<{ symbol: string }>
    }>,
  convertQuote: async (params: { fromSymbol: string; toSymbol: string; amount: number }) =>
    (await api.get('/api/personal-wallet/convert/quote', { params, timeout: 15_000 })).data as Promise<{
      fromSymbol: string
      toSymbol: string
      inAmount: number
      outAmount: number
      rate: number
    }>,
  convert: async (payload: { fromSymbol: string; toSymbol: string; amount: number; slippageBps?: number }) =>
    (await api.post('/api/personal-wallet/convert', payload, { timeout: 120_000 })).data as Promise<{
      txHash: string
      fromSymbol: string
      toSymbol: string
      inAmount: number
      outAmount: number
    }>,
}

export type InboxCategory = 'TOKEN_TRADING_SIGNAL' | 'BALANCE_ALLOCATION' | 'SYSTEM'

export type InboxMessageRow = {
  id: string
  category: InboxCategory
  title: string
  body: string
  metadata: Record<string, unknown> | null
  readAt: string | null
  createdAt: string
}

export const inbox = {
  list: async (opts?: { limit?: number; unreadOnly?: boolean }) => {
    const params: Record<string, string | number> = {}
    if (opts?.limit != null) params.limit = opts.limit
    if (opts?.unreadOnly) params.unreadOnly = '1'
    return (await api.get('/api/inbox', { params })).data as Promise<{
      items: InboxMessageRow[]
    }>
  },
  unreadCount: async () => (await api.get('/api/inbox/unread-count')).data as Promise<{ count: number }>,
  markRead: async (id: string) => (await api.patch(`/api/inbox/${encodeURIComponent(id)}/read`)).data as Promise<{ ok: boolean }>,
  markAllRead: async () => (await api.post('/api/inbox/mark-all-read')).data as Promise<{ ok: boolean; updated: number }>,
}

export type MarketBoardRow = {
  symbol: string
  lastPrice: number
  priceChangePercent: number
  highPrice: number
  lowPrice: number
  quoteVolume: number
  baseVolume: number
  priceSource?: 'jupiter_v3' | 'binance'
  mint?: string
  baseSymbol?: string
  jupiterBlockId?: number | null
  tradableOnSolana?: boolean
}

export const tokenTrading = {
  meta: async () =>
    (await api.get('/api/token-trading/meta')).data as Promise<{
      executionChain: string
      primaryVenue: string
      noteOtherVenues: string
      personalWalletEnabled: boolean
      supportedSymbols: string[]
    }>,
  marketBoard: async (limit = 400) =>
    (await api.get('/api/token-trading/market-board', { params: { limit } })).data as Promise<{
      rows: MarketBoardRow[]
      updatedAt: string
      cached: boolean
    }>,
  focusToken: async (
    binanceSymbol: string,
    context?: {
      chain?: 'bsc' | 'base' | 'arbitrum' | 'polygon'
      venue?: 'pancakeswap' | 'uniswap' | 'auto'
      wallet?: {
        mode: 'personal' | 'external'
        label?: string
        addressTail?: string
        usdtBalance?: number
        baseUsdApprox?: number
      }
    },
  ) =>
    (
      await api.post('/api/token-trading/focus-token', {
        binanceSymbol,
        chain: context?.chain,
        venue: context?.venue,
        wallet: context?.wallet,
      })
    ).data as Promise<{
      popupTitle: string
      popupBody: string
      inboxInserted: boolean
      signal: 'BUY' | 'SELL' | 'HOLD'
      refPrice: number
      buyRef: number
      sellRef: number
    }>,
  syncAlerts: async () =>
    (await api.post('/api/token-trading/sync-alerts')).data as Promise<{
      created: number
      skipped: number
      requiresPersonalWallet: boolean
      error?: string
    }>,
}

export type DexOneInchQuotePreview = {
  binanceSymbol: string
  side: 'BUY' | 'SELL'
  token: {
    baseSymbol: string
    binanceSymbol: string
    contractAddress: string
    decimals: number
    name: string
    source: 'catalog' | 'oneinch'
  }
  amountIn: string
  amountOut: string
  amountInHuman: number
  amountOutHuman: number
  binanceMidPrice: number | null
  executablePrice: number | null
  priceVsBinanceBps: number | null
  latencyMs: number
  tradable: boolean
  message?: string
}

export type DexOneInchOverview = {
  rows: MarketBoardRow[]
  updatedAt: string
  cached: boolean
  totalPairs: number
  highlights: {
    hot: MarketBoardRow[]
    topGainers: MarketBoardRow[]
    topLosers: MarketBoardRow[]
  }
}

export type SmartExecutionQuote = {
  binanceSymbol: string
  side: 'BUY' | 'SELL'
  amount: number
  binanceMid: number | null
  venues: {
    binance: {
      venue: 'binance'
      available: boolean
      reason?: string
      executablePrice: number | null
      amountInHuman: number
      amountOutHuman: number
      extraCostUsd: number
      priceVsBinanceMidBps: number | null
    }
    oneinch: {
      venue: 'oneinch_bsc'
      available: boolean
      reason?: string
      executablePrice: number | null
      amountInHuman: number
      amountOutHuman: number
      extraCostUsd: number
      priceVsBinanceMidBps: number | null
    }
  }
  recommended: 'binance' | 'oneinch_bsc' | null
  savingsVsOtherBps: number | null
  savingsVsOtherUsd: number
  blockTrade: boolean
  blockReason?: string
}

export const smartExecution = {
  meta: async () =>
    (await api.get('/api/smart-execution/meta')).data as Promise<{
      name: string
      minUsdt: number
      maxBuyVsBinanceBps: number
      oneInchConfigured: boolean
      personalWalletEnabled: boolean
      note: string
    }>,
  quote: async (params: {
    binanceSymbol: string
    side: 'BUY' | 'SELL'
    amount: number
    slippageBps?: number
  }) =>
    (await api.get('/api/smart-execution/quote', { params, timeout: 20_000 })).data as Promise<SmartExecutionQuote>,
  swap: async (payload: {
    side: 'BUY' | 'SELL'
    binanceSymbol: string
    amount: number
    slippageBps?: number
    venue?: 'binance' | 'oneinch_bsc'
  }) =>
    (await api.post('/api/smart-execution/swap', payload, { timeout: 120_000 })).data as Promise<{
      venue: 'binance' | 'oneinch_bsc'
      binanceSymbol: string
      side: 'BUY' | 'SELL'
      orderId?: string
      txHash?: string
      trade: {
        id: string
        pair: string
        allocationUsd: number
        entryPrice: number
        exitPrice: number | null
        pnl: number | null
        side: 'BUY' | 'SELL' | 'CLOSED'
        status: 'OPEN' | 'CLOSED'
      }
    }>,
}

export const dexOneInch = {
  meta: async () =>
    (await api.get('/api/dex-1inch/meta')).data as Promise<{
      venue: string
      chainId: number
      chainName: string
      oneInchConfigured: boolean
      personalWalletEnabled: boolean
      minUsdtTrade: number
      catalogSymbols: string[]
      setupHint: string | null
      note: string
    }>,
  resolve: async (binanceSymbol: string) =>
    (await api.get(`/api/dex-1inch/resolve/${encodeURIComponent(binanceSymbol)}`)).data as Promise<{
      binanceSymbol: string
      tradable: boolean
      token: DexOneInchQuotePreview['token'] | null
      message?: string
    }>,
  marketBoard: async (limit = 1500) =>
    (await api.get('/api/dex-1inch/market-board', { params: { limit }, timeout: 30_000 })).data as Promise<{
      rows: MarketBoardRow[]
      updatedAt: string
      cached: boolean
    }>,
  overview: async (limit = 1500) =>
    (await api.get('/api/dex-1inch/overview', { params: { limit }, timeout: 30_000 })).data as Promise<DexOneInchOverview>,
  quote: async (params: {
    binanceSymbol: string
    side: 'BUY' | 'SELL'
    amount: number
    slippageBps?: number
  }) =>
    (
      await api.get('/api/dex-1inch/quote', {
        params,
        timeout: 15_000,
      })
    ).data as Promise<DexOneInchQuotePreview>,
  swap: async (payload: {
    side: 'BUY' | 'SELL'
    binanceSymbol: string
    amount: number
    slippageBps?: number
  }) =>
    (await api.post('/api/dex-1inch/swap', payload, { timeout: 120_000 })).data as Promise<{
      txHash: string
      side: 'BUY' | 'SELL'
      binanceSymbol: string
      amountIn: string
      expectedOut: string
      trade: {
        id: string
        pair: string
        allocationUsd: number
        entryPrice: number
        exitPrice: number | null
        pnl: number | null
        side: 'BUY' | 'SELL' | 'CLOSED'
        status: 'OPEN' | 'CLOSED'
      }
    }>,
}

export type DexJupiterQuotePreview = {
  binanceSymbol: string
  side: 'BUY' | 'SELL'
  token: {
    baseSymbol: string
    binanceSymbol: string
    mint: string
    decimals: number
    name: string
    source: 'catalog' | 'search'
  }
  amountIn: string
  amountOut: string
  amountInHuman: number
  amountOutHuman: number
  notionalUsd: number | null
  binanceMidPrice: number | null
  executablePrice: number | null
  priceVsBinanceBps: number | null
  priceImpactPct: number | null
  latencyMs: number
  tradable: boolean
  blockTrade: boolean
  blockReason?: string
  router?: string
  message?: string
  jupiterBuyPrice?: number | null
  jupiterSellPrice?: number | null
  roundTripSpreadBps?: number | null
  estRoundTripLossUsd?: number | null
  openEntryPrice?: number | null
  minProfitableSellPrice?: number | null
  breakEvenSellPrice?: number | null
  upsideToBreakEvenPct?: number | null
  priceVsEntryBps?: number | null
  estNetPnlUsd?: number | null
  takeProfitPct?: number | null
  stopLossPct?: number | null
  minMoveToBreakEvenPct?: number | null
  entryQuality?: 'good' | 'caution' | 'poor'
  entryQualityNote?: string | null
}

export type DexJupiterPosition = {
  baseSymbol: string
  binanceSymbol: string
  mint: string
  avgEntry: number
  qty: number
  totalAllocUsd: number
  liveSellPrice: number | null
  /** Same Jupiter mid as chart headline — (bid+ask)/2. */
  liveMidPrice?: number | null
  currentValueUsd: number | null
  estNetPnlUsd: number | null
  breakEvenSellPrice: number | null
  upsideToBreakEvenPct: number | null
  priceVsEntryPct: number | null
  inProfit: boolean
  /** USDC already banked via profit-skim while position stays open. */
  bankedSkimUsd?: number
  /** Effective take-profit % for this lot (override or global default). */
  takeProfitPct?: number
  /** Effective stop-loss % for this lot (override or global default). */
  stopLossPct?: number
  /** Effective trailing-stop flag for this lot. */
  trailingStop?: boolean
  /** Raw per-position overrides — null means inheriting global exit settings. */
  exitOverrides?: {
    takeProfitPct: number | null
    stopLossPct: number | null
    trailingStop: boolean | null
  }
}

export type DexJupiterSuggestion = {
  baseSymbol: string
  binanceSymbol: string
  mint: string
  name: string
  icon?: string
  usdPrice: number
  change5m: number
  change1h: number
  change24h: number
  liquidityUsd: number
  volume24hUsd: number
  organicScore: number
  netBuys5m: number
  score: number
  signal: 'strong' | 'rising' | 'watch'
  rationale: string
}

export type JupiterExitSettings = {
  enabled: boolean
  takeProfitPct: number
  stopLossPct: number
  trailingStop: boolean
  profitSkim: boolean
  /** Trailing arms once price is this % above entry. */
  trailingActivationPct?: number
  /** Once armed, exit when price falls this % below the peak. */
  trailingDeltaPct?: number
}

export type JupiterAutopilotSettings = {
  enabled: boolean
  maxBuyUsd: number
  minLiquidityUsd: number
  minSignal: 'rising' | 'strong'
  maxOpenPositions: number
  recurringInterval?: 'daily' | 'weekly' | null
  watchSymbol?: string | null
}

export type JupiterLimitOrder = {
  id: string
  userId: string
  binanceSymbol: string
  side: 'BUY' | 'SELL'
  limitPrice: number
  amount: number
  spendMint?: string
  status: 'OPEN' | 'FILLED' | 'CANCELLED'
  createdAt: string
  filledAt?: string
  txSignature?: string
}

export type JupiterSuperMachineSettings = {
  enabled: boolean
  maxTradeUsd: number
  maxOpenPositions: number
  maxDailyTrades: number
  maxDailyVolumeUsd: number
  minLiquidityUsd: number
  minSignal: 'rising' | 'strong'
  /** Chart-selected pair lock (e.g. SOLUSDT). Null = global scanner. */
  watchSymbol?: string | null
  emergencyStop: boolean
  aggressiveMode?: boolean
  trailingEntry?: boolean
}

export type SuperMachineStats = {
  totalTrades: number
  winningTrades: number
  losingTrades: number
  winRate: number
  totalPnlUsd: number
  realizedPnlUsd: number
  unrealizedPnlUsd: number
  /** USDC already banked to the wallet via profit skims on open positions. */
  skimmedProfitUsd?: number
  bestTrade: { symbol: string; pnlUsd: number } | null
  worstTrade: { symbol: string; pnlUsd: number } | null
  avgHoldTimeMinutes: number
  streak: number
  streakType: 'win' | 'loss' | 'none'
}

export type SuperMachineActivity = {
  id: string
  type: 'scan' | 'signal' | 'trade' | 'skip' | 'error' | 'profit' | 'exit'
  message: string
  details?: Record<string, unknown>
  timestamp: string
}

export type JupiterSuperMachineStatus = {
  settings: JupiterSuperMachineSettings
  runtime: {
    openPositions: number
    tradesToday: number
    volumeTodayUsd: number
    lastTickAt: string | null
    lastTradeAt: string | null
    startedAt: string | null
    botRunId: string | null
    walletUsdc?: number
    effectiveMaxTradeUsd?: number
    scanIntervalSec?: number
  }
  stats: SuperMachineStats
  agents: Record<string, { status: string; lastTickAt: string | null; ticks: number }>
  activity: SuperMachineActivity[]
  lastRisk: unknown
  lastOracle: unknown
  lastQuant: unknown
  globalAgentsStarted: boolean
}

export type CouncilAgentVote = {
  vote: 'BUY' | 'HOLD' | 'AVOID'
  confidence: number
  reason: string
  weight: number
}

export type CouncilDecision = {
  id: string
  timestamp: string
  symbol: string | null
  action: 'BUY' | 'HOLD'
  consensus: number
  threshold: number
  votes: Record<string, CouncilAgentVote>
  vetoedBy: string | null
  orderSizeUsd: number
  reasons: string[]
  llmProvider: string | null
  tradeId: string | null
  regime: string
  winRateTarget: { min: number; max: number }
  rollingWinRatePct: number | null
}

export type CouncilAgentPerformance = {
  id: string
  label: string
  weight: number
  accuracyPct: number | null
  samples: number
  lastVote: { vote: 'BUY' | 'HOLD' | 'AVOID'; confidence: number; reason: string } | null
}

export type CouncilStatus = {
  agents: CouncilAgentPerformance[]
  llmConfigured: boolean
  threshold: number
  rollingWinRatePct: number | null
  winRateSamples: number
  winRateTarget: { min: number; max: number }
  lastDecision: CouncilDecision | null
}

export type JupiterPredictionMarket = {
  marketId: string
  status: string
  result: string | null
  metadata: {
    title: string
    status?: string
    closeTime?: string
    rulesPrimary?: string
    rulesSecondary?: string
    closeCondition?: string
  }
  pricing: {
    buyYesPriceUsd: number | null
    buyNoPriceUsd: number | null
    sellYesPriceUsd?: number | null
    sellNoPriceUsd?: number | null
    volume?: number
  }
}

export type JupiterPredictionEvent = {
  eventId: string
  category: string
  isActive: boolean
  isLive: boolean
  provider?: string
  metadata: {
    title: string
    subtitle?: string
    imageUrl?: string
    closeTime?: string
    rulesPrimary?: string
    closeCondition?: string
  }
  markets?: JupiterPredictionMarket[]
  volumeUsd?: string
}

/** Side the edge model favours on a market, with the maths behind it. */
export type PredictionSideSuggestion = {
  side: 'YES' | 'NO'
  price: number
  impliedProb: number
  ourProb: number
  edgePct: number
  evPerDollar: number
}

export type PredictionVerdict = {
  action: 'BUY_YES' | 'BUY_NO' | 'SKIP'
  best: PredictionSideSuggestion | null
  reasons: string[]
  cautions: string[]
}

export type PredictionMarketInsight = {
  marketId: string
  plainQuestion: string
  daysToClose: number | null
  closeTime: string | null
  yes: { priceUsd: number | null; impliedProbPct: number | null }
  no: { priceUsd: number | null; impliedProbPct: number | null }
  stake: { usd: number; contracts: number; maxPayout: number; maxProfit: number } | null
  model: {
    base: string
    spot: number
    strike: number
    direction: 'above' | 'below'
    isTouch: boolean
    annualizedVolPct: number
    ourProbYesPct: number
  } | null
  verdict: PredictionVerdict
  volumeUsd: number | null
  settled: boolean
  result: string | null
}

export type PredictionEventInsight = {
  eventId: string
  markets: PredictionMarketInsight[]
  topPick: { marketId: string; side: 'YES' | 'NO'; edgePct: number; evPerDollar: number } | null
}

export type JupiterPredictionPosition = {
  pubkey: string
  marketId: string
  isYes: boolean
  contracts: string
  avgPriceUsd: string
  totalCostUsd: string
  valueUsd: string | null
  pnlUsd: string | null
  pnlUsdPercent: number | null
  claimable: boolean
  claimed: boolean
  marketMetadata: { title: string }
  eventMetadata: { title: string }
}

export type JupiterJournal = {
  totalTrades: number
  wins: number
  losses: number
  breakeven: number
  winRatePct: number
  totalPnlUsd: number
  avgPnlUsd: number
  avgHoldMinutes: number | null
  bestTrade: { pair: string; pnlUsd: number } | null
  worstTrade: { pair: string; pnlUsd: number } | null
  topTokens: Array<{
    baseSymbol: string
    trades: number
    wins: number
    winRatePct: number
    totalPnlUsd: number
  }>
  recentClosed: Array<{
    id: string
    pair: string
    baseSymbol: string
    entryPrice: number
    exitPrice: number
    allocationUsd: number
    pnlUsd: number
    pnlPct: number
    holdMinutes: number
    closedAt: string
  }>
  updatedAt: string
}

export type JupiterExecutableMarks = {
  baseSymbol: string
  binanceSymbol: string
  mint: string
  bid: number | null
  ask: number | null
  mid: number | null
  spreadBps: number | null
  ts: number
  updatedAt?: string
}

export type JupiterDepthLevel = { price: number; qty: number; notionalUsd: number }

export type JupiterTokenSafety = 'verified' | 'liquid' | 'low_liq' | 'risky'

export const dexJupiter = {
  meta: async () =>
    (await api.get('/api/dex-jupiter/meta')).data as Promise<{
      venue: string
      chainId: number
      chainName: string
      jupiterConfigured: boolean
      solanaWalletEnabled: boolean
      minUsdcTrade: number
      defaultBuyUsd?: number
      spendAssets?: Array<'USDC' | 'SOL'>
      catalogSymbols: string[]
      tradableCount?: number
      discovering?: boolean
      priceSource?: string
      setupHint: string | null
      note: string
    }>,
  ensureWallet: async () =>
    (await api.post('/api/dex-jupiter/wallet/ensure')).data as Promise<{
      address: string
      created: boolean
    }>,
  walletStatus: async () =>
    (await api.get('/api/dex-jupiter/wallet/status')).data as Promise<{
      configured: boolean
      wallet: { address: string; enabled: boolean } | null
    }>,
  walletBalances: async () =>
    (await api.get('/api/dex-jupiter/wallet/balances', { timeout: 28_000 })).data as Promise<{
      address: string | null
      sol: number
      usdc: number
      totalUsd: number
      supportedAssets: string[]
    }>,
  /** Dashboard fast path — one holdings pass + one price fetch. */
  walletSummary: async () =>
    (await api.get('/api/dex-jupiter/wallet/summary', { timeout: 35_000 })).data as Promise<{
      address: string | null
      sol: number
      usdc: number
      totalUsd: number
      tokens: Array<{ symbol: string; amount: number; usdValue: number }>
      supportedAssets: string[]
    }>,
  walletWithdraw: async (payload: { asset: 'USDC' | 'SOL'; amount: number; toAddress: string }) =>
    (await api.post('/api/dex-jupiter/wallet/withdraw', payload, { timeout: 90_000 })).data as Promise<{
      id: string
      txSignature: string
      status: string
    }>,
  walletWithdrawals: async () =>
    (await api.get('/api/dex-jupiter/wallet/withdrawals')).data as Promise<{
      items: Array<{
        id: string
        asset: string
        amount: number
        toAddress: string
        txSignature: string | null
        status: string
        errorMessage: string | null
        requestedAt: string
        processedAt: string | null
      }>
    }>,
  tokenBalance: async (binanceSymbol: string) =>
    (await api.get(`/api/dex-jupiter/wallet/token-balance/${encodeURIComponent(binanceSymbol)}`)).data as Promise<{
      binanceSymbol: string
      balance: number
      token: { baseSymbol: string; mint: string; decimals: number } | null
    }>,
  /** Manual desk: balances, two-sided pricing, break-even and a sized suggestion. */
  desk: async (params: { binanceSymbol: string; owner?: string; probeUsd?: number }) =>
    (await api.get('/api/dex-jupiter/desk', { params, timeout: 30_000 })).data as Promise<JupiterDesk>,
  manualPreflight: async (body: {
    binanceSymbol: string
    side: 'BUY' | 'SELL'
    amount: number
    slippageBps?: number
    spendMint?: string
    owner?: string
  }) =>
    (await api.post('/api/dex-jupiter/manual/preflight', body, { timeout: 30_000 }))
      .data as Promise<JupiterPreflight>,
  /** Builds an unsigned Jupiter swap for a connected browser wallet to sign. */
  browserBuildSwap: async (body: {
    owner: string
    side: 'BUY' | 'SELL'
    binanceSymbol: string
    amount: number
    slippageBps?: number
    spendMint?: string
  }) =>
    (await api.post('/api/dex-jupiter/browser/build-swap', body, { timeout: 30_000 })).data as Promise<{
      requestId: string
      transaction: string
      side: 'BUY' | 'SELL'
      binanceSymbol: string
      pair: string
      owner: string
      inputMint: string
      outputMint: string
      amountInHuman: number
      expectedOutHuman: number
      usdValue: number
      priceImpactPct: number | null
      slippageBps: number
      expiresAt: string
    }>,
  browserSubmitSwap: async (body: { requestId: string; signedTransaction: string }) =>
    (await api.post('/api/dex-jupiter/browser/submit-swap', body, { timeout: 90_000 })).data as Promise<{
      txSignature: string
      side: 'BUY' | 'SELL'
      pair: string
      amountIn: number
      amountOut: number
      autoManaged: false
      trade: {
        id: string
        pair: string
        status: 'OPEN' | 'CLOSED'
        entryPrice: number
        exitPrice: number | null
        pnl: number | null
        allocationUsd: number
      }
    }>,
  browserPositions: async (owner?: string) =>
    (await api.get('/api/dex-jupiter/browser/positions', { params: owner ? { owner } : {} }))
      .data as Promise<{
      positions: Array<{
        id: string
        pair: string
        baseSymbol: string
        binanceSymbol: string
        mint: string | null
        entryPrice: number
        markPrice: number | null
        allocationUsd: number
        qty: number
        pnlUsd: number | null
        pnlPct: number | null
        walletQty: number | null
        alert: 'take_profit' | 'stop_loss' | null
        openedAt: string
      }>
      thresholds: { takeProfitPct: number; stopLossPct: number }
      autoManaged: false
      note: string
    }>,
  /** Read-only holdings for any Solana address — used for connected browser wallets. */
  holdingsAt: async (address: string) =>
    (
      await api.get(`/api/dex-jupiter/wallet/holdings-at/${encodeURIComponent(address)}`, {
        timeout: 25_000,
      })
    ).data as Promise<{
      address: string
      sol: number
      usdc: number
      totalUsd: number
      tokens: Array<{
        mint: string
        symbol: string
        icon: string | null
        amount: number
        decimals: number
        usdPrice: number
        usdValue: number
      }>
    }>,
  walletTokens: async () =>
    (await api.get('/api/dex-jupiter/wallet/tokens', { timeout: 25_000 })).data as Promise<{
      address: string | null
      tokens: Array<{
        mint: string
        symbol: string
        icon: string | null
        amount: number
        decimals: number
        usdPrice: number
        usdValue: number
      }>
    }>,
  resolve: async (binanceSymbol: string) =>
    (await api.get(`/api/dex-jupiter/resolve/${encodeURIComponent(binanceSymbol)}`)).data as Promise<{
      binanceSymbol: string
      tradable: boolean
      token: DexJupiterQuotePreview['token'] | null
      message?: string
    }>,
  marketBoard: async (limit = 1500) =>
    (await api.get('/api/dex-jupiter/market-board', { params: { limit }, timeout: 45_000 })).data as Promise<{
      rows: MarketBoardRow[]
      updatedAt: string
      cached: boolean
      tradableCount?: number
      discovering?: boolean
    }>,
  candles: async (
    binanceSymbol: string,
    interval: '1m' | '5m' | '15m' | '1h' | '4h' | '1d' = '15m',
    limit = 72,
  ) =>
    (
      await api.get(`/api/dex-jupiter/candles/${encodeURIComponent(binanceSymbol)}`, {
        params: { interval, limit },
        timeout: 20_000,
      })
    ).data as Promise<{
      symbol: string
      interval: string
      count: number
      updatedAt: string
      priceSource: 'jupiter_v3_live'
      mint: string | null
      jupiterPrice: number | null
      jupiterBlockId: number | null
      candles: LiveCandle[]
      stale?: boolean
      degraded?: boolean
      note?: string
    }>,
  livePrice: async (binanceSymbol: string) =>
    (
      await api.get(`/api/dex-jupiter/price/${encodeURIComponent(binanceSymbol)}`, { timeout: 10_000 })
    ).data as Promise<{
      symbol: string
      mint: string | null
      price: number | null
      bid: number | null
      ask: number | null
      mid: number | null
      spreadBps: number | null
      blockId: number | null
      updatedAt: string
    }>,
  marks: async (binanceSymbol: string) =>
    (await api.get(`/api/dex-jupiter/marks/${encodeURIComponent(binanceSymbol)}`, { timeout: 12_000 }))
      .data as Promise<JupiterExecutableMarks>,
  depth: async (binanceSymbol: string, levels = 12) =>
    (
      await api.get(`/api/dex-jupiter/depth/${encodeURIComponent(binanceSymbol)}`, {
        params: { levels },
        timeout: 20_000,
      })
    ).data as Promise<{
      symbol: string
      mint: string | null
      bids: JupiterDepthLevel[]
      asks: JupiterDepthLevel[]
      mid: number | null
      bid: number | null
      ask: number | null
      spreadBps: number | null
      updatedAt: string
      source: 'jupiter_quotes'
    }>,
  overview: async (limit = 1500) =>
    (await api.get('/api/dex-jupiter/overview', { params: { limit }, timeout: 30_000 })).data as Promise<DexOneInchOverview>,
  suggestions: async () =>
    (await api.get('/api/dex-jupiter/suggestions', { timeout: 20_000 })).data as Promise<{
      items: DexJupiterSuggestion[]
      updatedAt: string
      cached: boolean
      disclaimer: string
    }>,
  positions: async () =>
    (await api.get('/api/dex-jupiter/positions', { timeout: 8_000 })).data as Promise<{
      positions: DexJupiterPosition[]
      totalNetPnlUsd: number
      totalValueUsd: number
      totalBankedSkimUsd?: number
      updatedAt: string
    }>,
  quote: async (params: {
    binanceSymbol: string
    side: 'BUY' | 'SELL'
    amount: number
    slippageBps?: number
    spendAsset?: 'USDC' | 'SOL'
    spendMint?: string
  }) =>
    (
      await api.get('/api/dex-jupiter/quote', {
        params,
        timeout: 15_000,
      })
    ).data as Promise<DexJupiterQuotePreview>,
  swap: async (payload: {
    side: 'BUY' | 'SELL'
    binanceSymbol: string
    amount: number
    slippageBps?: number
    spendAsset?: 'USDC' | 'SOL'
    spendMint?: string
    skipEntryGuard?: boolean
  }) =>
    (await api.post('/api/dex-jupiter/swap', payload, { timeout: 120_000 })).data as Promise<{
      txSignature: string
      side: 'BUY' | 'SELL'
      binanceSymbol: string
      amountIn: string
      expectedOut: string
      trade: {
        id: string
        pair: string
        allocationUsd: number
        entryPrice: number
        exitPrice: number | null
        pnl: number | null
        side: 'BUY' | 'SELL' | 'CLOSED'
        status: 'OPEN' | 'CLOSED'
      }
    }>,
  convertQuote: async (params: { fromMint: string; toMint: string; amount: number; slippageBps?: number }) =>
    (await api.get('/api/dex-jupiter/convert/quote', { params, timeout: 15_000 })).data as Promise<{
      fromMint: string
      toMint: string
      inAmount: number
      outAmount: number
      rate: number
    }>,
  convert: async (payload: { fromMint: string; toMint: string; amount: number; slippageBps?: number }) =>
    (await api.post('/api/dex-jupiter/convert', payload, { timeout: 120_000 })).data as Promise<{
      txSignature: string
      fromMint: string
      toMint: string
      inAmount: number
      outAmount: number
    }>,
  exitSettings: async () =>
    (await api.get('/api/dex-jupiter/exit-settings')).data as Promise<JupiterExitSettings>,
  saveExitSettings: async (payload: Partial<JupiterExitSettings>) =>
    (await api.put('/api/dex-jupiter/exit-settings', payload)).data as Promise<JupiterExitSettings>,
  autopilotSettings: async () =>
    (await api.get('/api/dex-jupiter/autopilot-settings')).data as Promise<JupiterAutopilotSettings>,
  saveAutopilotSettings: async (payload: Partial<JupiterAutopilotSettings>) =>
    (await api.put('/api/dex-jupiter/autopilot-settings', payload)).data as Promise<JupiterAutopilotSettings>,
  limitOrders: async () =>
    (await api.get('/api/dex-jupiter/limit-orders')).data as Promise<{ orders: JupiterLimitOrder[] }>,
  createLimitOrder: async (body: {
    binanceSymbol: string
    side: 'BUY' | 'SELL'
    limitPrice: number
    amount: number
    spendMint?: string
  }) => (await api.post('/api/dex-jupiter/limit-orders', body)).data as Promise<JupiterLimitOrder>,
  cancelLimitOrder: async (id: string) =>
    (await api.delete(`/api/dex-jupiter/limit-orders/${encodeURIComponent(id)}`)).data as Promise<{ ok: boolean }>,
  superMachineSettings: async () =>
    (await api.get('/api/dex-jupiter/super-machine/settings')).data as Promise<JupiterSuperMachineSettings>,
  saveSuperMachineSettings: async (payload: Partial<JupiterSuperMachineSettings>) =>
    (await api.put('/api/dex-jupiter/super-machine/settings', payload)).data as Promise<JupiterSuperMachineSettings>,
  superMachineStatus: async () =>
    (await api.get('/api/dex-jupiter/super-machine/status')).data as Promise<JupiterSuperMachineStatus>,
  councilStatus: async () =>
    (await api.get('/api/dex-jupiter/council/status')).data as Promise<CouncilStatus>,
  councilDecisions: async (limit = 200) =>
    (await api.get('/api/dex-jupiter/council/decisions', { params: { limit } })).data as Promise<{
      decisions: CouncilDecision[]
    }>,
  signals: async (limit = 8) =>
    (await api.get('/api/dex-jupiter/signals', { params: { limit } })).data as Promise<{
      signals: Array<{
        symbol: string
        baseSymbol: string
        action: 'BUY' | 'WATCH'
        score: number
        rationale: string
      }>
      updatedAt: string
      warmingUp: boolean
    }>,
  predictionsEvents: async (params?: {
    category?: 'all' | 'crypto' | 'sports' | 'politics' | 'esports' | 'culture' | 'economics' | 'tech'
    filter?: 'new' | 'live' | 'trending'
    limit?: number
    stakeUsd?: number
  }) =>
    (await api.get('/api/dex-jupiter/predictions/events', { params, timeout: 25_000 })).data as Promise<{
      events: JupiterPredictionEvent[]
      insights?: PredictionEventInsight[]
      updatedAt: string
      beta?: boolean
    }>,
  predictionsSearch: async (query: string, limit = 12, stakeUsd?: number) =>
    (
      await api.get('/api/dex-jupiter/predictions/events', {
        params: { query, limit, stakeUsd },
        timeout: 25_000,
      })
    ).data as Promise<{
      events: JupiterPredictionEvent[]
      insights?: PredictionEventInsight[]
      updatedAt: string
    }>,
  predictionsPositions: async () =>
    (await api.get('/api/dex-jupiter/predictions/positions', { timeout: 20_000 })).data as Promise<{
      positions: JupiterPredictionPosition[]
      ownerPubkey: string
      updatedAt: string
    }>,
  predictionsBuy: async (payload: { marketId: string; isYes: boolean; amountUsd: number }) =>
    (await api.post('/api/dex-jupiter/predictions/buy', payload, { timeout: 120_000 })).data as Promise<{
      txSignature: string
      orderPubkey?: string
    }>,
  predictionsClaim: async (positionPubkey: string) =>
    (await api.post('/api/dex-jupiter/predictions/claim', { positionPubkey }, { timeout: 120_000 })).data as Promise<{
      txSignature: string
      via?: 'claim' | 'sell_fallback'
    }>,
  predictionsClose: async (positionPubkey: string) =>
    (await api.post('/api/dex-jupiter/predictions/close', { positionPubkey }, { timeout: 120_000 })).data as Promise<{
      txSignature: string
    }>,
  predictionsHistory: async (limit = 50) =>
    (
      await api.get('/api/dex-jupiter/predictions/history', { params: { limit }, timeout: 20_000 })
    ).data as Promise<{
      events: Array<{
        id: string
        timestamp: string
        action: string
        marketId?: string
        positionPubkey?: string
        isYes?: boolean
        amountUsd?: number
        costUsd?: number
        proceedsUsd?: number
        pnlUsd?: number
        title?: string
        txSignature?: string
      }>
    }>,
  journal: async () =>
    (await api.get('/api/dex-jupiter/journal')).data as Promise<JupiterJournal>,
  sellOpen: async (payload: { binanceSymbol: string; fraction?: 'all' | 'half' }) =>
    (await api.post('/api/dex-jupiter/sell-open', payload, { timeout: 120_000 })).data as Promise<
      | {
          txSignature: string
          side: 'BUY' | 'SELL'
          binanceSymbol: string
          trade: {
            id: string
            pair: string
            pnl: number | null
            status: 'OPEN' | 'CLOSED'
          }
        }
      | {
          clearedStale: true
          symbol: string
          cancelledCount: number
          message: string
        }
    >,
  /** Retune TP/SL/trailing on a running position (null clears back to global). */
  setPositionExitOverrides: async (
    binanceSymbol: string,
    overrides: { takeProfitPct?: number | null; stopLossPct?: number | null; trailingStop?: boolean | null },
  ) =>
    (await api.put(`/api/dex-jupiter/positions/${encodeURIComponent(binanceSymbol)}/exit-overrides`, overrides))
      .data as Promise<{ updated: number; pair: string }>,
  /** Bank the profit slice of an open position into USDC — position keeps running. */
  skimPosition: async (binanceSymbol: string) =>
    (await api.post(`/api/dex-jupiter/positions/${encodeURIComponent(binanceSymbol)}/skim`, {}, { timeout: 120_000 }))
      .data as Promise<{
      txSignature: string
      side: 'BUY' | 'SELL'
      binanceSymbol: string
      trade: {
        id: string
        pair: string
        pnl: number | null
        status: 'OPEN' | 'CLOSED'
      }
    }>,
  executionCompare: async (params: {
    side: 'BUY' | 'SELL'
    binanceSymbol: string
    amount: number
    spendMint?: string
    slippageBps?: number
    includeSecondary?: boolean
  }) =>
    (
      await api.get('/api/dex-jupiter/execution/compare', {
        params: {
          ...params,
          includeSecondary: params.includeSecondary ? '1' : '0',
        },
        timeout: 25_000,
      })
    ).data as Promise<ExecutionCompareResult>,
}

export type ExecutionCompareResult = {
  side: 'BUY' | 'SELL'
  binanceSymbol: string
  amountIn: number
  best: {
    router: string
    label: string
    outAmount: number
    latencyMs: number
    score: number
    canExecute: boolean
    explanation: string
  } | null
  routes: Array<{
    router: string
    label: string
    outAmount: number
    inAmount: number
    latencyMs: number
    priceImpactPct: number | null
    score: number
    executable: boolean
    canExecute: boolean
    error?: string
    explanation: string
  }>
  cex: { binance: number | null; okx: number | null; bybit: number | null }
  rpc: Array<{ url: string; latencyMs: number | null; ok: boolean }>
  aiExplanation: string
  confidence: {
    overall: number
    liquidity: number
    execution: number
    spread: number
    momentum: number
  }
  generatedAt: string
}

export const deposit = {
  create: async (amount: number, reference?: string) =>
    (await api.post('/api/deposit', { amount, reference })).data,
  history: async () => (await api.get('/api/deposit/history')).data,
}

export const referral = {
  status: async () =>
    (await api.get('/api/referral/status')).data as Promise<{
      referralCode: string | null
      hasAppliedReferral: boolean
      totalRewards: number
      referralCount: number
      trialBalance: number
      jupiterReferralEarningsUsd?: number
      jupiterVolumeReferredUsd?: number
      jupiterReferralTrades?: number
    }>,
  apply: async (code: string) => (await api.post('/api/referral/apply', { code })).data,
}

export const risk = {
  getRule: async () =>
    (await api.get('/api/risk/rules')).data as Promise<{
      rule: {
        id: string
        maxOrderNotional: number | null
        maxOpenNotional: number | null
        maxDailyLoss: number | null
        cooldownMinutes: number
        maxLosingStreak: number
        isEnabled: boolean
        updatedAt: string
      } | null
    }>,
  updateRule: async (payload: {
    maxOrderNotional?: number | null
    maxOpenNotional?: number | null
    maxDailyLoss?: number | null
    cooldownMinutes?: number
    maxLosingStreak?: number
    isEnabled?: boolean
  }) =>
    (await api.put('/api/risk/rules', payload)).data as Promise<{
      ok: boolean
      rule: {
        id: string
        maxOrderNotional: number | null
        maxOpenNotional: number | null
        maxDailyLoss: number | null
        cooldownMinutes: number
        maxLosingStreak: number
        isEnabled: boolean
        updatedAt: string
      }
    }>,
  listEvents: async (limit = 50) =>
    (await api.get('/api/risk/events', { params: { limit } })).data as Promise<{
      events: Array<{
        id: string
        kind: string
        severity: string
        message: string
        metadata: unknown
        createdAt: string
      }>
    }>,
  readiness: async () =>
    (await api.get('/api/risk/readiness')).data as Promise<{
      ready: boolean
      hasRiskPolicyEnabled: boolean
      hasSafeTradableConnection: boolean
      liveAutomationEnabled: boolean
      maintenanceReason: string | null
      blockers: string[]
      safeConnections: Array<{ id: string; label: string | null; exchange: string }>
    }>,
}

export const market = {
  overview: async () => (await api.get('/api/prices/overview')).data as Promise<{
    updatedAt: string
    rows: Array<{
      rank: number
      symbol: string
      pair: string
      lastPrice: number
      changePercent24h: number
      volume24hBase: number
      volume24hQuote: number
      marketCapUsd: number | null
      sparkline7d: number[]
    }>
  }>,
}

export const orders = {
  create: async (payload: {
    exchangeConnectionId: string
    symbol: 'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT'
    side: 'BUY' | 'SELL'
    type: 'MARKET' | 'LIMIT'
    quantity: number
    price?: number
    timeInForce?: 'GTC' | 'IOC' | 'FOK'
    stopLossPrice?: number
    takeProfitPrice?: number
    trailingPercent?: number
  }) => (await api.post('/api/orders', payload)).data,
  list: async (params?: { status?: string; symbol?: string; page?: number; limit?: number }) =>
    (await api.get('/api/orders', { params })).data,
  sync: async (id: string) => (await api.post(`/api/orders/${id}/sync`)).data,
}

export type CalcCoin = {
  id: string
  symbol: string
  name: string
  thumb: string | null
  usdPrice: number | null
}

export const tools = {
  calcSearch: async (q: string) =>
    (await api.get('/api/tools/calc/search', { params: { q } })).data as Promise<{ items: CalcCoin[] }>,
  calcQuick: async () => (await api.get('/api/tools/calc/quick')).data as Promise<{ items: CalcCoin[] }>,
  calcPrice: async (id: string) =>
    (await api.get('/api/tools/calc/price', { params: { id } })).data as Promise<{ id: string; usdPrice: number | null }>,
}
