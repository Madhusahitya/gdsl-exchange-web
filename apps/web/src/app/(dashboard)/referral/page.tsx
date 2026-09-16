'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { referral } from '@/lib/api'

export default function ReferralPage() {
  const [status, setStatus] = useState<{
    referralCode: string | null
    hasAppliedReferral: boolean
    totalRewards: number
    referralCount: number
    trialBalance: number
  } | null>(null)
  const [code, setCode] = useState('')
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  const load = () => {
    referral
      .status()
      .then(setStatus)
      .catch(() => setStatus(null))
  }

  useEffect(() => {
    load()
  }, [])

  const apply = async (e: React.FormEvent) => {
    e.preventDefault()
    setErr('')
    setMsg('')
    setBusy(true)
    try {
      await referral.apply(code.trim())
      setMsg('Referral applied. Bonuses credited to trial balances.')
      setCode('')
      load()
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (ex: unknown) {
      const m =
        ex && typeof ex === 'object' && 'response' in ex
          ? (ex as { response?: { data?: { error?: string } } }).response?.data?.error
          : null
      setErr(m || 'Could not apply code')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Referral rewards</h1>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card className="border-white/10 bg-[#0a0a0f]">
          <CardHeader>
            <CardTitle className="text-base text-white">Your code</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tracking-wider text-emerald-300">
              {status?.referralCode ?? '—'}
            </p>
            <p className="mt-2 text-sm text-zinc-500">Trial balance: ${status?.trialBalance?.toFixed(2) ?? '—'}</p>
          </CardContent>
        </Card>
        <Card className="border-white/10 bg-[#0a0a0f]">
          <CardHeader>
            <CardTitle className="text-base text-white">Stats</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <p className="flex justify-between text-zinc-400">
              <span>Total rewards (USDT)</span>
              <span className="text-white">{status != null ? status.totalRewards.toFixed(2) : '—'}</span>
            </p>
            <p className="flex justify-between text-zinc-400">
              <span>Referrals</span>
              <span className="text-white">{status?.referralCount ?? '—'}</span>
            </p>
          </CardContent>
        </Card>
      </div>

      <Card className="border-white/10 bg-[#0a0a0f]">
        <CardHeader>
          <CardTitle className="text-base text-white">Apply a code</CardTitle>
        </CardHeader>
        <CardContent>
          {status?.hasAppliedReferral ? (
            <p className="text-sm text-zinc-400">You have already applied a referral code.</p>
          ) : (
            <form onSubmit={apply} className="max-w-md space-y-4">
              <div>
                <Label htmlFor="ref-code">Code</Label>
                <Input
                  id="ref-code"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  className="mt-1 border-white/10 bg-black/40 font-mono"
                  placeholder="8-character hex"
                  autoComplete="off"
                />
              </div>
              {err ? <p className="text-sm text-red-400">{err}</p> : null}
              {msg ? <p className="text-sm text-emerald-400">{msg}</p> : null}
              <Button type="submit" disabled={busy || !code.trim()} className="bg-emerald-500 text-black hover:bg-emerald-400">
                {busy ? 'Applying…' : 'Apply'}
              </Button>
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
