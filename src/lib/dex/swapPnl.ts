/**
 * Realized swap PnL vs the pre-trade Pancake quote (slippage + fees), in USDT terms.
 * Negative ⇒ worse than quote (paid more USDT or received less vs quoted-out amount).
 */

export function dexBuyRealizedPnlUsd(input: {
  spentUsdt: number
  recvTok: number
  amountInUsdt: number
  quotedOutTok: number
}): number {
  const { spentUsdt, recvTok, amountInUsdt, quotedOutTok } = input
  const qTok = Math.max(quotedOutTok, Number.EPSILON * 1e12)
  /** USDT-equivalent value of tokens received at the pre-trade quote (not executed quote). */
  const recvTokQuotedUsd = recvTok * (amountInUsdt / qTok)
  const pnl = recvTokQuotedUsd - spentUsdt
  return Number.isFinite(pnl) ? Math.round(pnl * 1e9) / 1e9 : 0
}

export function dexSellRealizedPnlUsd(input: {
  recvUsdt: number
  soldTok: number
  amountInTok: number
  quotedUsdtOut: number
}): number {
  const { recvUsdt, soldTok, amountInTok, quotedUsdtOut } = input
  const aTok = Math.max(amountInTok, Number.EPSILON * 1e12)
  const quotedRecvForSold = soldTok * (quotedUsdtOut / aTok)
  const pnl = recvUsdt - quotedRecvForSold
  return Number.isFinite(pnl) ? Math.round(pnl * 1e9) / 1e9 : 0
}
