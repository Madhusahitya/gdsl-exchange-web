'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { toast } from 'sonner'
import {
  personalWallet,
  type PersonalWalletSummary,
} from '@/lib/api'
import { tryNormalizeEvmAddress } from '@/lib/evmAddress'
import { WalletChainHistory } from '@/components/wallet/WalletChainHistory'
import type { PersonalWalletAssetBalance } from '@/lib/api'

const REFRESH_MS = 12_000

function fmtUsd(value: number): string {
  return value.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function fmtAmount(value: number): string {
  if (!Number.isFinite(value)) return '—'
  if (value >= 1) return value.toLocaleString(undefined, { maximumFractionDigits: 6 })
  return value.toLocaleString(undefined, { maximumFractionDigits: 8 })
}

function shortAddress(addr: string): string {
  if (!addr) return ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

/** Renders the user's server-managed BSC personal wallet: address, balances, deposit instructions, withdraw form. */
export function PersonalWalletPanel({ collapsed = false }: { collapsed?: boolean }) {
  const [configured, setConfigured] = useState(true)
  const [serverMessage, setServerMessage] = useState<string | null>(null)
  const [wallet, setWallet] = useState<PersonalWalletSummary | null>(null)
  const [supportedAssets, setSupportedAssets] = useState<string[]>([])
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [historyTick, setHistoryTick] = useState(0)

  const [withdrawAsset, setWithdrawAsset] = useState('USDT')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawTo, setWithdrawTo] = useState('')
  const [withdrawing, setWithdrawing] = useState(false)
  const [showQr, setShowQr] = useState(!collapsed)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const status = await personalWallet.status()
      setConfigured(status.configured)
      setServerMessage(status.message ?? null)
      setWallet(status.wallet)
      setSupportedAssets(status.supportedAssets ?? [])
    } catch {
      // best-effort
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void refresh()
    const id = window.setInterval(() => void refresh(), REFRESH_MS)
    return () => window.clearInterval(id)
  }, [refresh])

  const handleCreate = async () => {
    if (!configured) {
      toast.error('Personal wallets are disabled on this server (WALLET_ENCRYPTION_KEY missing).')
      return
    }
    setCreating(true)
    try {
      const result = await personalWallet.create()
      toast.success(`Personal wallet ready: ${shortAddress(result.address)}`)
      await refresh()
    } catch (e) {
      toast.error((e as Error).message ?? 'Could not create wallet')
    } finally {
      setCreating(false)
    }
  }

  const handleCopy = async () => {
    if (!wallet) return
    try {
      await navigator.clipboard.writeText(wallet.address)
      toast.success('Address copied')
    } catch {
      toast.error('Copy failed — please copy manually')
    }
  }

  const handleWithdraw = async () => {
    if (!wallet) return
    const amount = parseFloat(withdrawAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    const normalizedTo = tryNormalizeEvmAddress(withdrawTo)
    if (!normalizedTo) {
      toast.error('Enter a valid BSC / EVM address (paste your exchange BEP20 deposit address)')
      return
    }
    setWithdrawing(true)
    try {
      const result = await personalWallet.withdraw({
        asset: withdrawAsset,
        amount,
        toAddress: normalizedTo,
      })
      toast.success(`Withdrawal submitted · tx ${shortAddress(result.txHash)}`, { duration: 6000 })
      setWithdrawAmount('')
      setHistoryTick((n) => n + 1)
      await refresh()
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error
      toast.error(msg ?? (e as Error).message ?? 'Withdrawal failed')
    } finally {
      setWithdrawing(false)
    }
  }

  const totalUsd = wallet?.totalUsdValue ?? 0
  const balances = wallet?.balances ?? []
  const gasBalances = balances.filter((b) => b.role === 'gas' || b.role === 'wrapped')
  const tokenBalances = balances.filter((b) => b.role !== 'gas' && b.role !== 'wrapped')

  function balanceCard(b: PersonalWalletAssetBalance) {
    const isGas = b.role === 'gas'
    const isWrapped = b.role === 'wrapped'
    return (
      <div
        key={`${b.asset}-${b.role ?? 'token'}`}
        className={`rounded-lg border px-3 py-2 ${
          isGas
            ? 'border-amber-500/35 bg-amber-500/10'
            : isWrapped
              ? 'border-sky-500/25 bg-sky-500/5'
              : 'border-white/10 bg-white/[0.02]'
        }`}
      >
        <div className="flex items-center justify-between gap-1 text-xs text-zinc-500">
          <span className="flex items-center gap-1">
            {b.asset}
            {b.displayLabel ? (
              <span
                className={`rounded px-1 py-0.5 text-[9px] uppercase tracking-wide ${
                  isGas ? 'bg-amber-500/25 text-amber-200' : 'bg-sky-500/20 text-sky-200'
                }`}
              >
                {isGas ? 'Gas' : 'Wrapped'}
              </span>
            ) : null}
          </span>
          {b.usdPrice != null ? <span>${fmtUsd(b.usdPrice)}</span> : null}
        </div>
        <p className="mt-1 font-mono text-sm text-white">{fmtAmount(b.amount)}</p>
        <p className="text-[11px] text-zinc-500">${fmtUsd(b.usdValue)}</p>
      </div>
    )
  }

  const qrSrc = useMemo(() => {
    if (!wallet) return ''
    return `https://api.qrserver.com/v1/create-qr-code/?size=180x180&margin=8&data=${encodeURIComponent(wallet.address)}`
  }, [wallet])

  if (loading && !wallet) {
    return (
      <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
        <CardContent className="py-8 text-sm text-gray-400">Loading personal wallet…</CardContent>
      </Card>
    )
  }

  if (!configured) {
    return (
      <Card className="bg-[#1a1a1a] border-amber-500/30">
        <CardHeader>
          <CardTitle className="text-white">Personal Wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-amber-200">
          <p>
            Personal wallets are not enabled on this server. The operator must set
            <code className="mx-1 rounded bg-black/40 px-1">WALLET_ENCRYPTION_KEY</code>
            in the API environment.
          </p>
          {serverMessage ? <p className="text-xs text-zinc-500">{serverMessage}</p> : null}
        </CardContent>
      </Card>
    )
  }

  if (!wallet) {
    return (
      <Card className="bg-[#1a1a1a] border-emerald-500/40">
        <CardHeader>
          <CardTitle className="text-white">Create your Personal Wallet</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm">
          <Button disabled={creating} onClick={handleCreate}>
            {creating ? 'Creating…' : 'Create my Personal Wallet'}
          </Button>
        </CardContent>
      </Card>
    )
  }

  return (
    <div className="space-y-4">
      <Card className="bg-[#1a1a1a] border-emerald-500/30">
        <CardHeader className="flex flex-row items-start justify-between gap-3">
          <div>
            <CardTitle className="text-white">Personal Wallet</CardTitle>
          </div>
          <div className="text-right">
            <p className="text-xs text-zinc-500 uppercase tracking-wide">Total value</p>
            <p className="text-2xl font-semibold text-white">${fmtUsd(totalUsd)}</p>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="flex-1 space-y-1">
              <p className="text-[11px] uppercase tracking-wide text-zinc-500">Deposit address (BSC / BEP-20)</p>
              <div className="flex items-center gap-2">
                <code className="flex-1 break-all rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs text-emerald-200">
                  {wallet.address}
                </code>
                <Button variant="outline" size="sm" onClick={handleCopy}>
                  Copy
                </Button>
                <Button variant="outline" size="sm" onClick={() => setShowQr((v) => !v)}>
                  {showQr ? 'Hide QR' : 'Show QR'}
                </Button>
              </div>
            </div>
            {showQr ? (
              <div className="flex flex-col items-center gap-2 rounded-lg border border-white/10 bg-white/[0.02] p-3">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={qrSrc}
                  alt="Personal wallet address QR"
                  width={180}
                  height={180}
                  className="rounded-md bg-white p-1"
                />
              </div>
            ) : null}
          </div>

          <div className="space-y-3">
            <div>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-amber-300/90">
                Gas & network fees (BSC)
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">{gasBalances.map(balanceCard)}</div>
            </div>
            <div>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-zinc-500">Trading tokens</p>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                {tokenBalances.map(balanceCard)}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
        <CardHeader>
          <CardTitle className="text-white">Withdraw</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid gap-3 sm:grid-cols-3">
            <div>
              <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Asset</label>
              <select
                value={withdrawAsset}
                onChange={(e) => setWithdrawAsset(e.target.value)}
                className="w-full rounded-lg border border-[#2a2a2a] bg-[#141414] px-3 py-2 text-sm text-white"
              >
                {(supportedAssets.length > 0 ? supportedAssets : balances.map((b) => b.asset)).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Amount</label>
              <Input
                inputMode="decimal"
                value={withdrawAmount}
                onChange={(e) => setWithdrawAmount(e.target.value)}
                placeholder="0.00"
              />
            </div>
            <div>
              <label className="block text-xs uppercase tracking-wide text-zinc-500 mb-1">Destination address</label>
              <Input
                value={withdrawTo}
                onChange={(e) => setWithdrawTo(e.target.value.trim())}
                placeholder="0x…"
              />
            </div>
          </div>
          <Button onClick={handleWithdraw} disabled={withdrawing || !wallet.enabled}>
            {withdrawing ? 'Submitting…' : `Send ${withdrawAsset}`}
          </Button>
          {!wallet.enabled ? (
            <p className="text-xs text-amber-300">Wallet is paused — withdrawals disabled.</p>
          ) : null}
        </CardContent>
      </Card>

      <WalletChainHistory scope="bsc" refreshKey={historyTick} />
    </div>
  )
}
