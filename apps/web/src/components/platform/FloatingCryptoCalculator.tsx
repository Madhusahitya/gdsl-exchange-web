'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Calculator } from 'lucide-react'
import { tools, type CalcCoin } from '@/lib/api'

type Tab = 'convert' | 'calc'

const USD_COIN: CalcCoin = {
  id: 'usd',
  symbol: 'USD',
  name: 'US Dollar',
  thumb: null,
  usdPrice: 1,
}

function fmtNum(n: number, max = 8): string {
  if (!Number.isFinite(n)) return '—'
  if (Math.abs(n) >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 6 })
  return n.toLocaleString(undefined, { maximumFractionDigits: max })
}

function safeCalcEval(expr: string): number | null {
  const cleaned = expr.replace(/\s/g, '')
  if (!cleaned || !/^[\d.+\-*/()]+$/.test(cleaned)) return null
  try {
    const v = Function(`"use strict"; return (${cleaned})`)() as unknown
    return typeof v === 'number' && Number.isFinite(v) ? v : null
  } catch {
    return null
  }
}

function CoinPicker({
  label,
  value,
  onChange,
  quickCoins,
}: {
  label: string
  value: CalcCoin
  onChange: (c: CalcCoin) => void
  quickCoins: CalcCoin[]
}) {
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<CalcCoin[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDoc)
    return () => document.removeEventListener('mousedown', onDoc)
  }, [open])

  useEffect(() => {
    if (!open || query.trim().length < 1) {
      setResults([])
      return
    }
    const t = window.setTimeout(() => {
      void tools.calcSearch(query.trim()).then((r) => setResults(r.items)).catch(() => setResults([]))
    }, 350)
    return () => window.clearTimeout(t)
  }, [query, open])

  const pick = (c: CalcCoin) => {
    onChange(c)
    setOpen(false)
    setQuery('')
  }

  return (
    <div ref={ref} className="relative space-y-1">
      <p className="text-[10px] uppercase tracking-wide text-zinc-500">{label}</p>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center justify-between rounded-lg border border-white/10 bg-black/40 px-2.5 py-2 text-left text-xs text-white"
      >
        <span>
          {value.symbol} · {value.name}
        </span>
        {value.usdPrice != null ? (
          <span className="text-zinc-500">${fmtNum(value.usdPrice, 4)}</span>
        ) : null}
      </button>
      {open ? (
        <div className="absolute z-10 mt-1 w-full rounded-lg border border-white/10 bg-[#12121a] p-2 shadow-xl">
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search any coin…"
            className="mb-2 w-full rounded border border-white/10 bg-black/50 px-2 py-1.5 text-xs text-white outline-none"
            autoFocus
          />
          <div className="max-h-40 space-y-0.5 overflow-y-auto">
            <button
              type="button"
              onClick={() => pick(USD_COIN)}
              className="flex w-full items-center justify-between rounded px-2 py-1.5 text-left text-xs hover:bg-white/5"
            >
              <span>USD · US Dollar</span>
              <span className="text-zinc-500">$1</span>
            </button>
            {(query.trim() ? results : quickCoins).map((c) => (
              <button
                key={c.id}
                type="button"
                onClick={() => pick(c)}
                className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-xs hover:bg-white/5"
              >
                {c.thumb ? (
                  // Remote CoinGecko thumbnails, so next/image would need every
                  // host whitelisted up front.
                  <img src={c.thumb} alt="" className="h-4 w-4 rounded-full" />
                ) : null}
                <span className="flex-1 truncate">
                  {c.symbol} · {c.name}
                </span>
                {c.usdPrice != null ? (
                  <span className="text-zinc-500">${fmtNum(c.usdPrice, 4)}</span>
                ) : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function FloatingCryptoCalculator() {
  const [open, setOpen] = useState(false)
  const [tab, setTab] = useState<Tab>('convert')
  const [quickCoins, setQuickCoins] = useState<CalcCoin[]>([])
  const [fromCoin, setFromCoin] = useState<CalcCoin>(USD_COIN)
  const [toCoin, setToCoin] = useState<CalcCoin>({ id: 'ethereum', symbol: 'ETH', name: 'Ethereum', thumb: null, usdPrice: null })
  const [amount, setAmount] = useState('10')
  const [fromPrice, setFromPrice] = useState<number | null>(1)
  const [toPrice, setToPrice] = useState<number | null>(null)
  const [calcExpr, setCalcExpr] = useState('')
  const [calcResult, setCalcResult] = useState<string | null>(null)

  useEffect(() => {
    void tools.calcQuick().then((r) => setQuickCoins(r.items)).catch(() => undefined)
  }, [])

  const refreshPrice = useCallback(async (coin: CalcCoin, setter: (p: number | null) => void) => {
    if (coin.id === 'usd' || coin.symbol === 'USDT' || coin.symbol === 'USDC') {
      setter(1)
      return
    }
    if (coin.usdPrice != null) {
      setter(coin.usdPrice)
      return
    }
    try {
      const r = await tools.calcPrice(coin.id)
      setter(r.usdPrice)
    } catch {
      setter(null)
    }
  }, [])

  useEffect(() => {
    if (!open || tab !== 'convert') return
    void refreshPrice(fromCoin, setFromPrice)
    void refreshPrice(toCoin, setToPrice)
  }, [open, tab, fromCoin, toCoin, refreshPrice])

  const parsedAmount = Number(amount)
  const convertResult = useMemo(() => {
    if (!Number.isFinite(parsedAmount) || parsedAmount <= 0) return null
    if (fromPrice == null || toPrice == null || toPrice <= 0) return null
    const usd = fromCoin.id === 'usd' ? parsedAmount : parsedAmount * fromPrice
    const out = toCoin.id === 'usd' ? usd : usd / toPrice
    return { usd, out }
  }, [parsedAmount, fromPrice, toPrice, fromCoin.id, toCoin.id])

  const runCalc = () => {
    const v = safeCalcEval(calcExpr)
    setCalcResult(v != null ? fmtNum(v, 10) : 'Invalid expression')
  }

  return (
    <>
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="fixed bottom-20 right-4 z-40 flex h-10 w-10 items-center justify-center rounded-full border border-white/15 bg-white/[0.06] text-zinc-300 shadow-md shadow-black/40 backdrop-blur transition hover:border-white/25 hover:bg-white/10 hover:text-white sm:right-6"
          title="Open crypto calculator"
          aria-label="Open crypto calculator"
        >
          <Calculator className="h-4 w-4" />
        </button>
      ) : null}

      {open ? (
        <div className="fixed bottom-4 right-4 z-50 flex w-[min(100vw-2rem,360px)] flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#0d0d14] shadow-2xl shadow-black/60 sm:bottom-6 sm:right-6">
          <div className="flex items-center justify-between border-b border-white/10 bg-gradient-to-r from-violet-950/80 to-fuchsia-950/50 px-3 py-2.5">
            <div>
              <p className="text-sm font-semibold text-white">Crypto calculator</p>
              <p className="text-[10px] text-zinc-400">Live prices · convert · math</p>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg px-2 py-1 text-lg leading-none text-zinc-400 hover:bg-white/10 hover:text-white"
              aria-label="Close calculator"
            >
              ×
            </button>
          </div>

          <div className="flex gap-1 border-b border-white/10 p-1">
            {(['convert', 'calc'] as const).map((t) => (
              <button
                key={t}
                type="button"
                onClick={() => setTab(t)}
                className={`flex-1 rounded-lg py-1.5 text-xs font-medium capitalize ${
                  tab === t ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:bg-white/5'
                }`}
              >
                {t === 'convert' ? 'Convert' : 'Calculator'}
              </button>
            ))}
          </div>

          <div className="max-h-[min(70vh,420px)] overflow-y-auto p-3">
            {tab === 'convert' ? (
              <div className="space-y-3">
                <CoinPicker label="From" value={fromCoin} onChange={setFromCoin} quickCoins={quickCoins} />
                <input
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                  placeholder="Amount"
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white outline-none"
                />
                <CoinPicker label="To" value={toCoin} onChange={setToCoin} quickCoins={quickCoins} />
                <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 px-3 py-2.5 text-xs">
                  {convertResult ? (
                    <>
                      <p className="text-zinc-400">
                        {fmtNum(parsedAmount)} {fromCoin.symbol} ≈{' '}
                        <span className="font-semibold text-emerald-300">
                          {fmtNum(convertResult.out)} {toCoin.symbol}
                        </span>
                      </p>
                      <p className="mt-1 text-[10px] text-zinc-500">
                        ≈ ${fmtNum(convertResult.usd, 2)} USD · prices refresh every ~30s
                      </p>
                    </>
                  ) : (
                    <p className="text-zinc-500">Enter amount and pick coins to convert.</p>
                  )}
                </div>
                <p className="text-[10px] leading-relaxed text-zinc-500">
                  Search any coin on CoinGecko — e.g. $10 USDT → ETH, or 0.5 BTC → SOL.
                </p>
              </div>
            ) : (
              <div className="space-y-2">
                <input
                  value={calcExpr}
                  onChange={(e) => setCalcExpr(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && runCalc()}
                  placeholder="e.g. (100 + 50) * 0.15"
                  className="w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 font-mono text-sm text-white outline-none"
                />
                <div className="grid grid-cols-4 gap-1.5">
                  {['7', '8', '9', '/', '4', '5', '6', '*', '1', '2', '3', '-', '0', '.', '(', '+', ')', 'C', '='].map((k) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => {
                        if (k === 'C') {
                          setCalcExpr('')
                          setCalcResult(null)
                        } else if (k === '=') runCalc()
                        else setCalcExpr((s) => s + k)
                      }}
                      className={`rounded-lg py-2 text-sm font-medium ${
                        k === '='
                          ? 'col-span-2 bg-violet-600 text-white'
                          : k === 'C'
                            ? 'bg-rose-900/40 text-rose-200'
                            : 'bg-white/5 text-zinc-200 hover:bg-white/10'
                      }`}
                    >
                      {k}
                    </button>
                  ))}
                </div>
                {calcResult ? (
                  <p className="rounded-lg border border-white/10 bg-black/30 px-3 py-2 font-mono text-sm text-emerald-300">
                    = {calcResult}
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </div>
      ) : null}
    </>
  )
}
