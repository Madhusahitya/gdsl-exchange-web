'use client'

import { useCallback, useEffect, useMemo, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import api from '@/lib/api'
import { useActiveWallet } from '@/context/ActiveWalletContext'

const FIATS = ['INR', 'AED', 'USD', 'EUR', 'GBP', 'AUD', 'SGD'] as const

/** Sensible starting amounts per currency so the widget never opens blank. */
const DEFAULT_AMOUNT: Record<string, number> = {
  INR: 5000,
  AED: 200,
  USD: 100,
  EUR: 100,
  GBP: 100,
  AUD: 150,
  SGD: 150,
}

type Status = {
  providers: {
    transak: { configured: boolean; sessionReady?: boolean }
    moonpay: { configured: boolean }
  }
  transakSetup?: {
    serverIp: string
    domain: string
    message: string
  } | null
  supportedFiat: string[]
  note: string
}

type RampOrder = {
  id: string
  partnerOrderId: string
  provider: string
  direction: string
  chain: string
  fiatCurrency: string
  cryptoCurrency: string
  fiatAmount: number | null
  cryptoAmount: number | null
  walletAddress: string
  walletSource: string
  status: string
  txHash: string | null
  failureReason: string | null
  createdAt: string
}

function shortAddr(a: string): string {
  return a.length > 14 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a
}

function statusStyle(status: string): string {
  if (status === 'completed') return 'text-emerald-300'
  if (status === 'failed') return 'text-rose-300'
  if (status === 'pending') return 'text-amber-300'
  return 'text-zinc-400'
}

/**
 * Fiat ↔ crypto through Transak / MoonPay. Funds can land in the koie.fin
 * personal wallet or in a wallet the user has connected in their browser.
 */
export default function OnrampPage() {
  const { solana, evm } = useActiveWallet()

  const [status, setStatus] = useState<Status | null>(null)
  const [direction, setDirection] = useState<'buy' | 'sell'>('buy')
  const [chain, setChain] = useState<'bsc' | 'solana'>('bsc')
  const [fiat, setFiat] = useState<string>('INR')
  const [crypto, setCrypto] = useState('USDT')
  const [provider, setProvider] = useState<'auto' | 'transak' | 'moonpay'>('auto')
  const [walletSource, setWalletSource] = useState<'platform' | 'browser'>('platform')
  const [amount, setAmount] = useState('5000')
  const [busy, setBusy] = useState(false)
  const [lastUrl, setLastUrl] = useState<string | null>(null)
  const [destination, setDestination] = useState<string | null>(null)
  const [orders, setOrders] = useState<RampOrder[]>([])
  const [setupHint, setSetupHint] = useState<string[] | null>(null)

  const browserAddress = chain === 'solana' ? solana.browserAddress : evm.browserAddress
  const browserLabel = chain === 'solana' ? solana.browserLabel : evm.browserLabel
  const browserConnected = chain === 'solana' ? solana.browserConnected : evm.browserConnected

  const loadOrders = useCallback(async () => {
    try {
      const { data } = await api.get('/api/onramp/orders', { params: { limit: 15 } })
      setOrders(data.orders ?? [])
    } catch {
      setOrders([])
    }
  }, [])

  useEffect(() => {
    void api
      .get('/api/onramp/status')
      .then((r) => setStatus(r.data))
      .catch(() => setStatus(null))
    void loadOrders()
  }, [loadOrders])

  useEffect(() => {
    setCrypto(chain === 'solana' ? 'USDC' : 'USDT')
  }, [chain])

  // Buying is priced in fiat, selling in crypto, so the default has to follow.
  // Off-ramp partners usually reject tiny sells (~$2) — start at $50 so the
  // widget opens with a realistic amount.
  useEffect(() => {
    setAmount(direction === 'buy' ? String(DEFAULT_AMOUNT[fiat] ?? 100) : '50')
  }, [direction, fiat])

  // A browser destination is only meaningful while that chain's wallet is connected.
  useEffect(() => {
    if (walletSource === 'browser' && !browserConnected) setWalletSource('platform')
  }, [walletSource, browserConnected])

  // Returning from the provider carries the order id, so refresh to show status.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    if (params.get('order')) {
      void loadOrders()
      toast.message('Order started — status updates here once the provider confirms.')
    }
  }, [loadOrders])

  const parsedAmount = useMemo(() => {
    const n = Number.parseFloat(amount)
    return Number.isFinite(n) && n > 0 ? n : null
  }, [amount])

  const start = useCallback(async () => {
    if (parsedAmount == null) {
      toast.error('Enter an amount first')
      return
    }
    if (walletSource === 'browser' && !browserAddress) {
      toast.error(`Connect a ${chain === 'solana' ? 'Solana' : 'BSC'} wallet in your browser first`)
      return
    }
    setBusy(true)
    try {
      const { data } = await api.post('/api/onramp/session', {
        direction,
        chain,
        fiat,
        crypto,
        provider,
        walletSource,
        browserAddress: walletSource === 'browser' ? browserAddress : undefined,
        fiatAmount: direction === 'buy' ? parsedAmount : undefined,
        cryptoAmount: direction === 'sell' ? parsedAmount : undefined,
      })
      setLastUrl(data.url)
      setDestination(data.walletAddress)
      if (!data.configured) {
        toast.message('Provider key not set yet — opening the sandbox checkout')
      }
      // Stay on koie.fin — the partner widget embeds below (no jump-away tab).
      toast.success('Checkout ready below')
      void loadOrders()
      // Scroll to the embedded checkout after paint.
      requestAnimationFrame(() => {
        document.getElementById('fiat-checkout')?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      })
    } catch (e: unknown) {
      const ax = e as {
        response?: {
          data?: {
            error?: string
            setupRequired?: boolean
            transakSetup?: { steps?: string[] }
          }
        }
      }
      const steps = ax.response?.data?.transakSetup?.steps
      if (steps?.length) setSetupHint(steps)
      toast.error(ax.response?.data?.error ?? 'Could not start the session')
    } finally {
      setBusy(false)
    }
  }, [direction, chain, fiat, crypto, provider, walletSource, browserAddress, parsedAmount, loadOrders])

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-col gap-4 p-4">
      <div>
        <h1 className="text-xl font-bold text-white">Buy &amp; sell with fiat</h1>
      </div>

      {setupHint ? (
        <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs text-rose-100">
          <p className="font-semibold">Could not open checkout</p>
          <ul className="mt-2 list-inside list-disc space-y-1">
            {setupHint.map((s) => (
              <li key={s}>{s}</li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="space-y-4 rounded-2xl border border-white/10 bg-[#0a0a0f] p-4">
        <div className="flex gap-2">
          {(['buy', 'sell'] as const).map((d) => (
            <button
              key={d}
              type="button"
              onClick={() => setDirection(d)}
              className={`flex-1 rounded-xl py-2.5 text-sm font-semibold ${
                direction === d ? 'bg-violet-600 text-white' : 'bg-white/5 text-zinc-400 hover:bg-white/10'
              }`}
            >
              {d === 'buy' ? 'Buy crypto' : 'Cash out to bank'}
            </button>
          ))}
        </div>

        <label className="block text-[10px] uppercase tracking-wide text-zinc-500">
          {direction === 'buy' ? `Amount to spend (${fiat})` : `Amount to sell (${crypto})`}
          <Input
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            className="mt-1 h-12 border-white/10 bg-black/40 font-mono text-lg text-white"
          />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="text-[10px] uppercase tracking-wide text-zinc-500">
            Network
            <select
              value={chain}
              onChange={(e) => setChain(e.target.value as 'bsc' | 'solana')}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white"
            >
              <option value="bsc">BNB Smart Chain</option>
              <option value="solana">Solana</option>
            </select>
          </label>
          <label className="text-[10px] uppercase tracking-wide text-zinc-500">
            Currency
            <select
              value={fiat}
              onChange={(e) => setFiat(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white"
            >
              {FIATS.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] uppercase tracking-wide text-zinc-500">
            Crypto
            <select
              value={crypto}
              onChange={(e) => setCrypto(e.target.value)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white"
            >
              {(chain === 'solana' ? ['USDC', 'SOL'] : ['USDT', 'USDC', 'BNB']).map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </label>
          <label className="text-[10px] uppercase tracking-wide text-zinc-500">
            Partner
            <select
              value={provider}
              onChange={(e) => setProvider(e.target.value as typeof provider)}
              className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-2 py-2 text-sm text-white"
            >
              <option value="auto">Auto</option>
              <option value="moonpay">
                MoonPay{status?.providers.moonpay.configured ? '' : ' (unavailable)'}
              </option>
            </select>
          </label>
        </div>

        {/* Where the crypto lands is the decision users care most about. */}
        <div>
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">
            {direction === 'buy' ? 'Send the crypto to' : 'Sell from'}
          </p>
          <div className="mt-1 grid gap-2 sm:grid-cols-2">
            <button
              type="button"
              onClick={() => setWalletSource('platform')}
              className={`rounded-xl border px-3 py-2 text-left ${
                walletSource === 'platform'
                  ? 'border-violet-500/50 bg-violet-500/10'
                  : 'border-white/10 hover:bg-white/5'
              }`}
            >
              <p className="text-xs font-semibold text-white">koie.fin wallet</p>
            </button>
            <button
              type="button"
              onClick={() => setWalletSource('browser')}
              disabled={!browserConnected}
              className={`rounded-xl border px-3 py-2 text-left disabled:opacity-40 ${
                walletSource === 'browser'
                  ? 'border-violet-500/50 bg-violet-500/10'
                  : 'border-white/10 hover:bg-white/5'
              }`}
            >
              <p className="text-xs font-semibold text-white">
                {browserConnected ? (browserLabel ?? 'Browser wallet') : 'Browser wallet'}
              </p>
              {browserConnected ? (
                <p className="mt-0.5 break-all font-mono text-[10px] text-zinc-500">
                  {shortAddr(browserAddress ?? '')}
                </p>
              ) : null}
            </button>
          </div>
        </div>

        <Button
          type="button"
          disabled={busy || parsedAmount == null}
          onClick={() => void start()}
          className="h-12 w-full rounded-2xl bg-violet-600 text-base font-semibold text-white hover:bg-violet-500"
        >
          {busy
            ? 'Preparing checkout…'
            : direction === 'buy'
              ? `Buy ${crypto} with ${parsedAmount ?? 0} ${fiat}`
              : `Sell ${parsedAmount ?? 0} ${crypto} for ${fiat}`}
        </Button>

        {destination ? (
          <p className="break-all font-mono text-[10px] text-zinc-600">Destination · {destination}</p>
        ) : null}
      </div>

      {lastUrl ? (
        <div id="fiat-checkout" className="overflow-hidden rounded-2xl border border-white/10 bg-[#0a0a0f]">
          <div className="flex items-center justify-between border-b border-white/10 px-3 py-2">
            <p className="text-xs font-semibold text-zinc-200">Checkout · stay on this page</p>
            <a
              href={lastUrl}
              target="_blank"
              rel="noopener"
              className="text-[10px] text-sky-300 underline"
            >
              Open full screen
            </a>
          </div>
          <iframe
            title="Fiat checkout"
            src={lastUrl}
            className="h-[720px] w-full bg-black"
            allow="camera; microphone; clipboard-write; payment"
            referrerPolicy="strict-origin-when-cross-origin"
          />
        </div>
      ) : null}

      <div className="rounded-2xl border border-white/10 bg-[#0a0a0f] p-4">
        <div className="flex items-center justify-between">
          <p className="text-xs font-semibold text-zinc-200">Your fiat orders</p>
          <button
            type="button"
            onClick={() => void loadOrders()}
            className="text-[10px] text-zinc-500 underline hover:text-zinc-300"
          >
            Refresh
          </button>
        </div>
        {orders.length === 0 ? (
          <p className="mt-1.5 text-[10px] text-zinc-500">No orders yet.</p>
        ) : (
          <div className="mt-2 space-y-1.5">
            {orders.map((o) => (
              <div
                key={o.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-white/5 bg-white/[0.02] px-2.5 py-2"
              >
                <div className="min-w-0">
                  <p className="text-[11px] text-zinc-100">
                    {o.direction === 'buy' ? 'Buy' : 'Sell'}{' '}
                    {o.direction === 'buy'
                      ? `${o.fiatAmount ?? '—'} ${o.fiatCurrency} → ${o.cryptoCurrency}`
                      : `${o.cryptoAmount ?? '—'} ${o.cryptoCurrency} → ${o.fiatCurrency}`}
                  </p>
                  <p className="font-mono text-[10px] text-zinc-500">
                    {o.provider} · {o.chain} · {o.walletSource === 'browser' ? 'your wallet' : 'koie.fin wallet'}{' '}
                    {shortAddr(o.walletAddress)} · {new Date(o.createdAt).toLocaleString()}
                  </p>
                  {o.failureReason ? (
                    <p className="text-[10px] text-rose-300/80">{o.failureReason}</p>
                  ) : null}
                </div>
                <span className={`text-[10px] font-semibold capitalize ${statusStyle(o.status)}`}>
                  {o.status === 'created' ? 'awaiting partner' : o.status}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
