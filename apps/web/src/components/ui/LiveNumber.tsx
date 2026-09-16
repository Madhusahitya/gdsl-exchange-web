'use client'

import { useEffect, useRef, useState } from 'react'

const FLASH_MS = 450

/**
 * Binance-style live number — flashes green/red on tick, tabular figures.
 */
export function LiveNumber({
  value,
  children,
  className = '',
}: {
  value: number | null | undefined
  children: React.ReactNode
  className?: string
}) {
  const prev = useRef<number | null>(null)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)

  useEffect(() => {
    if (value == null || !Number.isFinite(value)) return
    const p = prev.current
    prev.current = value
    if (p == null || p === value) return
    setFlash(value > p ? 'up' : 'down')
    const t = setTimeout(() => setFlash(null), FLASH_MS)
    return () => clearTimeout(t)
  }, [value])

  return (
    <span
      className={`inline-block rounded px-0.5 font-mono tabular-nums transition-colors duration-300 ${
        flash === 'up'
          ? 'bg-emerald-500/20 text-emerald-300'
          : flash === 'down'
            ? 'bg-rose-500/20 text-rose-300'
            : ''
      } ${className}`}
    >
      {children}
    </span>
  )
}

/** Pulsing dot — signals live feed (Binance-style). */
export function LivePulse({ className = '' }: { className?: string }) {
  return (
    <span className={`relative inline-flex h-2 w-2 shrink-0 ${className}`} aria-hidden>
      <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-50" />
      <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
    </span>
  )
}
