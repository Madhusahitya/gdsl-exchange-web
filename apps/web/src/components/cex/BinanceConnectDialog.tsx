'use client'

import { useCallback, useEffect, useState } from 'react'
import axios from 'axios'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { exchange } from '@/lib/api'

type Connection = {
  id: string
  exchange: string
  label?: string
  isActive: boolean
  canTrade: boolean
  canWithdraw: boolean
}

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatAxiosError(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data as { error?: string; detail?: string } | undefined
    if (d?.error && d?.detail) return `${d.error} — ${d.detail}`
    if (d?.error) return d.error
  }
  return fallback
}

export function BinanceConnectDialog({ open, onOpenChange }: Props) {
  const [connections, setConnections] = useState<Connection[]>([])
  const [quoteTotal, setQuoteTotal] = useState(0)
  const [label, setLabel] = useState('Binance')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [connecting, setConnecting] = useState(false)
  const [disconnecting, setDisconnecting] = useState(false)
  const [connectErr, setConnectErr] = useState('')
  const [outboundIp, setOutboundIp] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const active = connections.find((c) => c.isActive && c.canTrade)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [conns, bal] = await Promise.all([
        exchange.listConnections(),
        exchange.balances('BTC').catch(() => null),
      ])
      setConnections(Array.isArray(conns) ? (conns as Connection[]) : [])
      if (bal?.quoteTotalUsd != null) setQuoteTotal(bal.quoteTotalUsd)
    } catch {
      /* keep last */
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (!open) return
    void refresh()
    if (!outboundIp) {
      void exchange.outboundIp().then((d) => setOutboundIp(d.ip)).catch(() => null)
    }
  }, [open, outboundIp, refresh])

  const connect = async () => {
    setConnecting(true)
    setConnectErr('')
    const k = apiKey.trim().replace(/^["']+|["']+$/g, '').trim()
    const s = apiSecret.trim().replace(/^["']+|["']+$/g, '').trim()
    if (k.length < 50 || s.length < 50) {
      setConnectErr(`Key and secret must be the full values from Binance (${k.length} / ${s.length}).`)
      setConnecting(false)
      return
    }
    try {
      if (active?.id) {
        await exchange.deactivateConnection(active.id).catch(() => null)
      }
      await exchange.createConnection({ exchange: 'BINANCE', label, apiKey: k, apiSecret: s })
      setApiKey('')
      setApiSecret('')
      toast.success(active ? 'Binance key replaced' : 'Binance connected')
      await refresh()
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      setConnectErr(formatAxiosError(e, 'Connection failed'))
    } finally {
      setConnecting(false)
    }
  }

  const disconnect = async () => {
    if (!active) return
    setDisconnecting(true)
    setConnectErr('')
    try {
      await exchange.deactivateConnection(active.id)
      setConnections([])
      setQuoteTotal(0)
      toast.success('Binance disconnected')
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      setConnectErr(formatAxiosError(e, 'Disconnect failed'))
    } finally {
      setDisconnecting(false)
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#111113] text-white sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Binance</DialogTitle>
        </DialogHeader>

        <div className="space-y-3">
          {active ? (
            <div className="flex items-center justify-between rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-3 py-2.5">
              <div>
                <p className="text-sm font-medium text-emerald-100">{active.label ?? 'Binance'}</p>
                <p className="font-mono text-xs text-emerald-200/80">
                  {loading ? '…' : `$${quoteTotal.toFixed(2)}`}
                </p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-7 border-rose-500/30 text-xs text-rose-200 hover:bg-rose-500/10"
                disabled={disconnecting}
                onClick={() => void disconnect()}
              >
                {disconnecting ? '…' : 'Disconnect'}
              </Button>
            </div>
          ) : null}

          <Input
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder="Label"
            className="h-9 border-white/10 bg-black/40 text-sm"
          />
          <Input
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder="API key"
            autoComplete="off"
            className="h-9 border-white/10 bg-black/40 font-mono text-xs"
          />
          <Input
            value={apiSecret}
            onChange={(e) => setApiSecret(e.target.value)}
            placeholder="API secret"
            type="password"
            autoComplete="off"
            className="h-9 border-white/10 bg-black/40 font-mono text-xs"
          />
          {connectErr ? <p className="text-[11px] text-rose-300">{connectErr}</p> : null}
          {outboundIp ? <p className="font-mono text-[10px] text-zinc-500">{outboundIp}</p> : null}

          <DialogFooter className="gap-2 sm:justify-between">
            <a
              href="https://www.binance.com/en/my/settings/api-management"
              target="_blank"
              rel="noopener noreferrer"
              className="self-center text-[11px] text-sky-400 hover:text-sky-300"
            >
              API settings
            </a>
            <Button
              type="button"
              className="bg-emerald-400 text-black hover:bg-emerald-300"
              disabled={connecting || !apiKey || !apiSecret}
              onClick={() => void connect()}
            >
              {connecting ? 'Connecting…' : active ? 'Replace key' : 'Connect'}
            </Button>
          </DialogFooter>
        </div>
      </DialogContent>
    </Dialog>
  )
}
