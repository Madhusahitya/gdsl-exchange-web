'use client'

import { createContext, useContext, useState, useCallback, useMemo, ReactNode } from 'react'

interface PortfolioState {
  totalValue: number
  pnl: number
}

interface PortfolioContextValue extends PortfolioState {
  updatePortfolio: (data: PortfolioState) => void
}

const PortfolioContext = createContext<PortfolioContextValue | null>(null)

export function PortfolioProvider({
  children,
  initial,
}: {
  children: ReactNode
  initial?: PortfolioState
}) {
  const [state, setState] = useState<PortfolioState>(
    initial ?? { totalValue: 0, pnl: 0 }
  )

  const updatePortfolio = useCallback((data: PortfolioState) => {
    setState(data)
  }, [])

  const value = useMemo(
    () => ({ ...state, updatePortfolio }),
    [state, updatePortfolio],
  )

  return <PortfolioContext.Provider value={value}>{children}</PortfolioContext.Provider>
}

export function usePortfolio(): PortfolioContextValue {
  const ctx = useContext(PortfolioContext)
  if (!ctx) throw new Error('usePortfolio must be used inside PortfolioProvider')
  return ctx
}
