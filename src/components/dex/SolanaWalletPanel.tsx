'use client'

/**
 * SolanaWalletPanel — deposit + withdraw for the server-managed Solana wallet
 * used by DEX Jupiter. Deposit is address + QR + copy (send USDC/SOL from any
 * Solana wallet or exchange). Withdraw is server-signed to a pasted address.
 */

import { useCallback, useEffect, useState } from 'react'
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

type Balances = Awaited<ReturnType<typeof dexJupiter.walletBalances>>
type Withdrawal = Awaited<ReturnType<typeof dexJupiter.walletWithdrawals>>['items'][number]

function shortSig(sig: string): string {
  return `${sig.slice(0, 8)}…${sig.slice(-6)}`
}

export function SolanaWalletPanel({
  address,
  open: openProp,
  onOpenChange,
  hideTrigger = false,
  initialTab = 'deposit',
}: {
  address: string | null
  /** Controlled open state (omit for self-managed dialog with its own trigger). */
  open?: boolean
  onOpenChange?: (open: boolean) => void
  /** Hide the built-in trigger button when the dialog is driven externally. */
  hideTrigger?: boolean
  initialTab?: 'deposit' | 'withdraw'
}) {
  const [internalOpen, setInternalOpen] = useState(false)
  const open = openProp ?? internalOpen
  const setOpen = onOpenChange ?? setInternalOpen
  const [tab, setTab] = useState<'deposit' | 'withdraw'>(initialTab)
  const [balances, setBalances] = useState<Balances | null>(null)
  const [loadingBal, setLoadingBal] = useState(false)
  const [withdrawals, setWithdrawals] = useState<Withdrawal[]>([])

  const [asset, setAsset] = useState<'USDC' | 'SOL'>('USDC')
  const [amount, setAmount] = useState('')
  const [dest, setDest] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const effectiveAddress = balances?.address ?? address

  const refresh = useCallback(async () => {
    try {
      setLoadingBal(true)
      const [bal, wd] = await Promise.all([
        dexJupiter.walletBalances(),
        dexJupiter.walletWithdrawals(),
      ])
      setBalances(bal)
      setWithdrawals(wd.items)
    } catch {
      // Non-fatal; keep last values.
    } finally {
      setLoadingBal(false)
    }
  }, [])

  useEffect(() => {
    if (open) {
      setTab(initialTab)
      void refresh()
    }
  }, [open, initialTab, refresh])

  const copyAddress = async () => {
    if (!effectiveAddress) return
    try {
      await navigator.clipboard.writeText(effectiveAddress)
      toast.success('Address copied')
    } catch {
      toast.error('Copy failed — select and copy manually')
    }
  }

  const setMax = () => {
    if (!balances) return
    if (asset === 'USDC') setAmount(String(balances.usdc))
    else setAmount(String(Math.max(0, balances.sol - 0.003)))
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
      toast.success(`Withdrawal sent · ${shortSig(res.txSignature)}`)
      setAmount('')
      setDest('')
      await refresh()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      toast.error(ax.response?.data?.error ?? 'Withdrawal failed')
    } finally {
      setSubmitting(false)
    }
  }

  const qrSrc = effectiveAddress
    ? `https://api.qrserver.com/v1/create-qr-code/?size=160x160&margin=0&data=${encodeURIComponent(effectiveAddress)}`
    : null

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      {hideTrigger ? null : (
        <DialogTrigger asChild>
          <Button variant="outline" size="sm" className="h-7 w-full border-violet-500/40 text-[11px] text-violet-200 hover:bg-violet-500/10">
            Deposit / Withdraw USDC · SOL
          </Button>
        </DialogTrigger>
      )}
      <DialogContent className="max-w-md border-white/10 bg-[#0a0a0f]">
        <DialogHeader>
          <DialogTitle className="text-white">Solana wallet</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-3 gap-2 rounded-lg border border-white/10 bg-black/30 p-2 text-center text-xs">
          <div>
            <p className="text-zinc-500">USDC</p>
            <p className="font-mono text-white">{balances ? balances.usdc.toFixed(2) : '—'}</p>
          </div>
          <div>
            <p className="text-zinc-500">SOL</p>
            <p className="font-mono text-white">{balances ? balances.sol.toFixed(4) : '—'}</p>
          </div>
          <div>
            <p className="text-zinc-500">Total</p>
            <p className="font-mono text-emerald-400">{balances ? `$${balances.totalUsd.toFixed(2)}` : '—'}</p>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 p-0.5">
          {(['deposit', 'withdraw'] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={`rounded-md py-1.5 text-sm font-medium capitalize ${
                tab === t ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {tab === 'deposit' ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3 rounded-lg border border-white/10 bg-black/30 p-3">
              {qrSrc ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={qrSrc} alt="Solana address QR" className="h-24 w-24 rounded bg-white p-1" />
              ) : (
                <div className="flex h-24 w-24 items-center justify-center rounded bg-white/5 text-[10px] text-zinc-500">
                  No wallet yet
                </div>
              )}
              <div className="min-w-0 flex-1">
                <p className="text-[11px] text-zinc-500">Your Solana deposit address</p>
                <p className="break-all font-mono text-[11px] text-zinc-200">{effectiveAddress ?? '—'}</p>
                <Button size="sm" className="mt-2 h-7 bg-violet-600 text-[11px] hover:bg-violet-500" onClick={copyAddress} disabled={!effectiveAddress}>
                  Copy address
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-1 rounded-lg border border-white/10 p-0.5">
              {(['USDC', 'SOL'] as const).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAsset(a)}
                  className={`rounded-md py-1.5 text-xs font-medium ${
                    asset === a ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-white'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11px] text-zinc-400">Amount ({asset})</label>
                <button type="button" onClick={setMax} className="text-[10px] text-violet-400 hover:text-violet-300">
                  Max
                </button>
              </div>
              <Input
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                placeholder="0.00"
                inputMode="decimal"
                className="bg-black/40 text-white"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-400">Destination Solana address</label>
              <Input
                value={dest}
                onChange={(e) => setDest(e.target.value)}
                placeholder="Paste recipient address"
                className="bg-black/40 font-mono text-xs text-white"
              />
            </div>
            <Button
              onClick={() => void submitWithdraw()}
              disabled={submitting || !effectiveAddress}
              className="w-full bg-rose-600 hover:bg-rose-500"
            >
              {submitting ? 'Sending…' : `Withdraw ${asset}`}
            </Button>
          </div>
        )}

        {withdrawals.length > 0 ? (
          <div className="max-h-32 overflow-y-auto rounded-lg border border-white/10">
            <table className="w-full text-left text-[10px]">
              <thead className="sticky top-0 bg-[#0a0a0f] text-zinc-500">
                <tr className="border-b border-white/5">
                  <th className="px-2 py-1 font-medium">Asset</th>
                  <th className="px-2 py-1 text-right font-medium">Amount</th>
                  <th className="px-2 py-1 text-right font-medium">Status</th>
                  <th className="px-2 py-1 text-right font-medium">Tx</th>
                </tr>
              </thead>
              <tbody>
                {withdrawals.map((w) => (
                  <tr key={w.id} className="border-b border-white/5">
                    <td className="px-2 py-1 text-zinc-300">{w.asset}</td>
                    <td className="px-2 py-1 text-right font-mono text-zinc-300">{w.amount}</td>
                    <td
                      className={`px-2 py-1 text-right ${
                        w.status === 'COMPLETED'
                          ? 'text-emerald-400'
                          : w.status === 'FAILED'
                            ? 'text-rose-400'
                            : 'text-amber-300'
                      }`}
                    >
                      {w.status.toLowerCase()}
                    </td>
                    <td className="px-2 py-1 text-right">
                      {w.txSignature ? (
                        <a
                          href={`https://solscan.io/tx/${w.txSignature}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-violet-400 hover:text-violet-300"
                        >
                          {shortSig(w.txSignature)}
                        </a>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}

        <button
          type="button"
          onClick={() => void refresh()}
          className="text-[10px] text-zinc-500 hover:text-zinc-300"
        >
          {loadingBal ? 'Refreshing…' : 'Refresh balances'}
        </button>
      </DialogContent>
    </Dialog>
  )
}
