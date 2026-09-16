/**
 * BSC token catalog used by the DEX trading page and dashboard quick-trade card.
 *
 * All addresses are verified from BscScan. Bridged tokens (BTCB, ETH, DOGE, XRP)
 * use the canonical Binance-Peg contracts. PancakeSwap V2 routes through WBNB
 * for any non-BNB token, so we always express the swap path as
 *   [USDT, WBNB, TOKEN]            for BUY
 *   [TOKEN, WBNB, USDT]            for SELL
 * For BNB itself we collapse to a single hop:
 *   [USDT, WBNB]                   for BUY  (USDT → WBNB; user can unwrap)
 *   [WBNB, USDT]                   for SELL
 */

export type BscToken = {
  /** Canonical symbol used as state key (e.g. "BNB", "BTC", "ETH"). */
  symbol: string
  /** UI-friendly display label. */
  label: string
  /** ERC-20 contract address on BSC mainnet. */
  address: `0x${string}`
  /** ERC-20 decimals. */
  decimals: number
  /** TradingView symbol used for the embed. */
  tradingViewSymbol: string
  /** Binance spot symbol used for live candles + AI signals. */
  binanceSymbol: string
  /** Optional logo URL (CoinGecko CDN). */
  logo?: string
  /** True for the platform default (BNB). */
  isDefault?: boolean
  /** Compact 24/7 description for the coin selector card. */
  blurb?: string
}

export const BSC_USDT: `0x${string}` = '0x55d398326f99059ff775485246999027b3197955'
export const BSC_USDC: `0x${string}` = '0x8ac76a51cc950d9822d68b83fe1ad97b32cd580d'
export const BSC_WBNB: `0x${string}` = '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'

export const BSC_TOKENS: BscToken[] = [
  {
    symbol: 'BNB',
    label: 'Binance Coin',
    address: BSC_WBNB,
    decimals: 18,
    tradingViewSymbol: 'BINANCE:BNBUSDT',
    binanceSymbol: 'BNBUSDT',
    isDefault: true,
    blurb: 'Native gas token. Deepest liquidity on PancakeSwap.',
    logo: 'https://assets.coingecko.com/coins/images/825/small/bnb-icon2_2x.png',
  },
  {
    symbol: 'BTC',
    label: 'Bitcoin (BTCB)',
    address: '0x7130d2a12b9bcbfae4f2634d864a1ee1ce3ead9c',
    decimals: 18,
    tradingViewSymbol: 'BINANCE:BTCUSDT',
    binanceSymbol: 'BTCUSDT',
    blurb: 'Binance-Peg BTC. Routes BTCB → WBNB → USDT.',
    logo: 'https://assets.coingecko.com/coins/images/1/small/bitcoin.png',
  },
  {
    symbol: 'ETH',
    label: 'Ethereum',
    address: '0x2170ed0880ac9a755fd29b2688956bd959f933f8',
    decimals: 18,
    tradingViewSymbol: 'BINANCE:ETHUSDT',
    binanceSymbol: 'ETHUSDT',
    blurb: 'Binance-Peg ETH. Multi-hop through WBNB.',
    logo: 'https://assets.coingecko.com/coins/images/279/small/ethereum.png',
  },
  {
    symbol: 'XRP',
    label: 'XRP',
    address: '0x1d2f0da169ceb9fc7b3144628db156f3f6c60dbe',
    decimals: 18,
    tradingViewSymbol: 'BINANCE:XRPUSDT',
    binanceSymbol: 'XRPUSDT',
    blurb: 'Binance-Peg XRP. Liquid via WBNB pool.',
    logo: 'https://assets.coingecko.com/coins/images/44/small/xrp-symbol-white-128.png',
  },
  {
    symbol: 'DOGE',
    label: 'Dogecoin',
    address: '0xba2ae424d960c26247dd6c32edc70b295c744c43',
    decimals: 8,
    tradingViewSymbol: 'BINANCE:DOGEUSDT',
    binanceSymbol: 'DOGEUSDT',
    blurb: 'Binance-Peg DOGE (8 decimals).',
    logo: 'https://assets.coingecko.com/coins/images/5/small/dogecoin.png',
  },
  {
    symbol: 'SOL',
    label: 'Solana (BEP-20)',
    address: '0x570a5d26f7765ecb712c0924e4de545b89fd43df',
    decimals: 18,
    tradingViewSymbol: 'BINANCE:SOLUSDT',
    binanceSymbol: 'SOLUSDT',
    blurb: 'Binance-Peg SOL. Verify Pancake pool depth before size.',
    logo: 'https://assets.coingecko.com/coins/images/4128/small/solana.png',
  },
  {
    symbol: 'LINK',
    label: 'Chainlink',
    address: '0xf8a0bf9cf54bb92f17374d9e9a321e6a111a51bd',
    decimals: 18,
    tradingViewSymbol: 'BINANCE:LINKUSDT',
    binanceSymbol: 'LINKUSDT',
    blurb: 'Binance-Peg LINK on BSC.',
    logo: 'https://assets.coingecko.com/coins/images/877/small/chainlink-new-logo.png',
  },
  {
    symbol: 'ADA',
    label: 'Cardano (BEP-20)',
    address: '0x3ee2200efb3400fabb9aacf31297cbdd1d435d47',
    decimals: 18,
    tradingViewSymbol: 'BINANCE:ADAUSDT',
    binanceSymbol: 'ADAUSDT',
    blurb: 'Binance-Peg ADA.',
    logo: 'https://assets.coingecko.com/coins/images/975/small/cardano.png',
  },
  {
    symbol: 'DOT',
    label: 'Polkadot (BEP-20)',
    address: '0x7083609fce4d1d8dc0c979aab8c869ea2c873402',
    decimals: 18,
    tradingViewSymbol: 'BINANCE:DOTUSDT',
    binanceSymbol: 'DOTUSDT',
    blurb: 'Binance-Peg DOT.',
    logo: 'https://assets.coingecko.com/coins/images/12171/small/polkadot.png',
  },
  {
    symbol: 'AVAX',
    label: 'Avalanche (BEP-20)',
    address: '0x1ce0c2827e2ef14d5c4f29a091d735a204794041',
    decimals: 18,
    tradingViewSymbol: 'BINANCE:AVAXUSDT',
    binanceSymbol: 'AVAXUSDT',
    blurb: 'Binance-Peg AVAX.',
    logo: 'https://assets.coingecko.com/coins/images/12559/small/Avalanche_Circle_RedWhite_Trans.png',
  },
  {
    symbol: 'MATIC',
    label: 'Polygon (MATIC)',
    address: '0xcc42724c6683b7e57334c4e856f4c9965ed682bd',
    decimals: 18,
    tradingViewSymbol: 'BINANCE:MATICUSDT',
    binanceSymbol: 'MATICUSDT',
    blurb: 'Binance-Peg MATIC (reference pair MATICUSDT).',
    logo: 'https://assets.coingecko.com/coins/images/4713/small/polygon.png',
  },
  {
    symbol: 'NEAR',
    label: 'NEAR (BEP-20)',
    address: '0x1fa4a73a3f0133f0025378af00236f3abdee5d63',
    decimals: 18,
    tradingViewSymbol: 'BINANCE:NEARUSDT',
    binanceSymbol: 'NEARUSDT',
    blurb: 'Binance-Peg NEAR.',
    logo: 'https://assets.coingecko.com/coins/images/10365/small/near.jpg',
  },
  {
    symbol: 'LTC',
    label: 'Litecoin (BEP-20)',
    address: '0x4338665cbb7b2485a8855a139b75d5e34ab0db94',
    decimals: 18,
    tradingViewSymbol: 'BINANCE:LTCUSDT',
    binanceSymbol: 'LTCUSDT',
    blurb: 'Binance-Peg LTC.',
    logo: 'https://assets.coingecko.com/coins/images/2/small/litecoin.png',
  },
  {
    symbol: 'USDC',
    label: 'USD Coin',
    address: BSC_USDC,
    decimals: 18,
    tradingViewSymbol: 'BINANCE:USDCUSDT',
    binanceSymbol: 'USDCUSDT',
    blurb: 'Stablecoin. Use USDC↔USDT for on-chain rebalancing.',
    logo: 'https://assets.coingecko.com/coins/images/6319/small/usd-coin.png',
  },
]

