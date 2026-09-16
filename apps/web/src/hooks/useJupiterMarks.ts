'use client'

import { useCallback, useEffect, useState } from 'react'
import { dexJupiter, type JupiterExecutableMarks } from '@/lib/api'
import { usePageVisible } from '@/hooks/usePageVisible'

/**
 * Unified Jupiter bid/ask/mid — same feed for chart, order book, and positions.
 */
export function useJupiterMarks(
  symbol: string | null | undefined,
  pollMs = 1_500,
): JupiterExecutableMarks | null {
  const [marks, setMarks] = useState<JupiterExecutableMarks | null>(null)
  const visible = usePageVisible()

  const refresh = useCallback(async () => {
    if (!symbol) return
    try {
      const m = await dexJupiter.marks(symbol)
      setMarks(m)
    } catch {
      /* optional feed */
    }
  }, [symbol])

  useEffect(() => {
    void refresh()
    if (!symbol || !visible) return
    const id = window.setInterval(() => void refresh(), pollMs)
    return () => window.clearInterval(id)
  }, [refresh, symbol, pollMs, visible])

  return marks
}
