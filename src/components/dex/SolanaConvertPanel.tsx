'use client'

/**
 * SolanaConvertPanel — Binance-style "Convert" for the Solana personal wallet.
 * Swap any coin you hold into another coin (e.g. leftover BONK → USDC, or
 * USDC → SOL for fees) via Jupiter. Same-chain only, so it needs no operator
 * pools — it just spends the user's own balance.
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
import { dexJupiter } from '@/lib/api'

const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
const SOL_MINT = 'So11111111111111111111111111111111111111112'
const SOL_GAS_RESERVE = 0.003

type WalletToken = Awaited<ReturnType<typeof dexJupiter.walletTokens>>['tokens'][number]
type TokenOpt = { mint: string; symbol: string; decimals: number; amount: number }

function fmtNum(n: number): string {
  if (!Number.isFinite(n)) return '0'
  if (n === 0) return '0'
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 4 })
  return n.toPrecision(6)
}

export function SolanaConvertPanel({
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

  const [tokens, setTokens] = useState<WalletToken[]>([])
  const [market, setMarket] = useState<{ mint: string; symbol: string }[]>([])
  const [loading, setLoading] = useState(false)
  const [fromMint, setFromMint] = useState<string>(USDC_MINT)
  const [toMint, setToMint] = useState<string>(SOL_MINT)
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
      const [walletRes, boardRes] = await Promise.all([
        dexJupiter.walletTokens(),
        dexJupiter.marketBoard(1500).catch(() => ({
          rows: [] as Awaited<ReturnType<typeof dexJupiter.marketBoard>>['rows'],
        })),
      ])
      setTokens((prev) => {
        const next = walletRes.tokens ?? []
        if (!next.length) return prev
        // Keep last-good when RPC collapses a full bag to USDC-only.
        if (prev.length > next.length + 1) return prev
        return next
      })
      const listed = boardRes.rows
        .filter((r) => r.mint && r.tradableOnSolana !== false)
        .map((r) => ({ mint: r.mint as string, symbol: r.baseSymbol ?? r.symbol }))
      setMarket(listed)
    } catch {
      // Keep previous holdings — never flash "No coins held" on a blip.
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  // From: only coins the wallet actually holds.
  const fromOptions: TokenOpt[] = useMemo(
    () =>
      tokens
        .filter((t) => t.amount > 0)
        .map((t) => ({ mint: t.mint, symbol: t.symbol, decimals: t.decimals, amount: t.amount })),
    [tokens],
  )

  // To: USDC + SOL first, then coins you hold, then EVERY listed token. Deduped
  // by mint (first wins, so held balances are kept), minus the From coin.
  const toOptions: TokenOpt[] = useMemo(() => {
    const held = new Map(tokens.map((t) => [t.mint, t]))
    const byMint = new Map<string, TokenOpt>()
    const add = (o: TokenOpt) => {
      if (!o.mint || byMint.has(o.mint)) return
      byMint.set(o.mint, o)
    }
    add({ mint: USDC_MINT, symbol: 'USDC', decimals: 6, amount: held.get(USDC_MINT)?.amount ?? 0 })
    add({ mint: SOL_MINT, symbol: 'SOL', decimals: 9, amount: held.get(SOL_MINT)?.amount ?? 0 })
    for (const t of tokens) add({ mint: t.mint, symbol: t.symbol, decimals: t.decimals, amount: t.amount })
    for (const m of market) add({ mint: m.mint, symbol: m.symbol, decimals: 0, amount: 0 })
    return Array.from(byMint.values()).filter((t) => t.mint !== fromMint)
  }, [tokens, market, fromMint])

  const filteredToOptions: TokenOpt[] = useMemo(() => {
    const q = toSearch.trim().toLowerCase()
    const list = q ? toOptions.filter((t) => t.symbol.toLowerCase().includes(q) || t.mint.toLowerCase().includes(q)) : toOptions
    return list.slice(0, 100)
  }, [toOptions, toSearch])

  // Keep a sensible default From once balances load.
  useEffect(() => {
    if (!open || fromOptions.length === 0) return
    if (!fromOptions.some((o) => o.mint === fromMint)) {
      setFromMint(fromOptions[0].mint)
    }
  }, [open, fromOptions, fromMint])

  // Never let From === To.
  useEffect(() => {
    if (fromMint === toMint) {
      const alt = toOptions[0]?.mint ?? (fromMint === USDC_MINT ? SOL_MINT : USDC_MINT)
      setToMint(alt)
    }
  }, [fromMint, toMint, toOptions])

  const fromToken = useMemo(() => fromOptions.find((o) => o.mint === fromMint), [fromOptions, fromMint])
  const toSymbol = useMemo(
    () => toOptions.find((o) => o.mint === toMint)?.symbol ?? '—',
    [toOptions, toMint],
  )
  const balance = fromToken?.amount ?? 0
  const fromSymbol = fromToken?.symbol ?? '—'

  const parsedAmount = Number(amount)
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0
  const exceedsBalance = validAmount && parsedAmount > balance

  const amountError = useMemo(() => {
    if (!amount) return null
    if (!validAmount) return 'Enter a valid amount'
    if (exceedsBalance) return `You only have ${fmtNum(balance)} ${fromSymbol}`
    return null
  }, [amount, validAmount, exceedsBalance, balance, fromSymbol])

  // Live conversion estimate.
  useEffect(() => {
    if (!open || !validAmount || exceedsBalance || fromMint === toMint) {
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
          const q = await dexJupiter.convertQuote({ fromMint, toMint, amount: parsedAmount })
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
  }, [open, validAmount, exceedsBalance, fromMint, toMint, parsedAmount])

  const setMax = () => {
    if (balance <= 0) return
    const max = fromMint === SOL_MINT ? Math.max(0, balance - SOL_GAS_RESERVE) : balance
    setAmount(String(max))
  }

  const swapSides = () => {
    setFromMint(toMint)
    setToMint(fromMint)
    setAmount('')
    setQuote(null)
    setQuoteError(null)
  }

  const hasQuote = Boolean(quote && quote.outAmount > 0)
  const canSubmit = validAmount && !amountError && fromMint !== toMint && !submitting && hasQuote && !quoting

  const handleConvert = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await dexJupiter.convert({ fromMint, toMint, amount: parsedAmount })
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
          {/* From */}
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
                value={fromMint}
                onChange={(e) => {
                  setFromMint(e.target.value)
                  setAmount('')
                }}
                className="min-w-[110px] rounded-md border border-white/10 bg-black/40 px-2 text-sm text-zinc-100 outline-none"
              >
                {fromOptions.length === 0 ? <option value={USDC_MINT}>No coins held</option> : null}
                {fromOptions.map((o) => (
                  <option key={o.mint} value={o.mint}>
                    {o.symbol}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Swap direction */}
          <div className="flex justify-center">
            <button
              type="button"
              onClick={swapSides}
              className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-zinc-300 hover:bg-white/10"
            >
              ↑↓ Switch
            </button>
          </div>

          {/* To */}
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
                  placeholder="Search token or paste mint…"
                  value={toSearch}
                  onChange={(e) => setToSearch(e.target.value)}
                  className="mb-2 h-8 bg-black/30 text-xs"
                />
                <div className="max-h-52 space-y-0.5 overflow-y-auto">
                  {filteredToOptions.map((o) => (
                    <button
                      key={o.mint}
                      type="button"
                      onClick={() => {
                        setToMint(o.mint)
                        setToPickerOpen(false)
                        setQuote(null)
                        setQuoteError(null)
                      }}
                      className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left text-xs transition ${
                        toMint === o.mint ? 'bg-emerald-500/15 text-emerald-100' : 'text-zinc-200 hover:bg-white/5'
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
