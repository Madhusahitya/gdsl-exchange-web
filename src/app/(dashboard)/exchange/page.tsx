'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import axios from 'axios'
import { exchange, risk } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'

const BINANCE_API_HELP = 'https://www.binance.com/en/support/faq/how-to-create-api-keys-on-binance-360002502072'

type ExchangeConnection = {
  id: string
  exchange: 'BINANCE'
  label?: string
  canTrade: boolean
  canRead: boolean
  canWithdraw: boolean
  isActive: boolean
  lastCheckedAt?: string
}

function formatAxiosError(e: unknown, fallback: string): string {
  if (axios.isAxiosError(e)) {
    const d = e.response?.data as { error?: string; detail?: string } | undefined
    if (d?.error && d?.detail) return `${d.error} — ${d.detail}`
    if (d?.error) return d.error
    if (d?.detail) return d.detail
    if (e.response?.status) return `${fallback} (HTTP ${e.response.status})`
  }
  return fallback
}

export default function ExchangePage() {
  const [label, setLabel] = useState('Primary Binance')
  const [apiKey, setApiKey] = useState('')
  const [apiSecret, setApiSecret] = useState('')
  const [rows, setRows] = useState<ExchangeConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [outboundIp, setOutboundIp] = useState<{ ip: string | null; note?: string; error?: string } | null>(null)
  const [riskGateEnabled, setRiskGateEnabled] = useState<boolean | null>(null)
  const [readiness, setReadiness] = useState<{
    ready: boolean
    blockers: string[]
    hasSafeTradableConnection: boolean
    hasRiskPolicyEnabled: boolean
    liveAutomationEnabled: boolean
    maintenanceReason: string | null
  } | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [data, rule, readinessData] = await Promise.all([
        exchange.listConnections(),
        risk.getRule(),
        risk.readiness(),
      ])
      setRows(data ?? [])
      setRiskGateEnabled(!!rule?.rule?.isEnabled)
      setReadiness({
        ready: readinessData.ready,
        blockers: readinessData.blockers ?? [],
        hasSafeTradableConnection: readinessData.hasSafeTradableConnection,
        hasRiskPolicyEnabled: readinessData.hasRiskPolicyEnabled,
        liveAutomationEnabled: readinessData.liveAutomationEnabled,
        maintenanceReason: readinessData.maintenanceReason,
      })
    } catch {
      setRows([])
      setRiskGateEnabled(null)
      setReadiness(null)
      setError('Unable to load exchange connections.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  useEffect(() => {
    let cancelled = false
    exchange
      .outboundIp()
      .then((d) => {
        if (!cancelled) setOutboundIp({ ip: d.ip, note: d.note, error: d.error })
      })
      .catch(() => {
        if (!cancelled) setOutboundIp({ ip: null, error: 'Could not load outbound IP (is the API running?)' })
      })
    return () => {
      cancelled = true
    }
  }, [])

  const connect = async () => {
    setSubmitting(true)
    setError(null)
    const k = apiKey.trim().replace(/^["']+|["']+$/g, '').replace(/:+$/g, '').trim()
    const s = apiSecret.trim().replace(/^["']+|["']+$/g, '').replace(/:+$/g, '').trim()
    if (k.length < 50 || s.length < 50) {
      setError(
        `Binance API key and secret are each usually ~64 characters (yours: ${k.length} / ${s.length}). Copy the full key and the full secret from Binance — partial text or “preview” snippets will fail.`,
      )
      setSubmitting(false)
      return
    }
    try {
      await exchange.createConnection({ exchange: 'BINANCE', label, apiKey: k, apiSecret: s })
      setApiKey('')
      setApiSecret('')
      await load()
    } catch (e) {
      setError(formatAxiosError(e, 'Failed to connect exchange key. Verify API key/secret and permissions.'))
    } finally {
      setSubmitting(false)
    }
  }

  const test = async (id: string) => {
    setError(null)
    try {
      await exchange.testConnection(id)
      await load()
    } catch (e) {
      setError(formatAxiosError(e, 'Connection test failed.'))
    }
  }

  const deactivate = async (id: string) => {
    setError(null)
    try {
      await exchange.deactivateConnection(id)
      await load()
    } catch {
      setError('Failed to deactivate connection.')
    }
  }

  const hasSafeTradableKey = readiness?.hasSafeTradableConnection ?? rows.some((row) => row.isActive && row.canTrade && !row.canWithdraw)
  const readinessOk = readiness?.ready ?? (hasSafeTradableKey && riskGateEnabled === true)

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Exchange connection</h1>
        <p className="text-gray-400 mt-1">
          Non-custodial trading: your funds stay on the exchange. We never ask you to deposit crypto into CryptoFlow.
        </p>
      </div>

      <Card
        className={`bg-[#1a1a1a] border ${
          readinessOk ? 'border-emerald-500/35' : 'border-amber-500/35'
        }`}
      >
        <CardHeader>
          <CardTitle className="text-white">Automation readiness</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-gray-300">
          <p className={hasSafeTradableKey ? 'text-emerald-300' : 'text-amber-300'}>
            {hasSafeTradableKey
              ? 'OK: at least one active Binance key is trade-enabled and withdraw-disabled.'
              : 'Missing: add an active trade-only key (withdraw must be disabled).'}
          </p>
          <p className={riskGateEnabled ? 'text-emerald-300' : 'text-amber-300'}>
            {riskGateEnabled
              ? 'OK: risk policy is enabled.'
              : 'Missing: enable risk policy before starting live automation.'}
          </p>
          {!readinessOk && (
            <>
              {readiness?.blockers?.length ? (
                <ul className="text-xs text-amber-200/90 space-y-1">
                  {readiness.blockers.map((blocker) => (
                    <li key={blocker}>- {blocker}</li>
                  ))}
                </ul>
              ) : null}
              <p className="text-xs text-gray-400">
                Live start preflight checks use this status. Configure risk in{' '}
                <Link href="/settings" className="text-amber-300 underline hover:text-amber-200">
                  Settings
                </Link>
                .
              </p>
            </>
          )}
        </CardContent>
      </Card>

      <Card className="bg-[#1a1a1a] border-[#2a2a2a] border-amber-500/20">
        <CardHeader>
          <CardTitle className="text-white">Why this is not “one click” like Google login</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-300 leading-relaxed">
          <p>
            Binance (and most exchanges) do not offer a universal “Sign in with Binance” button that grants third-party apps permission to trade your spot account.
            The standard, regulator-aligned pattern for <strong className="text-white">non-custodial</strong> bots is: you create an API key in your Binance account, restrict it (spot only, no withdrawal), then authorize our app to trade on your behalf.
          </p>
          <p>
            That is the same model used by professional trading tools: it keeps control of funds with you on the exchange while allowing automated orders.
          </p>
          <a
            href={BINANCE_API_HELP}
            target="_blank"
            rel="noopener noreferrer"
            className="text-amber-500 hover:underline"
          >
            Binance: how to create API keys
          </a>
        </CardContent>
      </Card>

      <Card className="bg-[#1a1a1a] border-[#2a2a2a] border-cyan-500/20">
        <CardHeader>
          <CardTitle className="text-white">Binance IP whitelist (this server)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-gray-300">
          <p>
            Binance does not see “localhost”. It sees the <strong className="text-white">public IP of the computer running the API</strong>{' '}
            (<code className="text-cyan-300/90">npm run dev:api</code> or your Docker host). Use the address below in Binance → API Management →
            restrict access to trusted IPs (if you use that option).
          </p>
          {outboundIp?.error && <p className="text-amber-400">{outboundIp.error}</p>}
          {outboundIp?.ip && (
            <div className="flex flex-wrap items-center gap-2">
              <code className="rounded bg-black/40 px-3 py-2 font-mono text-emerald-300">{outboundIp.ip}</code>
              <Button
                type="button"
                variant="outline"
                className="border-cyan-500/40"
                onClick={() => void navigator.clipboard.writeText(outboundIp.ip ?? '')}
              >
                Copy IP
              </Button>
            </div>
          )}
          {outboundIp?.note && <p className="text-xs text-gray-500">{outboundIp.note}</p>}
          <p className="text-xs text-amber-200/80">
            Error <code className="text-amber-100">-2015</code> almost always means IP whitelist mismatch, wrong secret, or a testnet key hitting mainnet — see checklist above.
          </p>
        </CardContent>
      </Card>

      <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
        <CardHeader>
          <CardTitle className="text-white">Fastest safe setup (under a minute)</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <ol className="list-decimal list-inside space-y-2 text-sm text-gray-300">
            <li>Open Binance API management and create a new key.</li>
            <li>
              Enable <strong className="text-white">Enable Reading</strong> and <strong className="text-white">Spot &amp; Margin trading</strong>. Leave{' '}
              <strong className="text-white">Withdrawals disabled</strong>. Use a <strong className="text-white">mainnet</strong> key for default setup; Spot testnet keys require{' '}
              <code className="text-cyan-300/90">BINANCE_BASE_URL=https://testnet.binance.vision</code> in <code className="text-cyan-300/90">apps/api/.env</code>.
            </li>
            <li>Copy the key and secret here and click Connect — we encrypt them server-side.</li>
            <li>Go to <strong className="text-white">Wallet</strong> and tap <strong className="text-white">Sync</strong> to pull balances, then use <strong className="text-white">Trading</strong>.</li>
          </ol>
          <Button asChild className="w-full sm:w-auto">
            <a href="https://www.binance.com/en/my/settings/api-management" target="_blank" rel="noopener noreferrer">
              Open Binance API settings
            </a>
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
        <CardHeader><CardTitle className="text-white">Paste API credentials</CardTitle></CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-4 gap-3">
          <p className="md:col-span-4 text-xs text-zinc-500 -mt-1 mb-1">
            Paste the <strong className="text-zinc-400">entire</strong> API key (~64 chars) and secret from Binance. If you use IP restrictions, the IP on your key must match the <strong className="text-zinc-400">Outbound IP</strong> card above (or add both your home IP and that IP in Binance).
          </p>
          <Input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Connection label" />
          <Input value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="API key" autoComplete="off" />
          <Input value={apiSecret} onChange={(e) => setApiSecret(e.target.value)} placeholder="API secret" type="password" autoComplete="off" />
          <Button onClick={connect} disabled={submitting || !apiKey || !apiSecret}>
            {submitting ? 'Connecting...' : 'Connect'}
          </Button>
        </CardContent>
      </Card>

      <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
        <CardHeader><CardTitle className="text-white">Connected keys</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {error && <p className="text-red-400">{error}</p>}
          {loading ? (
            <p className="text-gray-400">Loading...</p>
          ) : rows.length === 0 ? (
            <p className="text-gray-400">No exchange keys connected yet.</p>
          ) : (
            rows.map((row) => (
              <div key={row.id} className="flex items-center justify-between rounded-lg border border-[#2a2a2a] bg-[#141414] px-4 py-3">
                <div>
                  <p className="text-white font-medium">{row.exchange} - {row.label || 'Unnamed'}</p>
                  <p className="text-xs text-gray-400">
                    {row.isActive ? 'Active' : 'Inactive'} | Trade: {row.canTrade ? 'Yes' : 'No'} | Read: {row.canRead ? 'Yes' : 'No'} | Withdraw:{' '}
                    {row.canWithdraw ? 'Yes' : 'No'}
                    {!row.canTrade && row.isActive && (
                      <span className="block mt-1 text-amber-400/90">
                        If you enabled Spot trading on Binance, click <strong>Test</strong> to refresh permissions (we detect SPOT, MARGIN, and TRD_GRP_* keys).
                      </span>
                    )}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button variant="outline" onClick={() => test(row.id)}>Test</Button>
                  <Button variant="outline" onClick={() => deactivate(row.id)} className="text-red-400 border-red-400/40">
                    Deactivate
                  </Button>
                </div>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
