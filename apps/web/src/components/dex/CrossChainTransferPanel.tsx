'use client'

/**
 * CrossChainTransferPanel — same-token cross-chain transfer (ETH→ETH, BTC→BTC, etc.)
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
import { personalWallet } from '@/lib/api'

type Direction = 'BSC_TO_SOL' | 'SOL_TO_BSC'
type Status = Awaited<ReturnType<typeof personalWallet.crossChainStatus>>
type SourceAsset = Awaited<ReturnType<typeof personalWallet.crossChainAssets>>['items'][number]
type TransferRow = Awaited<ReturnType<typeof personalWallet.crossChainTransfers>>['items'][number]
type TransferPreview = Awaited<ReturnType<typeof personalWallet.crossChainQuote>>

function shortRef(ref: string): string {
  if (ref.length <= 16) return ref
  return `${ref.slice(0, 8)}…${ref.slice(-6)}`
}

function explorerUrl(ref: string, chain: 'BSC' | 'SOL'): string {
  return chain === 'BSC' ? `https://bscscan.com/tx/${ref}` : `https://solscan.io/tx/${ref}`
}

function legChains(direction: Direction): { debit: 'BSC' | 'SOL'; credit: 'BSC' | 'SOL' } {
  return direction === 'BSC_TO_SOL' ? { debit: 'BSC', credit: 'SOL' } : { debit: 'SOL', credit: 'BSC' }
}

function apiErrorMessage(e: unknown): string {
  const ax = e as { response?: { data?: { error?: string } }; message?: string }
  return ax.response?.data?.error ?? ax.message ?? 'Transfer failed'
}

export function CrossChainTransferPanel({
  open: openProp,
  onOpenChange,
  hideTrigger = false,
  defaultDirection = 'BSC_TO_SOL',
}: {
  open?: boolean
  onOpenChange?: (open: boolean) => void
  hideTrigger?: boolean
  defaultDirection?: Direction
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen

  const [status, setStatus] = useState<Status | null>(null)
  const [assets, setAssets] = useState<SourceAsset[]>([])
  const [assetSearch, setAssetSearch] = useState('')
  const [tokenMenuOpen, setTokenMenuOpen] = useState(false)
  const [selectedSymbol, setSelectedSymbol] = useState('USDC')
  // Destination coin. `null` follows the source (same-token bridge).
  const [destSymbol, setDestSymbol] = useState<string | null>(null)
  const [destMenuOpen, setDestMenuOpen] = useState(false)
  const [destSearch, setDestSearch] = useState('')
  const [loading, setLoading] = useState(false)
  const [direction, setDirection] = useState<Direction>(defaultDirection)
  const [amount, setAmount] = useState('')
  const [preview, setPreview] = useState<TransferPreview | null>(null)
  const [quoting, setQuoting] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [history, setHistory] = useState<TransferRow[]>([])
  const tokenMenuRef = useRef<HTMLDivElement>(null)
  const destMenuRef = useRef<HTMLDivElement>(null)
  const quoteSeq = useRef(0)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [st, tx, ast] = await Promise.all([
        personalWallet.crossChainStatus(direction),
        personalWallet.crossChainTransfers().catch(() => ({ items: [] as TransferRow[] })),
        personalWallet.crossChainAssets(direction).catch(() => ({ items: [] as SourceAsset[] })),
      ])
      setStatus(st)
      setHistory(tx.items)
      setAssets(ast.items)
      setSelectedSymbol((prev) => {
        if (ast.items.some((a) => a.symbol === prev)) return prev
        const usdc = ast.items.find((a) => a.symbol === 'USDC')
        return usdc?.symbol ?? ast.items[0]?.symbol ?? 'USDC'
      })
    } catch {
      setStatus(null)
    } finally {
      setLoading(false)
    }
  }, [direction])

  useEffect(() => {
    if (!open) return
    setTokenMenuOpen(false)
    setDestMenuOpen(false)
    setDestSymbol(null)
    setDirection(defaultDirection)
  }, [open, defaultDirection])

  useEffect(() => {
    if (!open) return
    void refresh()
  }, [direction, open, refresh])

  useEffect(() => {
    if (!tokenMenuOpen && !destMenuOpen) return
    const onDocClick = (e: MouseEvent) => {
      if (tokenMenuOpen && tokenMenuRef.current && !tokenMenuRef.current.contains(e.target as Node)) {
        setTokenMenuOpen(false)
      }
      if (destMenuOpen && destMenuRef.current && !destMenuRef.current.contains(e.target as Node)) {
        setDestMenuOpen(false)
      }
    }
    document.addEventListener('mousedown', onDocClick)
    return () => document.removeEventListener('mousedown', onDocClick)
  }, [tokenMenuOpen, destMenuOpen])

  const selectedAsset = assets.find((a) => a.symbol === selectedSymbol) ?? assets[0]
  const canTransferToken = selectedAsset?.crossChainReady === true
  const sourceCanonical = selectedAsset?.destinationSymbol ?? selectedSymbol
  const effectiveDest = destSymbol ?? sourceCanonical
  const isCrossToken = effectiveDest !== sourceCanonical
  const destOptions = useMemo(() => {
    const set = new Set<string>(status?.supportedSymbols ?? [])
    if (sourceCanonical) set.add(sourceCanonical)
    return [...set].sort()
  }, [status?.supportedSymbols, sourceCanonical])

  const feeUsd = status?.feeUsd ?? preview?.feeUsd ?? 0.1
  const minUsd = status?.minAmount ?? 1
  const maxUsd = status?.maxAmount ?? 5000

  const parsedAmount = Number(amount)
  const validAmount = Number.isFinite(parsedAmount) && parsedAmount > 0
  const youReceive = preview?.creditAmount ?? 0
  const estUsd =
    preview?.tokenUsdPrice && validAmount ? parsedAmount * preview.tokenUsdPrice : selectedAsset?.usdValue ?? null

  useEffect(() => {
    if (!open || !validAmount || !selectedSymbol || !canTransferToken) {
      setPreview(null)
      return
    }
    const seq = ++quoteSeq.current
    const t = window.setTimeout(() => {
      void (async () => {
        setQuoting(true)
        try {
          const q = await personalWallet.crossChainQuote({
            amount: parsedAmount,
            direction,
            sourceSymbol: selectedSymbol,
            destSymbol: effectiveDest,
          })
          if (seq !== quoteSeq.current) return
          setPreview(q)
        } catch {
          if (seq !== quoteSeq.current) return
          setPreview(null)
        } finally {
          if (seq === quoteSeq.current) setQuoting(false)
        }
      })()
    }, 500)
    return () => window.clearTimeout(t)
  }, [open, validAmount, parsedAmount, direction, selectedSymbol, effectiveDest, canTransferToken])

  const amountError = useMemo(() => {
    if (!canTransferToken) return null
    if (!amount) return null
    if (!validAmount) return 'Enter a valid amount'
    if (selectedAsset && parsedAmount > selectedAsset.balance) {
      return `You only have ${selectedAsset.balance.toPrecision(6)} ${selectedSymbol}`
    }
    if (estUsd != null && estUsd < minUsd) {
      return `Minimum transfer is about $${minUsd} (yours ≈ $${estUsd.toFixed(2)})`
    }
    if (estUsd != null && estUsd > maxUsd) {
      return `Maximum transfer is about $${maxUsd}`
    }
    if (preview && youReceive <= 0) return 'Amount is too small after the settlement fee'
    return null
  }, [amount, validAmount, parsedAmount, selectedAsset, selectedSymbol, preview, estUsd, minUsd, maxUsd, youReceive, canTransferToken])

  const bridgeNote = useMemo(() => {
    if (!status?.enabled || !canTransferToken) return null
    if (isCrossToken) {
      return `Your ${selectedSymbol} is sent on the source chain, then swapped & bridged to ${effectiveDest} on the destination chain in one route. The received amount is an estimate (market rate + ~3% max slippage). Settlement usually takes 1–5 minutes.`
    }
    return `Your ${selectedSymbol} is sent on the source chain, then bridged to your ${effectiveDest} on the destination chain. No pre-funded pool needed — settlement usually takes 1–5 minutes.`
  }, [status, canTransferToken, selectedSymbol, effectiveDest, isCrossToken])

  const filteredAssets = useMemo(() => {
    const q = assetSearch.trim().toLowerCase()
    if (!q) return assets
    return assets.filter((a) => a.symbol.toLowerCase().includes(q))
  }, [assets, assetSearch])

  const filteredDestOptions = useMemo(() => {
    const q = destSearch.trim().toLowerCase()
    if (!q) return destOptions
    return destOptions.filter((s) => s.toLowerCase().includes(q))
  }, [destOptions, destSearch])

  const canSubmit =
    Boolean(status?.enabled) &&
    canTransferToken &&
    validAmount &&
    !amountError &&
    !submitting &&
    Boolean(preview)

  const handleTransfer = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    try {
      const res = await personalWallet.crossChainTransfer({
        direction,
        amount: parsedAmount,
        sourceSymbol: selectedSymbol,
        destSymbol: effectiveDest,
      })
      toast.success(
        `Transferred — ${res.creditAmount} ${effectiveDest} credited on ${direction === 'BSC_TO_SOL' ? 'Solana' : 'BSC'}`,
      )
      setAmount('')
      setPreview(null)
      await refresh()
    } catch (e) {
      toast.error(apiErrorMessage(e))
    } finally {
      setSubmitting(false)
    }
  }

  const fromLabel = direction === 'BSC_TO_SOL' ? 'BSC' : 'Solana'
  const toLabel = direction === 'BSC_TO_SOL' ? 'Solana' : 'BSC'

  const pickToken = (symbol: string) => {
    setSelectedSymbol(symbol)
    setTokenMenuOpen(false)
    setAssetSearch('')
    setDestSymbol(null)
    setAmount('')
    setPreview(null)
  }

  const pickDest = (symbol: string) => {
    setDestSymbol(symbol)
    setDestMenuOpen(false)
    setDestSearch('')
    setPreview(null)
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hideTrigger ? null : (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 w-full border-sky-500/40 text-[11px] text-sky-200 hover:bg-sky-500/10">
            Transfer · BSC ↔ Solana
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-md border-white/10 bg-[#0a0a0f]">
        <DialogHeader>
          <DialogTitle>Transfer between wallets</DialogTitle>
        </DialogHeader>

        {status && !status.enabled ? (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-200">
            {status.message ?? 'Cross-chain transfer is not available on this server yet.'}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-2">
              <Button
                type="button"
                variant="outline"
                className={`rounded-xl ${
                  direction === 'BSC_TO_SOL'
                    ? 'border-sky-500/50 bg-sky-500/15 text-sky-100'
                    : 'border-white/10 bg-white/[0.03] text-zinc-300'
                }`}
                onClick={() => {
                  setTokenMenuOpen(false)
                  setDestMenuOpen(false)
                  setDestSymbol(null)
                  setAmount('')
                  setPreview(null)
                  setDirection('BSC_TO_SOL')
                }}
              >
                BSC → Solana
              </Button>
              <Button
                type="button"
                variant="outline"
                className={`rounded-xl ${
                  direction === 'SOL_TO_BSC'
                    ? 'border-violet-500/50 bg-violet-500/15 text-violet-100'
                    : 'border-white/10 bg-white/[0.03] text-zinc-300'
                }`}
                onClick={() => {
                  setTokenMenuOpen(false)
                  setDestMenuOpen(false)
                  setDestSymbol(null)
                  setAmount('')
                  setPreview(null)
                  setDirection('SOL_TO_BSC')
                }}
              >
                Solana → BSC
              </Button>
            </div>

            <div className="space-y-1.5" ref={tokenMenuRef}>
              <label className="text-xs text-zinc-400">Token on {fromLabel} wallet</label>
              <button
                type="button"
                onClick={() => setTokenMenuOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-black/30 px-3 py-2.5 text-left text-sm hover:border-violet-500/40"
              >
                <span className="flex items-center gap-2">
                  <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[10px] font-bold text-violet-200">
                    {selectedSymbol}
                  </span>
                  {selectedAsset ? (
                    <span className="font-mono text-[11px] text-zinc-400">
                      {selectedAsset.balance.toPrecision(6)}
                      {selectedAsset.usdValue != null ? ` · $${selectedAsset.usdValue.toFixed(2)}` : ''}
                    </span>
                  ) : (
                    <span className="text-[11px] text-zinc-500">{loading ? 'Loading…' : 'Select token'}</span>
                  )}
                </span>
                <span className="text-zinc-500">{tokenMenuOpen ? '▲' : '▼'}</span>
              </button>

              {tokenMenuOpen ? (
                <div className="rounded-lg border border-violet-500/30 bg-[#0d0d14] p-2 shadow-xl">
                  <Input
                    autoFocus
                    placeholder="Search symbol (ETH, BTC, SOL…)"
                    value={assetSearch}
                    onChange={(e) => setAssetSearch(e.target.value)}
                    className="mb-2 h-8 border-white/10 bg-black/40 text-xs"
                  />
                  <div className="max-h-44 space-y-0.5 overflow-y-auto">
                    {filteredAssets.length === 0 ? (
                      <p className="px-2 py-3 text-center text-[11px] text-zinc-500">
                        {loading ? 'Loading tokens…' : `No tokens with balance on ${fromLabel}.`}
                      </p>
                    ) : (
                      filteredAssets.map((a) => (
                        <button
                          key={a.symbol}
                          type="button"
                          onClick={() => pickToken(a.symbol)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[11px] ${
                            selectedSymbol === a.symbol
                              ? 'bg-violet-500/20 ring-1 ring-violet-400/50'
                              : 'hover:bg-white/5'
                          }`}
                        >
                          <span className="min-w-[3rem] rounded bg-white/5 px-1.5 py-0.5 text-center font-bold text-zinc-100">
                            {a.symbol}
                          </span>
                          <span className="min-w-0 flex-1 font-mono text-zinc-400">
                            {a.balance.toPrecision(6)}
                            {a.usdValue != null ? ` · $${a.usdValue.toFixed(2)}` : ''}
                          </span>
                          {a.crossChainReady ? (
                            <span className="rounded bg-emerald-500/20 px-1.5 text-[9px] text-emerald-300">Same token</span>
                          ) : (
                            <span className="rounded bg-zinc-700/50 px-1.5 text-[9px] text-zinc-400">Convert first</span>
                          )}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}

              {!canTransferToken && selectedAsset ? (
                <div className="rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
                  {selectedAsset.hint ?? 'This token cannot cross-chain yet. Use Convert to swap to USDC/ETH first.'}
                </div>
              ) : null}
            </div>

            {canTransferToken ? (
            <>
            {/* DESTINATION COIN — pick the coin you receive on the other chain */}
            <div className="space-y-1.5" ref={destMenuRef}>
              <label className="text-xs text-zinc-400">Receive on {toLabel} wallet</label>
              <button
                type="button"
                onClick={() => setDestMenuOpen((v) => !v)}
                className="flex w-full items-center justify-between rounded-lg border border-white/15 bg-black/30 px-3 py-2.5 text-left text-sm hover:border-sky-500/40"
              >
                <span className="flex items-center gap-2">
                  <span className="rounded bg-sky-500/20 px-1.5 py-0.5 text-[10px] font-bold text-sky-200">
                    {effectiveDest}
                  </span>
                  <span className="text-[11px] text-zinc-500">
                    {isCrossToken ? 'Swap + bridge (estimated)' : 'Same token · lowest fee'}
                  </span>
                </span>
                <span className="text-zinc-500">{destMenuOpen ? '▲' : '▼'}</span>
              </button>

              {destMenuOpen ? (
                <div className="rounded-lg border border-sky-500/30 bg-[#0d0d14] p-2 shadow-xl">
                  <Input
                    autoFocus
                    placeholder="Search coin to receive (USDC, ETH, SOL…)"
                    value={destSearch}
                    onChange={(e) => setDestSearch(e.target.value)}
                    className="mb-2 h-8 border-white/10 bg-black/40 text-xs"
                  />
                  <div className="max-h-44 space-y-0.5 overflow-y-auto">
                    {filteredDestOptions.length === 0 ? (
                      <p className="px-2 py-3 text-center text-[11px] text-zinc-500">
                        {loading ? 'Loading coins…' : 'No destination coins available.'}
                      </p>
                    ) : (
                      filteredDestOptions.map((sym) => (
                        <button
                          key={sym}
                          type="button"
                          onClick={() => pickDest(sym)}
                          className={`flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-[11px] ${
                            effectiveDest === sym
                              ? 'bg-sky-500/20 ring-1 ring-sky-400/50'
                              : 'hover:bg-white/5'
                          }`}
                        >
                          <span className="min-w-[3rem] rounded bg-white/5 px-1.5 py-0.5 text-center font-bold text-zinc-100">
                            {sym}
                          </span>
                          <span className="min-w-0 flex-1 text-zinc-400">
                            {sym === sourceCanonical ? 'Same token · lowest fee' : `Swap ${selectedSymbol} → ${sym}`}
                          </span>
                          {sym === sourceCanonical ? (
                            <span className="rounded bg-emerald-500/20 px-1.5 text-[9px] text-emerald-300">Cheapest</span>
                          ) : null}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <label className="text-xs text-zinc-400">Amount ({selectedSymbol})</label>
                {selectedAsset ? (
                  <button
                    type="button"
                    className="text-[10px] text-violet-300 hover:underline"
                    onClick={() => setAmount(String(Math.min(selectedAsset.balance, selectedAsset.balance)))}
                  >
                    Max {selectedAsset.balance.toPrecision(4)}
                  </button>
                ) : null}
              </div>
              <Input
                inputMode="decimal"
                placeholder={`min ~$${minUsd}`}
                value={amount}
                onChange={(e) => setAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                className="bg-black/30"
              />
              {amountError ? <p className="text-[11px] text-rose-400">{amountError}</p> : null}
              {bridgeNote ? (
                <div className="rounded-lg border border-sky-500/25 bg-sky-500/10 px-2.5 py-2 text-[11px] text-sky-100">
                  <p>{bridgeNote}</p>
                </div>
              ) : null}
            </div>

            <div className="space-y-1 rounded-xl border border-white/10 bg-white/[0.02] p-3 text-xs">
              <div className="flex justify-between text-zinc-400">
                <span>From</span>
                <span className="text-zinc-200">{fromLabel} · {selectedSymbol}</span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>To</span>
                <span className="text-zinc-200">
                  {toLabel} · {effectiveDest}
                  {isCrossToken ? <span className="ml-1 text-sky-300">(swap)</span> : null}
                </span>
              </div>
              <div className="flex justify-between text-zinc-400">
                <span>Settlement fee</span>
                <span className="text-zinc-200">${feeUsd} (deducted from receive amount)</span>
              </div>
              <div className="flex justify-between border-t border-white/10 pt-1 font-medium">
                <span className="text-zinc-300">You receive</span>
                <span className="text-emerald-300">
                  {validAmount && preview
                    ? `${isCrossToken ? '≈ ' : ''}${youReceive.toPrecision(6)} ${effectiveDest}`
                    : quoting
                      ? 'Quoting…'
                      : 'Enter amount above'}
                </span>
              </div>
            </div>

            <Button
              type="button"
              disabled={!canSubmit}
              onClick={() => void handleTransfer()}
              className="w-full rounded-xl bg-sky-500 font-semibold text-black hover:bg-sky-400 disabled:opacity-50"
            >
              {submitting
                ? 'Transferring…'
                : isCrossToken
                  ? `Swap ${selectedSymbol} → ${effectiveDest} on ${toLabel}`
                  : `Transfer ${selectedSymbol} to ${toLabel}`}
            </Button>

            <p className="text-[10px] leading-relaxed text-zinc-500">
              {isCrossToken
                ? `Cross-token route: your ${selectedSymbol} on ${fromLabel} is swapped and bridged to ${effectiveDest} on ${toLabel} in a single route (via LI.FI). The received amount is an estimate — market rate plus up to ~3% slippage. If delivery is delayed, your debit is safe and credit completes shortly.`
                : 'Same token on both chains — your ETH on BSC becomes ETH on Solana (Portal/wrapped form). The platform bridges your tokens automatically; only network bridge time applies. If delivery is delayed, your debit is safe and credit will complete shortly.'}
            </p>
            </>
            ) : null}
          </div>
        )}

        {history.length > 0 ? (
          <div className="mt-1 space-y-2">
            <p className="text-[11px] uppercase tracking-wider text-zinc-500">Recent transfers</p>
            <div className="max-h-40 space-y-1.5 overflow-y-auto">
              {history.map((h) => {
                const chains = legChains(h.direction)
                return (
                  <div key={h.id} className="rounded-lg border border-white/10 bg-white/[0.02] p-2 text-[11px]">
                    <div className="flex items-center justify-between">
                      <span className="text-zinc-300">
                        {h.direction === 'BSC_TO_SOL' ? 'BSC → Solana' : 'Solana → BSC'} · {h.amount} {h.asset}
                        {h.destAsset && h.destAsset !== h.asset ? (
                          <span className="text-sky-300"> → {h.destAsset}</span>
                        ) : null}
                      </span>
                      <span
                        className={
                          h.status === 'COMPLETED'
                            ? 'text-emerald-400'
                            : h.status === 'FAILED'
                              ? 'text-rose-400'
                              : 'text-amber-400'
                        }
                      >
                        {h.status}
                      </span>
                    </div>
                    {h.errorMessage ? <p className="mt-0.5 text-rose-300/90">{h.errorMessage}</p> : null}
                    <div className="mt-0.5 flex gap-3 text-zinc-500">
                      {h.debitTxRef ? (
                        <a
                          href={explorerUrl(h.debitTxRef, chains.debit)}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-zinc-300"
                        >
                          debit {shortRef(h.debitTxRef)}
                        </a>
                      ) : null}
                      {h.creditTxRef ? (
                        <a
                          href={explorerUrl(h.creditTxRef, chains.credit)}
                          target="_blank"
                          rel="noreferrer"
                          className="hover:text-zinc-300"
                        >
                          credit {shortRef(h.creditTxRef)}
                        </a>
                      ) : null}
                    </div>
                  </div>
                )
              })}
            </div>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void refresh()}
          disabled={loading}
          className="mx-auto mt-1 text-[11px] text-zinc-500 hover:text-zinc-300"
        >
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </DialogContent>
    </Dialog>
  )
}
