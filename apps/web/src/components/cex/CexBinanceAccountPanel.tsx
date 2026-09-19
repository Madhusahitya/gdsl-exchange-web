'use client'

/**
 * Inline Binance connect + live spot balances on the Auto Binance terminal.
 * Funds stay on the user's Binance account — we only trade via their API key.
 */
import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { exchange, risk } from '@/lib/api'
import { useSocket } from '@/hooks/useSocket'

type Connection = {
  id: string
  exchange: string
  label?: string
  isActive: boolean
  canTrade: boolean
  canWithdraw: boolean
}

type Props = {
  symbol: string
  onReadyChange?: (ready: boolean, connId: string | null, blockers: string[]) => void
  onUsdtChange?: (quoteUsd: number) => void
}

function formatAxiosError(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data as { error?: string; detail?: string } | undefined
    if (d?.error && d?.detail) return `${d.error} — ${d.detail}`
    if (d?.error) return d.error
  }
  return fallback
}

function baseFromSymbol(sym: string): string {
  return sym.replace(/USDT$/i, '').toUpperCase()
}

export function CexBinanceAccountPanel({ symbol, onReadyChange, onUsdtChange }: Props) {
  const [open, setOpen] = useState(false)
  const [connections, setConnections] = useState<Connection[]>([])
  const [connId, setConnId] = useState<string | null>(null)
  const [connected, setConnected] = useState(false)
  const [ready, setReady] = useState(false)
  const [blockers, setBlockers] = useState<string[]>([])
  const [quoteTotal, setQuoteTotal] = useState(0)
  const [usdt, setUsdt] = useState(0)
  const [usdc, setUsdc] = useState(0)
  const [baseQty, setBaseQty] = useState(0)
  const [baseAsset, setBaseAsset] = useState('BTC')
  const [topAssets, setTopAssets] = useState<Array<{ asset: string; free: number }>>([])
  const [balanceError, setBalanceError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)

  const [label, setLabel] = useState('My Binance')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [connectErr, setConnectErr] = useState('')
  const [outboundIp, setOutboundIp] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    try {
      const base = baseFromSymbol(symbol)
      const [conns, rd, bal] = await Promise.all([
        exchange.listConnections(),
        risk.readiness().catch(() => null),
        exchange.balances(base).catch(() => null),
      ])
      const list = Array.isArray(conns) ? (conns as Connection[]) : []
      setConnections(list)
      const safe = list.find((c) => c.isActive && c.canTrade && !c.canWithdraw)
      const id = bal?.connectionId ?? safe?.id ?? null
      const isConnected = !!(bal?.connected ?? safe)
      setConnId(id)
      setConnected(isConnected)

      const blockList = rd?.blockers ?? (!safe ? ['Connect your Binance account (trade-only key, withdrawals off).'] : [])
      const isReady = !!rd?.ready && isConnected
      setReady(isReady)
      setBlockers(blockList)
      onReadyChange?.(isReady, id, blockList)

      if (bal) {
        setQuoteTotal(bal.quoteTotalUsd)
        setUsdt(bal.freeUsdt)
        setUsdc(bal.freeUsdc)
        setBaseQty(bal.freeBase)
        setBaseAsset(bal.baseAsset ?? base)
        setTopAssets(bal.assets?.map((a) => ({ asset: a.asset, free: a.free })) ?? [])
        setBalanceError(bal.error)
        onUsdtChange?.(bal.quoteTotalUsd)
      } else if (!isConnected) {
        setQuoteTotal(0)
        setUsdt(0)
        setUsdc(0)
        setBaseQty(0)
        setTopAssets([])
        setBalanceError(null)
        onUsdtChange?.(0)
      }
    } catch {
      setReady(false)
      setConnected(false)
      setBlockers(['Could not load Binance account — try again.'])
    } finally {
      setLoading(false)
    }
  }, [symbol, onReadyChange, onUsdtChange])

  useEffect(() => {
    void refresh()
  }, [refresh])

  useSocket({
    onTradeExecuted: () => {
      void refresh()
    },
  })

  useEffect(() => {
    const onRefresh = () => void refresh()
    window.addEventListener('dashboard:refresh', onRefresh)
    return () => window.removeEventListener('dashboard:refresh', onRefresh)
  }, [refresh])

  useEffect(() => {
    if (!open || outboundIp) return
    void exchange.outboundIp().then((d) => setOutboundIp(d.ip))
  }, [open, outboundIp])

  const connect = async () => {
    setConnecting(true)
    setConnectErr('')
    const k = apiKey.trim().replace(/^["']+|["']+$/g, '').trim()
    const s = apiSecret.trim().replace(/^["']+|["']+$/g, '').trim()
    if (k.length < 50 || s.length < 50) {
      setConnectErr(
        `Paste the full key and secret from Binance (~64 characters each). Yours: ${k.length} / ${s.length}.`,
      )
      setConnecting(false)
      return
    }
    try {
      await exchange.createConnection({ exchange: 'BINANCE', label, apiKey: k, apiSecret: s })
      setApiKey('')
      setApiSecret('')
      toast.success('Binance connected — loading balances…')
      await refresh()
      setOpen(true)
    } catch (e) {
      setConnectErr(formatAxiosError(e, 'Connection failed'))
    } finally {
      setConnecting(false)
    }
  }

  const testAndRefresh = async () => {
    const activeConn = connections.find((c) => c.id === connId)
    if (!activeConn) return
    try {
      await exchange.testConnection(activeConn.id)
      toast.success('Connection OK — refreshing balances')
      await refresh()
    } catch (e) {
      toast.error(formatAxiosError(e, 'Connection test failed'))
    }
  }

  const activeConn = connections.find((c) => c.id === connId)

  const balanceLine = () => {
    if (loading) return '…'
    if (balanceError) return 'Balance error — open panel'
    if (!connected) return 'Not connected'
    if (quoteTotal <= 0 && baseQty <= 0 && topAssets.length === 0) {
      return '$0 — deposit on Binance'
    }
    const parts: string[] = []
    if (quoteTotal > 0) parts.push(`$${quoteTotal.toFixed(2)} stables`)
    if (baseQty > 0) parts.push(`${baseQty.toFixed(baseQty >= 1 ? 4 : 6)} ${baseAsset}`)
    return parts.join(' · ') || '$0'
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left transition ${
          connected
            ? 'border-emerald-500/35 bg-emerald-500/10 hover:bg-emerald-500/15'
            : 'border-amber-500/35 bg-amber-500/10 hover:bg-amber-500/15'
        }`}
      >
        <span
          className={`h-2 w-2 shrink-0 rounded-full ${connected ? 'bg-emerald-400' : 'bg-amber-400'}`}
          aria-hidden
        />
        <div>
          <p className="text-[10px] uppercase tracking-wide text-zinc-500">
            {connected ? 'Binance linked' : 'Connect Binance'}
          </p>
          <p className={`font-mono text-sm ${balanceError ? 'text-rose-300' : 'text-white'}`}>{balanceLine()}</p>
        </div>
      </button>

      {open ? (
        <>
          <button
            type="button"
            className="fixed inset-0 z-40 cursor-default bg-black/40"
            aria-label="Close"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 top-full z-50 mt-2 w-[min(24rem,calc(100vw-2rem))] rounded-xl border border-white/10 bg-[#0a0a0f] p-4 shadow-xl">
            <p className="text-sm font-semibold text-white">Your Binance account</p>

            {activeConn ? (
              <div className="mt-3 rounded-lg border border-emerald-500/25 bg-emerald-500/5 px-3 py-2 text-xs">
                <p className="font-medium text-emerald-200">{activeConn.label ?? 'Binance'} · linked</p>
                {balanceError ? (
                  <p className="mt-2 text-[11px] text-rose-300">{balanceError}</p>
                ) : (
                  <>
                    <p className="mt-1 font-mono text-[11px] text-emerald-100/90">
                      Total stables: ${quoteTotal.toFixed(2)}
                      {usdt > 0 ? ` (USDT $${usdt.toFixed(2)}` : ''}
                      {usdc > 0 ? `${usdt > 0 ? ', ' : ' ('}USDC $${usdc.toFixed(2)}` : ''}
                      {usdt > 0 || usdc > 0 ? ')' : ''}
                    </p>
                    {baseQty > 0 ? (
                      <p className="mt-0.5 font-mono text-[11px] text-zinc-400">
                        {baseQty.toFixed(6)} {baseAsset}
                      </p>
                    ) : null}
                  </>
                )}
              </div>
            ) : null}

            {connected && !balanceError && quoteTotal < 5 && baseQty <= 0 ? (
              <p className="mt-3 rounded-lg border border-amber-500/25 bg-amber-500/5 px-3 py-2 text-[11px] text-amber-200/90">
                Account linked but no spendable balance found. Deposit at least <strong>$5 USDT or USDC</strong>{' '}
                on{' '}
                <a
                  href="https://www.binance.com/en/my/wallet/account/main"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Binance → Wallet
                </a>{' '}
                (Spot wallet), then click Refresh balances.
              </p>
            ) : null}

            {topAssets.length > 0 ? (
              <div className="mt-3 rounded-lg border border-white/10 bg-black/20 px-3 py-2">
                <p className="text-[10px] uppercase text-zinc-500">Spot balances</p>
                <ul className="mt-1 max-h-28 space-y-0.5 overflow-y-auto">
                  {topAssets.map((a) => (
                    <li key={a.asset} className="flex justify-between font-mono text-[10px] text-zinc-300">
                      <span>{a.asset}</span>
                      <span>{a.free >= 1 ? a.free.toFixed(4) : a.free.toFixed(8)}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {!ready && blockers.length > 0 ? (
              <ul className="mt-3 space-y-1 text-[11px] text-amber-200/90">
                {blockers.map((b) => (
                  <li key={b}>· {b}</li>
                ))}
              </ul>
            ) : null}

            {!activeConn ? (
              <div className="mt-3 space-y-2">
                <p className="text-[11px] font-medium text-zinc-300">Step 1 — Create key on Binance</p>
                <p className="text-[10px] text-zinc-500">
                  Enable <strong className="text-zinc-400">Reading</strong> +{' '}
                  <strong className="text-zinc-400">Spot trading</strong>. Turn{' '}
                  <strong className="text-zinc-400">Withdrawals OFF</strong>.
                </p>
                <Input
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Label (e.g. Primary Binance)"
                  className="h-9 border-white/10 bg-black/40 text-sm"
                />
                <Input
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste API key"
                  autoComplete="off"
                  className="h-9 border-white/10 bg-black/40 font-mono text-xs"
                />
                <Input
                  value={apiSecret}
                  onChange={(e) => setApiSecret(e.target.value)}
                  placeholder="Paste API secret"
                  type="password"
                  autoComplete="off"
                  className="h-9 border-white/10 bg-black/40 font-mono text-xs"
                />
                {connectErr ? <p className="text-[11px] text-rose-300">{connectErr}</p> : null}
                {outboundIp ? (
                  <p className="text-[10px] text-zinc-600">
                    IP whitelist (if enabled): <code className="text-sky-400">{outboundIp}</code>
                  </p>
                ) : null}
                <Button
                  type="button"
                  className="w-full"
                  disabled={connecting || !apiKey || !apiSecret}
                  onClick={() => void connect()}
                >
                  {connecting ? 'Connecting…' : 'Connect Binance'}
                </Button>
                <a
                  href="https://www.binance.com/en/my/settings/api-management"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-center text-[10px] text-sky-400 underline"
                >
                  Open Binance API settings →
                </a>
              </div>
            ) : (
              <div className="mt-3 flex flex-wrap gap-2">
                <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => void refresh()}>
                  Refresh balances
                </Button>
                <Button type="button" variant="outline" size="sm" className="text-xs" onClick={() => void testAndRefresh()}>
                  Test connection
                </Button>
                {!ready ? (
                  <p className="w-full text-[10px] text-zinc-500">
                    Enable risk policy in{' '}
                    <a href="/settings" className="text-sky-400 underline">
                      Settings
                    </a>{' '}
                    to turn on Super Machine.
                  </p>
                ) : null}
              </div>
            )}
          </div>
        </>
      ) : null}
    </div>
  )
}