export const BSC_TOKEN_BY_SYMBOL: Record<string, BscToken> = Object.fromEntries(
  BSC_TOKENS.map((t) => [t.symbol, t]),
)

export const DEFAULT_BSC_TOKEN: BscToken =
  BSC_TOKENS.find((t) => t.isDefault) ?? BSC_TOKENS[0]

export function buildSwapPath(token: BscToken, direction: 'BUY' | 'SELL'): `0x${string}`[] {
  // BUY = USDT → token, SELL = token → USDT
  // BNB collapses via WBNB; everything else multi-hops through WBNB.
  //
  // Retained as the SAFE fallback path for callers that only want one
  // route. New code should prefer `candidateSwapPaths(...)` + a runtime
  // best-of-N quote (see below) so we never overpay LP fees when a
  // direct USDT–token pool exists.
  if (token.symbol === 'BNB') {
    return direction === 'BUY' ? [BSC_USDT, BSC_WBNB] : [BSC_WBNB, BSC_USDT]
  }
  return direction === 'BUY'
    ? [BSC_USDT, BSC_WBNB, token.address]
    : [token.address, BSC_WBNB, BSC_USDT]
}

/**
 * Return every Pancake V2 path we are willing to try for a swap, ordered
 * from "probably cheapest" to "always-works fallback":
 *   1. Direct USDT ↔ TOKEN  (1 hop, 0.25% LP fee, exists for blue chips)
 *   2. USDT ↔ WBNB ↔ TOKEN  (2 hops, 0.50% LP fees, exists for everything)
 *
 * The caller quotes each candidate via `router.getAmountsOut(amountIn, path)`
 * and picks the one that returns the most tokens (BUY) / most USDT (SELL).
 * Candidates whose pool doesn't exist simply revert — they're skipped.
 *
 * Why two paths instead of a static "direct list":
 *   Pool depth changes constantly on PancakeSwap. A token that has a deep
 *   direct USDT pool today might be drained tomorrow. Quoting at runtime
 *   means we always pick the right route without hand-maintaining a list.
 *
 * BNB is the trivial case: USDT ↔ BNB IS the WBNB hop, so we return a
 * single candidate.
 */
export function candidateSwapPaths(
  token: BscToken,
  direction: 'BUY' | 'SELL',
): `0x${string}`[][] {
  if (token.symbol === 'BNB') {
    return [direction === 'BUY' ? [BSC_USDT, BSC_WBNB] : [BSC_WBNB, BSC_USDT]]
  }
  if (direction === 'BUY') {
    return [
      [BSC_USDT, token.address],
      [BSC_USDT, BSC_WBNB, token.address],
    ]
  }
  return [
    [token.address, BSC_USDT],
    [token.address, BSC_WBNB, BSC_USDT],
  ]
}
