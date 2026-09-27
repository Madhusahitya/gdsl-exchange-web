'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { dexJupiter } from '@/lib/api'
import { WalletChainHistory } from '@/components/wallet/WalletChainHistory'

function shortAddr(addr: string): string {
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Server-managed Solana personal wallet — deposit, withdraw, history. */
export function SolanaPersonalWalletSection() {
  const [address, setAddress] = useState<string | null>(null)
  const [balances, setBalances] = useState<{ sol: number; usdc: number; totalUsd: number } | null>(null)
  const [realizedPnl, setRealizedPnl] = useState<{ totalPnlUsd: number; totalTrades: number } | null>(null)
  const [tokens, setTokens] = useState<
    Awaited<ReturnType<typeof dexJupiter.walletTokens>>['tokens']
  >([])
  const [loading, setLoading] = useState(true)
  const [asset, setAsset] = useState<'USDC' | 'SOL'>('USDC')
  const [amount, setAmount] = useState('')
  const [dest, setDest] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [showQr, setShowQr] = useState(true)
  const [historyTick, setHistoryTick] = useState(0)

  const refresh = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoading(true)
    try {
      await dexJupiter.ensureWallet().catch(() => null)
      const [bal, tok, journal] = await Promise.all([
        dexJupiter.walletBalances().catch(() => null),
        dexJupiter.walletTokens().catch(() => ({ address: null, tokens: [] as typeof tokens })),
        dexJupiter.journal().catch(() => null),
      ])
      if (bal?.address || tok.address) setAddress(bal?.address ?? tok.address ?? null)
      if (bal) {
        setBalances({
          sol: bal.sol,
          usdc: bal.usdc,
          totalUsd: Math.max(Number(bal.totalUsd) || 0, Number(bal.usdc) || 0),
        })
      }
      // Never replace a richer portfolio with a thinner RPC blip (USDC-only).
      setTokens((prev) => {
        const next = tok.tokens ?? []
        if (!next.length) return prev
        if (prev.length > next.length + 1) return prev
        return next
      })
      if (journal) {
        setRealizedPnl({ totalPnlUsd: journal.totalPnlUsd, totalTrades: journal.totalTrades })
      }
    } finally {
      if (!opts?.quiet) setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh({ quiet: true }), 12_000)
    return () => window.clearInterval(id)
  }, [refresh])

  useEffect(() => {
    const onRefresh = () => void refresh()
    window.addEventListener('dashboard:refresh', onRefresh)
    return () => window.removeEventListener('dashboard:refresh', onRefresh)
  }, [refresh])

  const copyAddress = async () => {
    if (!address) return
    try {
      await navigator.clipboard.writeText(address)
      toast.success('Solana address copied')
    } catch {
      toast.error('Copy failed')
    }
  }

  const submitWithdraw = async () => {
    const amt = Number.parseFloat(amount)
    if (!Number.isFinite(amt) || amt <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    if (dest.trim().length < 32) {
      toast.error('Enter a valid Solana destination address')
      return
    }
    setSubmitting(true)
    try {
      const res = await dexJupiter.walletWithdraw({ asset, amount: amt, toAddress: dest.trim() })
      toast.success(`Withdrawal sent · ${shortAddr(res.txSignature)}`)
      setAmount('')
      setHistoryTick((n) => n + 1)
      await refresh()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      toast.error(ax.response?.data?.error ?? 'Withdrawal failed')
    } finally {
      setSubmitting(false)
    }
  }

  const qrSrc = address
    ? `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=0&data=${encodeURIComponent(address)}`
    : null

  // Always surface USDC + SOL even if token enumeration lags; merge with priced SPL list.
  const displayTokens = (() => {
    const byMint = new Map(tokens.map((t) => [t.mint, t]))
    const SOL_MINT = 'So11111111111111111111111111111111111111112'
    const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
    if (balances) {
      if (!byMint.has(USDC_MINT) && balances.usdc > 0) {
        byMint.set(USDC_MINT, {
          mint: USDC_MINT,
          symbol: 'USDC',
          icon: null,
          amount: balances.usdc,
          decimals: 6,
          usdPrice: 1,
          usdValue: balances.usdc,
        })
      }
      if (!byMint.has(SOL_MINT) && balances.sol > 0) {
        const existing = byMint.get(SOL_MINT)
        if (!existing) {
          byMint.set(SOL_MINT, {
            mint: SOL_MINT,
            symbol: 'SOL',
            icon: null,
            amount: balances.sol,
            decimals: 9,
            usdPrice: 0,
            usdValue: Math.max(0, balances.totalUsd - balances.usdc),
          })
        }
      }
    }
    return [...byMint.values()].sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
  })()

  if (loading && !address) {
    return <p className="py-8 text-sm text-zinc-500">Loading Solana wallet…</p>
  }

  return (
    <div className="space-y-4">
      <Card className="border-violet-500/30 bg-[#1a1a1a]">
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-white">Solana personal wallet</CardTitle>
          </div>
          {balances ? (
            <div className="text-right">
              <p className="text-2xl font-semibold text-white">
                ${Math.max(balances.totalUsd, balances.usdc).toFixed(2)}
              </p>
            </div>
          ) : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {realizedPnl ? (
            <div className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-xs">
              <span className="text-zinc-400">Realized PnL · </span>
              <span
                className={
                  realizedPnl.totalPnlUsd >= 0
                    ? 'font-semibold text-emerald-300'
                    : 'font-semibold text-rose-300'
                }
              >
                {realizedPnl.totalPnlUsd >= 0 ? '+' : ''}
                ${Math.abs(realizedPnl.totalPnlUsd).toFixed(2)}
              </span>
            </div>
          ) : null}
          <div className="flex flex-wrap items-start gap-3">
            {showQr && qrSrc ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={qrSrc} alt="Solana QR" className="h-28 w-28 rounded bg-white p-1" />
            ) : null}
            <div className="min-w-0 flex-1">
              <p className="text-[10px] uppercase text-zinc-500">Deposit address (Solana mainnet)</p>
              <code className="mt-1 block break-all rounded border border-white/10 bg-black/40 px-2 py-1.5 text-xs text-violet-200">
                {address ?? 'Create wallet on Solana first'}
              </code>
              <div className="mt-2 flex gap-2">
                <Button size="sm" variant="outline" onClick={copyAddress} disabled={!address}>
                  Copy
                </Button>
                <Button size="sm" variant="outline" onClick={() => setShowQr((v) => !v)}>
                  {showQr ? 'Hide QR' : 'Show QR'}
                </Button>
              </div>
            </div>
          </div>

          {balances ? (
            <div className="space-y-3">
              <div>
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-amber-300/90">
                  Gas fee token (Solana)
                </p>
                <div className="rounded-lg border border-amber-500/35 bg-amber-500/10 px-3 py-2.5">
                  <div className="flex items-center justify-between">
                    <span className="flex items-center gap-2 text-sm text-white">
                      SOL
                      <span className="rounded bg-amber-500/25 px-1.5 py-0.5 text-[9px] uppercase tracking-wide text-amber-200">
                        Gas
                      </span>
                    </span>
                    <span className="font-mono text-white">{balances.sol.toFixed(4)}</span>
                  </div>
                </div>
              </div>
              <div>
                <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                  Holdings ({displayTokens.length})
                </p>
                <div className="grid grid-cols-2 gap-2 text-center text-xs">
                  <div className="rounded-lg border border-white/10 bg-black/30 py-2">
                    <p className="text-zinc-500">USDC cash</p>
                    <p className="font-mono text-white">${balances.usdc.toFixed(2)}</p>
                  </div>
                  <div className="rounded-lg border border-white/10 bg-black/30 py-2">
                    <p className="text-zinc-500">Portfolio total</p>
                    <p className="font-mono text-white">
                      ${Math.max(balances.totalUsd, balances.usdc).toFixed(2)}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          ) : null}

          {displayTokens.length > 0 ? (
            <div className="space-y-2">
              <p className="text-[10px] font-medium uppercase tracking-wider text-zinc-500">
                All coins in this wallet
              </p>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {displayTokens.map((t) => (
                  <div
                    key={t.mint}
                    className="flex items-center justify-between gap-2 rounded border border-white/10 bg-black/20 px-2.5 py-2 text-xs"
                  >
                    <div className="min-w-0">
                      <p className="truncate font-semibold text-white">{t.symbol}</p>
                      <p className="font-mono text-[10px] text-zinc-500">
                        {t.amount >= 1 ? t.amount.toFixed(4) : t.amount.toPrecision(5)}
                      </p>
                    </div>
                    <p className="shrink-0 font-mono text-zinc-300">
                      {t.usdValue > 0 ? `$${t.usdValue.toFixed(2)}` : '—'}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-[#2a2a2a] bg-[#1a1a1a]">
        <CardHeader>
          <CardTitle className="text-white">Withdraw (Solana)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="flex gap-2">
            {(['USDC', 'SOL'] as const).map((a) => (
              <button
                key={a}
                type="button"
                onClick={() => setAsset(a)}
                className={`rounded px-3 py-1 text-xs ${asset === a ? 'bg-violet-600 text-white' : 'bg-zinc-800 text-zinc-400'}`}
              >
                {a}
              </button>
            ))}
          </div>
          <Input placeholder="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Input
            placeholder="Destination Solana address"
            value={dest}
            onChange={(e) => setDest(e.target.value)}
            className="font-mono text-xs"
          />
          <Button onClick={() => void submitWithdraw()} disabled={submitting || !address}>
            {submitting ? 'Sending…' : `Withdraw ${asset}`}
          </Button>
        </CardContent>
      </Card>

      <WalletChainHistory scope="solana" refreshKey={historyTick} />
    </div>
  )
}
