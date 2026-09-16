'use client'

import { CexAutoTradingTerminal } from '@/components/cex/CexAutoTradingTerminal'

/**
 * Auto Trading — Binance CEX terminal.
 * Legacy banner-heavy layout replaced by CexAutoTradingTerminal (order book +
 * chart + recommendations + Super Machine toggle). Jupiter remains on /dex-jupiter.
 */
export default function TradingPage() {
  return <CexAutoTradingTerminal />
}
