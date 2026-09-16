'use client'

/**
 * BscConvertPanel — same-chain token swap for the BSC personal wallet via Pancake.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { personalWallet, type PersonalWalletSummary } from '@/lib/api'

const FALLBACK_BSC_TOKENS = ['USDC', 'USDT', 'BNB', 'BTCB', 'ETH', 'XRP', 'DOGE', 'SOL', 'LINK', 'ADA', 'DOT', 'AVAX', 'MATIC', 'NEAR', 'LTC']
const BNB_GAS_RESERVE = 0.00025

type TokenOpt = { symbol: string; amount: number }

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n === 0) return '0'
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return n.toPrecision(6)
}

export function BscConvertPanel({
  open: openProp,
  onOpenChange,
  hideTrigger = false,
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  const [summary, setSummary] = useState<PersonalWalletSummary | null>(null)
  const [catalog, setCatalog] = useState<string[]>(FALLBACK_BSC_TOKENS)
  const [loading, setLoading] = useState(false)
  const [fromSymbol, setFromSymbol] = useState('USDC')
  const [toSymbol, setToSymbol] = useState('BNB')
  const [toPickerOpen, setToPickerOpen] = useState(false)
  const [toSearch, setToSearch] = useState('')
  const [amount, setAmount] = useState('')
  const [quote, setQuote] = useState<{ outAmount: number; rate: number } | null>(null)
  const [quoteError, setQuoteError] = useState<string | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const quoteSeq = useRef(0)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [res, cat] = await Promise.all([
        personalWallet.status(),
        personalWallet.convertCatalog().catch(() => ({ items: FALLBACK_BSC_TOKENS.map((symbol) => ({ symbol })) })),
      ])
      setSummary(res.wallet ?? null)
      setCatalog(cat.items.map((i) => i.symbol))
    } catch {
      setSummary(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  const fromOptions: TokenOpt[] = useMemo(() => {
    const held = new Map((summary?.balances ?? []).map((b) => [b.asset.toUpperCase(), Number(b.amount)]))
    return [...held.entries()]
      .filter(([, amt]) => amt > 0)
      .map(([symbol, amount]) => ({ symbol, amount }))
      .sort((a, b) => b.amount - a.amount)
  }, [summary])

  const toOptions: TokenOpt[] = useMemo(() => {
    const held = new Map((summary?.balances ?? []).map((b) => [b.asset.toUpperCase(), Number(b.amount)]))
    return catalog
      .filter((s) => s !== fromSymbol)
      .map((symbol) => ({
        symbol,
        amount: held.get(symbol) ?? 0,
      }))
      .sort((a, b) => {
        if (a.amount > 0 !== b.amount > 0) return a.amount > 0 ? -1 : 1
        return a.symbol.localeCompare(b.symbol)
      })
  }, [summary, fromSymbol, catalog])

  const filteredToOptions = useMemo(() => {
    const q = toSearch.trim().toLowerCase()
    const list = q ? toOptions.filter((t) => t.symbol.toLowerCase().includes(q)) : toOptions
    return list.slice(0, 50)
  }, [toOptions, toSearch])

  useEffect(() => {
    if (!open || fromOptions.length === 0) return
    if (!fromOptions.some((o) => o.symbol === fromSymbol)) {
      setFromSymbol(fromOptions[0]!.symbol)
    }
  }, [open, fromOptions, fromSymbol])

  useEffect(() => {
    if (fromSymbol === toSymbol) {
      const alt = toOptions.find((o) => o.symbol !== fromSymbol)?.symbol ?? 'USDC'
      setToSymbol(alt)
    }
  }, [fromSymbol, toSymbol, toOptions])

  const balance = fromOptions.find((o) => o.symbol === fromSymbol)?.amount ?? 0
  const parsedAmount = Number(amount)
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0
  const exceedsBalance = validAmount && parsedAmount > balance

  const amountError = useMemo(() => {
    if (!amount) return null
    if (!validAmount) return 'Enter a valid amount'
    if (exceedsBalance) return `You only have ${fmtNum(balance)} ${fromSymbol}`
    return null
  }, [amount, validAmount, exceedsBalance, balance, fromSymbol])

  useEffect(() => {
    if (!open || !validAmount || exceedsBalance || fromSymbol === toSymbol) {
      setQuote(null)
      setQuoteError(null)
      return
    }
    const seq = ++quoteSeq.current
    const t = window.setTimeout(() => {
      void (async () => {
        setQuoting(true)
        setQuoteError(null)
        try {
          const q = await personalWallet.convertQuote({ fromSymbol, toSymbol, amount: parsedAmount })
          if (seq !== quoteSeq.current) return
          setQuote({ outAmount: q.outAmount, rate: q.rate })
          setQuoteError(null)
        } catch (e) {
          if (seq !== quoteSeq.current) return
          setQuote(null)
          const ax = e as { response?: { data?: { error?: string } } }
          setQuoteError(ax.response?.data?.error ?? (e as Error).message ?? 'Could not quote this pair')
        } finally {
          if (seq === quoteSeq.current) setQuoting(false)
        }
      })()
    }, 500)
    return () => window.clearTimeout(t)
  }, [open, validAmount, exceedsBalance, fromSymbol, toSymbol, parsedAmount])

  const setMax = () => {
    if (balance <= 0) return
    const max = fromSymbol === 'BNB' ? Math.max(0, balance - BNB_GAS_RESERVE) : balance
    setAmount(String(max))
  }

  const swapSides = () => {
    const nextFrom = toSymbol
    const nextTo = fromSymbol
    setFromSymbol(nextFrom)
    setToSymbol(nextTo)
    setAmount('')
    setQuote(null)
    setQuoteError(null)
  }

  const hasQuote = Boolean(quote && quote.outAmount > 0)
  const canSubmit = validAmount && !amountError && fromSymbol !== toSymbol && !submitting && hasQuote && !quoting

  const handleConvert = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await personalWallet.convert({ fromSymbol, toSymbol, amount: parsedAmount })
      toast.success(`Converted ${fmtNum(res.inAmount)} ${fromSymbol} → ${fmtNum(res.outAmount)} ${toSymbol}`)
      setAmount('')
      setQuote(null)
      await refresh()
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } } }
      toast.error(ax.response?.data?.error ?? (e as Error).message ?? 'Convert failed')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hideTrigger ? null : (
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-full border-emerald-500/40 text-[11px] text-emerald-200 hover:bg-emerald-500/10"
          >
            Convert coins
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-md border-white/10 bg-[#0a0a0f]">
        <DialogHeader>
          <DialogTitle>Convert</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span>From</span>
              <span>
                Balance: {fmtNum(balance)} {fromSymbol}
                <button type="button" onClick={setMax} className="ml-2 text-emerald-300 hover:text-emerald-200">
                  Max
                </button>
              </span>
            </div>
            <div className="flex gap-2">
              <Input
                inputMode="decimal"
                placeholder="0.0"
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                className="bg-black/30 font-mono"
              />
              <select
                value={fromSymbol}
                onChange={(e) => {
                  setFromSymbol(e.target.value)
                  setAmount('')
                }}
                className="min-w-[110px] rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-100 outline-none"
              >
                {fromOptions.length === 0 ? <option value="USDC">No coins held</option> : null}
                {fromOptions.map((o) => (
                  <option key={o.symbol} value={o.symbol}>
                    {o.symbol}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="flex justify-center">
            <button
              type="button"
              onClick={swapSides}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300 hover:bg-white/10"
            >
              ↑↓ Switch
            </button>
          </div>

          <div className="space-y-1.5 rounded-xl border border-white/10 bg-white/[0.02] p-3">
            <div className="flex items-center justify-between text-[11px] text-zinc-400">
              <span>To (estimated)</span>
              {quoting ? <span className="text-zinc-500">quoting…</span> : null}
            </div>
            <div className="flex gap-2">
              <div className="flex h-9 flex-1 items-center rounded-md border border-white/10 bg-black/20 px-3 font-mono text-sm text-emerald-300">
                {quote ? fmtNum(quote.outAmount) : '0.0'}
              </div>
              <button
                type="button"
                onClick={() => {
                  setToSearch('')
                  setToPickerOpen((v) => !v)
                }}
                className="flex min-w-[110px] items-center justify-between gap-1 rounded-md border border-white/10 bg-black/40 px-2.5 text-sm text-zinc-100 hover:bg-white/5"
              >
                <span className="font-mono">{toSymbol}</span>
                <span className="text-zinc-500">▾</span>
              </button>
            </div>
            {toPickerOpen ? (
              <div className="mt-2 rounded-lg border border-white/10 bg-black/40 p-2">
                <Input
                  autoFocus
                  placeholder="Search symbol…"
                  value={toSearch}
                  onChange={(e) => setToSearch(e.target.value)}
                  className="mb-2 h-8 bg-black/30 text-xs"
                />
                <div className="max-h-52 space-y-0.5 overflow-y-auto">
                  {filteredToOptions.map((o) => (
                    <button
                      key={o.symbol}
                      type="button"
                      onClick={() => {
                        setToSymbol(o.symbol)
                        setToPickerOpen(false)
                        setQuote(null)
                        setQuoteError(null)
                      }}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition ${
                        toSymbol === o.symbol ? 'bg-emerald-500/15 text-emerald-100' : 'text-zinc-200 hover:bg-white/5'
                      }`}
                    >
                      <span className="font-medium">{o.symbol}</span>
                      <span className="font-mono text-[10px] text-zinc-500">
                        {o.amount > 0 ? `${fmtNum(o.amount)} held` : 'Available · swap to'}
                      </span>
                    </button>
                  ))}
                  {filteredToOptions.length === 0 ? (
                    <p className="px-2 py-2 text-[11px] text-zinc-500">No matching token.</p>
                  ) : null}
                </div>
              </div>
            ) : null}
            {quote && quote.rate > 0 ? (
              <p className="text-[10px] text-zinc-500">
                1 {fromSymbol} ≈ {fmtNum(quote.rate)} {toSymbol}
              </p>
            ) : null}
          </div>

          {amountError ? <p className="text-[11px] text-rose-400">{amountError}</p> : null}
          {quoteError && validAmount && !amountError ? (
            <p className="text-[11px] text-rose-400">{quoteError}</p>
          ) : null}
          {validAmount && !amountError && !quoteError && !hasQuote && !quoting ? (
            <p className="text-[11px] text-zinc-500">Enter amount to see estimated receive amount.</p>
          ) : null}

          <Button
            type="button"
            disabled={!canSubmit}
            onClick={() => void handleConvert()}
            className="w-full rounded-xl bg-emerald-500 font-semibold text-black hover:bg-emerald-400 disabled:opacity-50"
          >
            {submitting
              ? 'Converting…'
              : quoting
                ? 'Getting quote…'
                : `Convert ${fromSymbol} → ${toSymbol}`}
          </Button>

          <button
            type="button"
            onClick={() => void refresh()}
            disabled={loading}
            className="mx-auto block text-[11px] text-zinc-500 hover:text-zinc-300"
          >
            {loading ? 'Refreshing…' : 'Refresh balances'}
          </button>
        </div>
      </DialogContent>
    </Dialog>
  )
}
