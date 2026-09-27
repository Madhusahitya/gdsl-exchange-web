'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { toast } from 'sonner'
import { CandlestickChart } from '@/components/market/CandlestickChart'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  dexOneInch,
  personalWallet,
  smartExecution,
  type MarketBoardRow,
  type SmartExecutionQuote,
} from '@/lib/api'

const BOARD_POLL_MS = 15_000
const QUOTE_DEBOUNCE_MS = 450

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

function pairLabel(sym: string): string {
  return `${sym.replace(/USDT$/i, '')}/USDT`
}

function DexOneInchContent() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const symbolParam = searchParams.get('symbol')?.toUpperCase() ?? null

  const [rows, setRows] = useState<MarketBoardRow[]>([])
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(symbolParam)
  const [meta, setMeta] = useState<Awaited<ReturnType<typeof dexOneInch.meta>> | null>(null)
  const [tradable, setTradable] = useState<boolean | null>(null)
  const [resolveMsg, setResolveMsg] = useState<string | null>(null)
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [amount, setAmount] = useState('50')
  const [slippagePct, setSlippagePct] = useState('1')
  const [smartQuote, setSmartQuote] = useState<SmartExecutionQuote | null>(null)
  const [quoteBusy, setQuoteBusy] = useState(false)
  const [tradeBusy, setTradeBusy] = useState(false)
  const [walletReady, setWalletReady] = useState(false)
  const [bscOnly, setBscOnly] = useState(true)
  const quoteSeq = useRef(0)

  const catalogSet = useMemo(
    () => new Set((meta?.catalogSymbols ?? []).map((s) => s.toUpperCase())),
    [meta?.catalogSymbols],
  )

  const loadBoard = useCallback(async () => {
    try {
      const res = await dexOneInch.marketBoard(1500)
      setRows(res.rows)
    } catch {
      /* silent on background poll */
    }
  }, [])

  useEffect(() => {
    void loadBoard()
    const id = window.setInterval(() => void loadBoard(), BOARD_POLL_MS)
    return () => window.clearInterval(id)
  }, [loadBoard])

  useEffect(() => {
    void dexOneInch.meta().then(setMeta).catch(() => setMeta(null))
    void personalWallet
      .status()
      .then((s) => setWalletReady(Boolean(s.configured && s.wallet)))
      .catch(() => setWalletReady(false))
  }, [])

  const filtered = useMemo(() => {
    let list = rows
    if (bscOnly && catalogSet.size > 0) {
      list = list.filter((r) => catalogSet.has(r.symbol.toUpperCase()))
    }
    const q = search.trim().toLowerCase()
    if (!q) return list
    return list.filter((r) => r.symbol.toLowerCase().includes(q))
  }, [rows, search, bscOnly, catalogSet])

  useEffect(() => {
    if (symbolParam) setSelected(symbolParam)
  }, [symbolParam])

  useEffect(() => {
    if (filtered.length === 0) return
    if (!selected || !filtered.some((r) => r.symbol === selected)) {
      setSelected(filtered[0]!.symbol)
    }
  }, [filtered, selected])

  useEffect(() => {
    if (!selected) return
    router.replace(`/dex-1inch?symbol=${encodeURIComponent(selected)}`, { scroll: false })
  }, [selected, router])

  useEffect(() => {
    if (!selected) return
    void dexOneInch
      .resolve(selected)
      .then((r) => {
        setTradable(r.tradable)
        setResolveMsg(r.message ?? (r.tradable ? null : 'Not tradable on BSC via 1inch.'))
      })
      .catch((e: unknown) => {
        setTradable(false)
        const ax = e as { response?: { status?: number; data?: { error?: string; message?: string } } }
        const msg = ax.response?.data?.error ?? ax.response?.data?.message
        setResolveMsg(
          msg ??
            (ax.response?.status === 400
              ? 'Invalid pair symbol — try BNB, BTC, or ETH.'
              : 'Could not check BSC route. Refresh the page after server update.'),
        )
      })
  }, [selected])

  const selectedRow = useMemo(
    () => rows.find((r) => r.symbol === selected) ?? null,
    [rows, selected],
  )

  const slippageBps = useMemo(() => {
    const n = Number.parseFloat(slippagePct)
    if (!Number.isFinite(n)) return 100
    return Math.max(10, Math.min(2000, Math.round(n * 100)))
  }, [slippagePct])

  useEffect(() => {
    if (!selected || tradable === false) {
      setSmartQuote(null)
      return
    }
    const amt = Number.parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      setSmartQuote(null)
      return
    }
    const seq = ++quoteSeq.current
    const t = window.setTimeout(() => {
      void (async () => {
        setQuoteBusy(true)
        try {
          const q = await smartExecution.quote({
            binanceSymbol: selected,
            side,
            amount: amt,
            slippageBps,
          })
          if (seq !== quoteSeq.current) return
          setSmartQuote(q)
        } catch (e: unknown) {
          if (seq !== quoteSeq.current) return
          const ax = e as { response?: { data?: { error?: string } } }
          setSmartQuote(null)
          setResolveMsg(ax.response?.data?.error ?? 'Quote failed')
        } finally {
          if (seq === quoteSeq.current) setQuoteBusy(false)
        }
      })()
    }, QUOTE_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [selected, side, amount, slippageBps, tradable])

  const execute = async () => {
    if (!selected) return
    const amt = Number.parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (tradable === false) {
      toast.error(resolveMsg ?? 'Pair not tradable on BSC')
      return
    }
    if (!smartQuote?.recommended) {
      toast.error(smartQuote?.blockReason ?? 'No executable route — connect Binance or fund BSC wallet.')
      return
    }
    if (smartQuote.blockTrade) {
      toast.error(smartQuote.blockReason ?? 'Trade blocked')
      return
    }
    const venue = smartQuote.recommended
    if (venue === 'oneinch_bsc' && !walletReady) {
      toast.error('Create your personal wallet under Wallet for the BSC leg.')
      return
    }
    setTradeBusy(true)
    try {
      const res = await smartExecution.swap({
        side,
        binanceSymbol: selected,
        amount: amt,
        slippageBps,
        venue,
      })
      const tail = res.txHash?.slice(0, 10) ?? res.orderId?.slice(0, 8) ?? 'ok'
      toast.success(
        `${side} via ${venue === 'binance' ? 'Binance' : '1inch BSC'} · ${tail}…`,
      )
      setSmartQuote(null)
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      toast.error(ax.response?.data?.error ?? 'Swap failed')
    } finally {
      setTradeBusy(false)
    }
  }

  return (
    <div className="flex h-[calc(100dvh-3.5rem)] min-h-[520px] flex-col gap-2 p-2 sm:p-3 lg:flex-row">
      <aside className="flex w-full flex-col rounded-xl border border-white/10 bg-[#050508] lg:w-56 xl:w-64">
        <div className="border-b border-white/10 p-2">
          <p className="text-xs font-semibold text-white">DEX 1inch · BSC</p>
          <p className="text-[10px] text-zinc-500">Aggregator · not Pancake</p>
          <input
            className="mt-2 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-white"
            placeholder="Search…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <label className="mt-2 flex items-center gap-2 text-[10px] text-zinc-400">
            <input
              type="checkbox"
              checked={bscOnly}
              onChange={(e) => setBscOnly(e.target.checked)}
              className="rounded"
            />
            BSC-tradable only ({catalogSet.size || '…'})
          </label>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto">
          {filtered.map((r) => (
            <button
              key={r.symbol}
              type="button"
              onClick={() => setSelected(r.symbol)}
              className={`flex w-full items-center justify-between border-b border-white/5 px-2 py-2 text-left text-xs ${
                selected === r.symbol ? 'bg-emerald-500/10' : 'hover:bg-white/5'
              }`}
            >
              <span className="text-zinc-200">{pairLabel(r.symbol)}</span>
              <span
                className={`font-mono ${r.priceChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}
              >
                {fmtPct(r.priceChangePercent)}
              </span>
            </button>
          ))}
        </div>
        <div className="border-t border-white/10 p-2">
          <Link href="/overview" className="text-[11px] text-emerald-400 hover:underline">
            Full overview →
          </Link>
        </div>
      </aside>

      <main className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
        {selectedRow ? (
          <div className="flex flex-wrap items-center gap-3 rounded-lg border border-white/10 bg-[#0a0a0f] px-3 py-2">
            <span className="text-lg font-semibold text-white">{pairLabel(selectedRow.symbol)}</span>
            <span className="font-mono text-white">${fmtPrice(selectedRow.lastPrice)}</span>
            <span
              className={`font-mono text-sm ${
                selectedRow.priceChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'
              }`}
            >
              {fmtPct(selectedRow.priceChangePercent)}
            </span>
            <span className="text-xs text-zinc-500">24h H {fmtPrice(selectedRow.highPrice)}</span>
            <span className="text-xs text-zinc-500">L {fmtPrice(selectedRow.lowPrice)}</span>
          </div>
        ) : null}
        <div className="min-h-[240px] flex-1">
          {selected ? (
            <CandlestickChart
              symbol={selected}
              pairLabel={selected ? pairLabel(selected) : undefined}
              defaultInterval="15m"
              pollMs={4_000}
            />
          ) : null}
        </div>
      </main>

      <aside className="flex w-full flex-col gap-2 rounded-xl border border-white/10 bg-[#0a0a0f] p-3 lg:w-72">
        <h2 className="text-sm font-semibold text-white">Trade · Smart router</h2>
        {!meta?.oneInchConfigured ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-2 text-xs text-amber-200">
            {meta?.setupHint ??
              'ONEINCH_API_KEY is empty on the server. Edit /opt/trade_bot/.env then run: docker compose up -d api'}
          </p>
        ) : null}
        {tradable === false ? (
          <p className="text-xs text-rose-300">{resolveMsg}</p>
        ) : tradable ? (
          <p className="text-xs text-emerald-400/90">BSC route available</p>
        ) : null}

        <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 p-0.5">
          {(['BUY', 'SELL'] as const).map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => setSide(s)}
              className={`rounded-md py-2 text-sm font-medium ${
                side === s
                  ? s === 'BUY'
                    ? 'bg-emerald-600 text-white'
                    : 'bg-rose-600 text-white'
                  : 'text-zinc-400'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        <label className="text-[11px] text-zinc-400">
          {side === 'BUY' ? 'USDT amount' : 'Token amount'}
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="mt-1 border-white/10 bg-black/40 font-mono"
          />
        </label>
        <label className="text-[11px] text-zinc-400">
          Slippage %
          <Input
            value={slippagePct}
            onChange={(e) => setSlippagePct(e.target.value)}
            className="mt-1 border-white/10 bg-black/40 font-mono"
          />
        </label>

        {quoteBusy ? <p className="text-xs text-zinc-500">Comparing Binance vs 1inch…</p> : null}
        {smartQuote ? (
          <div className="space-y-2 rounded-lg border border-white/10 bg-black/30 p-2 text-xs">
            {smartQuote.binanceMid != null ? (
              <p className="text-zinc-400">
                Binance mid: <span className="font-mono text-zinc-200">${fmtPrice(smartQuote.binanceMid)}</span>
              </p>
            ) : null}
            {(['binance', 'oneinch'] as const).map((key) => {
              const v = smartQuote.venues[key]
              const label = key === 'binance' ? 'Binance Spot' : '1inch BSC'
              const picked = smartQuote.recommended === (key === 'binance' ? 'binance' : 'oneinch_bsc')
              return (
                <div
                  key={key}
                  className={`rounded border px-2 py-1.5 ${picked ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-white/5'}`}
                >
                  <p className="font-medium text-zinc-200">
                    {label}
                    {picked ? <span className="ml-1 text-emerald-400">← best</span> : null}
                  </p>
                  {v.available && v.executablePrice != null ? (
                    <>
                      <p className="text-zinc-400">
                        Exec: <span className="font-mono text-white">${fmtPrice(v.executablePrice)}</span>
                        {v.priceVsBinanceMidBps != null ? (
                          <span className="ml-1 text-zinc-500">
                            ({v.priceVsBinanceMidBps >= 0 ? '+' : ''}
                            {(v.priceVsBinanceMidBps / 100).toFixed(2)}% vs mid)
                          </span>
                        ) : null}
                      </p>
                      <p className="text-zinc-500">
                        Est. out: {v.amountOutHuman.toPrecision(5)}{' '}
                        {side === 'BUY'
                          ? (selected ? pairLabel(selected).split('/')[0] : 'tokens')
                          : ' USDT'}
                      </p>
                    </>
                  ) : (
                    <p className="text-amber-300/90">{v.reason ?? 'Unavailable'}</p>
                  )}
                </div>
              )
            })}
            {smartQuote.savingsVsOtherUsd > 0.01 && smartQuote.recommended ? (
              <p className="text-emerald-300/90">
                Saves ~${smartQuote.savingsVsOtherUsd.toFixed(2)} vs the other venue
                {smartQuote.savingsVsOtherBps != null
                  ? ` (${(smartQuote.savingsVsOtherBps / 100).toFixed(2)}%)`
                  : ''}
              </p>
            ) : null}
            {smartQuote.blockTrade && smartQuote.blockReason ? (
              <p className="text-rose-300/90">{smartQuote.blockReason}</p>
            ) : null}
          </div>
        ) : null}

        <Button
          disabled={
            tradeBusy ||
            tradable === false ||
            !smartQuote?.recommended ||
            smartQuote.blockTrade
          }
          onClick={() => void execute()}
          className={side === 'BUY' ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-rose-600 hover:bg-rose-500'}
        >
          {tradeBusy
            ? 'Submitting…'
            : smartQuote?.recommended === 'binance'
              ? `${side} via Binance`
              : `${side} via 1inch`}
        </Button>
        <Link href="/dex" className="text-[11px] text-zinc-400 hover:text-white">
          ← PancakeSwap DEX (unchanged)
        </Link>
      </aside>
    </div>
  )
}

export default function DexOneInchPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-zinc-500">Loading DEX 1inch…</div>}>
      <DexOneInchContent />
    </Suspense>
  )
}
