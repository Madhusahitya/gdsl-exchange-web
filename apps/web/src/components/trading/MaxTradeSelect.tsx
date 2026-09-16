'use client'

/**
 * Max-trade picker for the Super Machines: fixed presets plus a "Custom" entry
 * that reveals a numeric input. Commits on blur / Enter, clamped to the venue's
 * server-side limits so the request is never rejected for range.
 */
import { useEffect, useState } from 'react'
import { cn } from '@/lib/utils'

export const MAX_TRADE_PRESETS = [10, 15, 25, 30, 50, 100] as const

const CUSTOM = 'custom'

type Props = {
  value: number
  onChange: (usd: number) => void
  min: number
  max: number
  disabled?: boolean
  className?: string
  inputClassName?: string
}

function clampUsd(n: number, min: number, max: number): number {
  const v = Math.round(n * 100) / 100
  return Math.min(max, Math.max(min, v))
}

export function MaxTradeSelect({ value, onChange, min, max, disabled, className, inputClassName }: Props) {
  const isPreset = (MAX_TRADE_PRESETS as readonly number[]).includes(value)
  const [custom, setCustom] = useState(!isPreset)
  const [draft, setDraft] = useState(String(value))

  // A value arriving from the server that is not a preset means the user chose
  // a custom size earlier; keep the input visible rather than snapping to a preset.
  useEffect(() => {
    if (!isPreset) setCustom(true)
    setDraft(String(value))
  }, [value, isPreset])

  const commit = () => {
    const n = Number.parseFloat(draft)
    if (!Number.isFinite(n) || n <= 0) {
      setDraft(String(value))
      return
    }
    const next = clampUsd(n, min, max)
    setDraft(String(next))
    if (next !== value) onChange(next)
  }

  return (
    <div className={cn('flex items-center gap-1.5', className)}>
      <select
        className={cn(
          'rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200',
          inputClassName,
        )}
        value={custom ? CUSTOM : value}
        disabled={disabled}
        onChange={(e) => {
          if (e.target.value === CUSTOM) {
            setCustom(true)
            setDraft(String(value))
            return
          }
          setCustom(false)
          onChange(Number(e.target.value))
        }}
      >
        {MAX_TRADE_PRESETS.filter((p) => p >= min && p <= max).map((p) => (
          <option key={p} value={p}>
            ${p}
          </option>
        ))}
        <option value={CUSTOM}>Custom</option>
      </select>
      {custom ? (
        <span className="flex items-center gap-0.5">
          <span className="text-[11px] text-zinc-500">$</span>
          <input
            type="number"
            inputMode="decimal"
            min={min}
            max={max}
            step={1}
            value={draft}
            disabled={disabled}
            aria-label="Custom max trade in USD"
            onChange={(e) => setDraft(e.target.value)}
            onBlur={commit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') (e.currentTarget as HTMLInputElement).blur()
            }}
            className={cn(
              'w-16 rounded border border-zinc-700 bg-zinc-800 px-1.5 py-1 font-mono text-[11px] text-zinc-200 outline-none focus:border-violet-400',
              inputClassName,
            )}
          />
        </span>
      ) : null}
    </div>
  )
}
