'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { type MarketBoardRow } from '@/lib/api'

function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return '—'
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (p >= 1) return p.toFixed(4)
  return p.toPrecision(6)
}

function fmtPct(p: number): string {
  if (!Number.isFinite(p)) return '—'
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`
}

type Props = {
  rows: MarketBoardRow[]
  selected: string | null
  onSelect: (symbol: string) => void
  tradableCount?: number
  discovering?: boolean
}

export function JupiterTokenSearch({ rows, selected, onSelect, tradableCount, discovering }: Props) {
  const [query, setQuery] = useState('')
  const [open, setOpen] = useState(false)
  const [activeIdx, setActiveIdx] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const selectedRow = useMemo(
    () => rows.find((r) => r.symbol === selected) ?? null,
    [rows, selected],
  )

  const results = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return rows.slice(0, 12)
    return rows
      .filter((r) => {
        const base = r.baseSymbol ?? r.symbol.replace(/USDT$/i, '')
        return (
          r.symbol.toLowerCase().includes(q) ||
          base.toLowerCase().includes(q)
        )
      })
      .slice(0, 20)
  }, [rows, query])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '/' && !e.metaKey && !e.ctrlKey && !e.altKey) {
        const tag = (e.target as HTMLElement)?.tagName
        if (tag === 'INPUT' || tag === 'TEXTAREA') return
        e.preventDefault()
        inputRef.current?.focus()
        setOpen(true)
      }
      if (e.key === 'Escape') setOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [])

  const pick = useCallback(
    (sym: string) => {
      onSelect(sym)
      setQuery('')
      setOpen(false)
      inputRef.current?.blur()
    },
    [onSelect],
  )

  const onInputKey = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActiveIdx((i) => Math.min(i + 1, results.length - 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActiveIdx((i) => Math.max(i - 1, 0))
    } else if (e.key === 'Enter' && results[activeIdx]) {
      e.preventDefault()
      pick(results[activeIdx]!.symbol)
    }
  }

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <div className="flex items-center gap-2 rounded-xl border border-white/10 bg-[#0a0a0f] px-3 py-1.5">
        <svg className="h-4 w-4 shrink-0 text-zinc-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M21 21l-4.35-4.35M11 18a7 7 0 100-14 7 7 0 000 14z" />
        </svg>
        <input
          ref={inputRef}
          value={query}
          onChange={(e) => {
            setQuery(e.target.value)
            setOpen(true)
            setActiveIdx(0)
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onInputKey}
          placeholder={selectedRow ? `${selectedRow.baseSymbol ?? selectedRow.symbol.replace(/USDT$/i, '')} — search tokens…` : 'Search tokens…'}
          className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-zinc-500"
        />
        <kbd className="hidden rounded border border-white/10 px-1.5 py-0.5 font-mono text-[10px] text-zinc-500 sm:inline">
          /
        </kbd>
        {tradableCount != null ? (
          <span className="hidden text-[10px] text-zinc-600 lg:inline">
            {tradableCount.toLocaleString()} tokens{discovering ? ' · updating' : ''}
          </span>
        ) : null}
      </div>

      {open && results.length > 0 ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 max-h-[320px] overflow-y-auto rounded-xl border border-white/10 bg-[#0c0c12] py-1 shadow-2xl">
          {results.map((r, i) => {
            const base = r.baseSymbol ?? r.symbol.replace(/USDT$/i, '')
            const active = i === activeIdx
            return (
              <button
                key={r.symbol}
                type="button"
                onMouseEnter={() => setActiveIdx(i)}
                onClick={() => pick(r.symbol)}
                className={`flex w-full items-center justify-between px-3 py-2 text-left text-xs transition ${
                  active ? 'bg-violet-500/15' : 'hover:bg-white/5'
                } ${selected === r.symbol ? 'ring-1 ring-inset ring-violet-500/30' : ''}`}
              >
                <span>
                  <span className="font-semibold text-zinc-100">{base}</span>
                  <span className="ml-2 font-mono text-[10px] text-zinc-500">${fmtPrice(r.lastPrice)}</span>
                </span>
                <span
                  className={`font-mono tabular-nums ${r.priceChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
                >
                  {fmtPct(r.priceChangePercent)}
                </span>
              </button>
            )
          })}
        </div>
      ) : open && query.trim() ? (
        <div className="absolute left-0 right-0 top-full z-50 mt-1 rounded-xl border border-white/10 bg-[#0c0c12] px-3 py-4 text-center text-xs text-zinc-500 shadow-2xl">
          No token match — try symbol name (e.g. PUMP, SOL)
        </div>
      ) : null}
    </div>
  )
}
