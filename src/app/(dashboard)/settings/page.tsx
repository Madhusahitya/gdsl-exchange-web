'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { auth, risk, support, telegram, type TelegramPrefs, type TelegramStatus } from '@/lib/api'

export default function SettingsPage() {
  const supportEmail = process.env.NEXT_PUBLIC_SUPPORT_EMAIL || 'support@koie.fin'
  const [email, setEmail] = useState<string | null>(null)
  const [loadingRisk, setLoadingRisk] = useState(true)
  const [savingRisk, setSavingRisk] = useState(false)
  const [riskStatus, setRiskStatus] = useState<string | null>(null)
  const [riskEnabled, setRiskEnabled] = useState(true)
  const [maxOrderNotional, setMaxOrderNotional] = useState('250')
  const [maxOpenNotional, setMaxOpenNotional] = useState('1000')
  const [maxDailyLoss, setMaxDailyLoss] = useState('100')
  const [cooldownMinutes, setCooldownMinutes] = useState('60')
  const [maxLosingStreak, setMaxLosingStreak] = useState('3')
  const [riskEvents, setRiskEvents] = useState<Array<{
    id: string
    kind: string
    severity: string
    message: string
    createdAt: string
  }>>([])
  const [readiness, setReadiness] = useState<{
    ready: boolean
    blockers: string[]
    liveAutomationEnabled: boolean
    maintenanceReason: string | null
    hasSafeTradableConnection: boolean
    hasRiskPolicyEnabled: boolean
  } | null>(null)
  const [tgStatus, setTgStatus] = useState<TelegramStatus | null>(null)
  const [tgLoading, setTgLoading] = useState(true)
  const [tgError, setTgError] = useState<string | null>(null)
  const [tgLinkInfo, setTgLinkInfo] = useState<{
    code: string
    deepLink: string | null
    command: string
    expiresAt: string
  } | null>(null)
  const [tgBusy, setTgBusy] = useState(false)
  const [tgMessage, setTgMessage] = useState<string | null>(null)
  const [helpSubject, setHelpSubject] = useState('')
  const [helpMessage, setHelpMessage] = useState('')
  const [helpBusy, setHelpBusy] = useState(false)
  const [helpStatus, setHelpStatus] = useState<string | null>(null)

  const reloadTelegram = async () => {
    setTgLoading(true)
    setTgError(null)
    try {
      const status = await telegram.status()
      setTgStatus(status)
    } catch {
      setTgError('Could not load Telegram status.')
    } finally {
      setTgLoading(false)
    }
  }

  useEffect(() => {
    auth.me().then((u) => setEmail(u.email)).catch(() => setEmail(null))
    risk
      .getRule()
      .then((data) => {
        if (!data.rule) return
        setRiskEnabled(data.rule.isEnabled)
        setMaxOrderNotional(data.rule.maxOrderNotional !== null ? String(data.rule.maxOrderNotional) : '')
        setMaxOpenNotional(data.rule.maxOpenNotional !== null ? String(data.rule.maxOpenNotional) : '')
        setMaxDailyLoss(data.rule.maxDailyLoss !== null ? String(data.rule.maxDailyLoss) : '')
        setCooldownMinutes(String(data.rule.cooldownMinutes))
        setMaxLosingStreak(String(data.rule.maxLosingStreak))
      })
      .catch(() => setRiskStatus('Could not load risk settings.'))
      .finally(() => setLoadingRisk(false))

    risk
      .listEvents(20)
      .then((data) => setRiskEvents(data.events ?? []))
      .catch(() => setRiskEvents([]))
    risk
      .readiness()
      .then((data) =>
        setReadiness({
          ready: data.ready,
          blockers: data.blockers ?? [],
          liveAutomationEnabled: data.liveAutomationEnabled,
          maintenanceReason: data.maintenanceReason,
          hasSafeTradableConnection: data.hasSafeTradableConnection,
          hasRiskPolicyEnabled: data.hasRiskPolicyEnabled,
        })
      )
      .catch(() => setReadiness(null))

    void reloadTelegram()
  }, [])

  const handleStartLink = async () => {
    setTgBusy(true)
    setTgMessage(null)
    try {
      const data = await telegram.startLink()
      if (!data.ok) {
        setTgMessage(data.message ?? data.error ?? 'Could not start linking.')
      } else {
        setTgLinkInfo({
          code: data.code,
          deepLink: data.deepLink,
          command: data.command,
          expiresAt: data.expiresAt,
        })
      }
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { message?: string; error?: string } } }
      setTgMessage(ax.response?.data?.message ?? ax.response?.data?.error ?? 'Could not start linking. Try again.')
    } finally {
      setTgBusy(false)
    }
  }

  const handleDisconnect = async (linkId?: string) => {
    setTgBusy(true)
    setTgMessage(null)
    try {
      await telegram.disconnect(linkId)
      setTgLinkInfo(null)
      setTgMessage(linkId ? 'Telegram account removed.' : 'All Telegram accounts disconnected.')
      await reloadTelegram()
    } finally {
      setTgBusy(false)
    }
  }

  const handleSendTest = async () => {
    setTgBusy(true)
    setTgMessage(null)
    try {
      const data = await telegram.test()
      setTgMessage(
        data.ok
          ? 'Test message sent. Check Telegram.'
          : (data.error === 'not_linked'
              ? 'Link Telegram first, then try again.'
              : `Could not send test message — unblock @${tgStatus?.botUsername ?? 'the bot'} in Telegram and retry.`),
      )
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      setTgMessage(ax.response?.data?.error ?? 'Could not send test message.')
    } finally {
      setTgBusy(false)
    }
  }

  const togglePref = async (key: keyof TelegramPrefs, value: boolean) => {
    if (!tgStatus?.link) return
    const next: TelegramPrefs = { ...tgStatus.link.prefs, [key]: value }
    setTgStatus({ ...tgStatus, link: { ...tgStatus.link, prefs: next } })
    try {
      const result = await telegram.updatePrefs({ [key]: value })
      if (result.ok && result.prefs) {
        setTgStatus((prev) => (prev?.link ? { ...prev, link: { ...prev.link, prefs: result.prefs! } } : prev))
      }
    } catch {
      setTgMessage('Could not save preference.')
    }
  }

  const toNullableNumber = (value: string): number | null => {
    const trimmed = value.trim()
    if (!trimmed) return null
    const parsed = Number(trimmed)
    return Number.isFinite(parsed) ? parsed : null
  }

  const saveRisk = async () => {
    setSavingRisk(true)
    setRiskStatus(null)
    try {
      await risk.updateRule({
        isEnabled: riskEnabled,
        maxOrderNotional: toNullableNumber(maxOrderNotional),
        maxOpenNotional: toNullableNumber(maxOpenNotional),
        maxDailyLoss: toNullableNumber(maxDailyLoss),
        cooldownMinutes: Math.max(0, Math.floor(Number(cooldownMinutes || 0))),
        maxLosingStreak: Math.max(0, Math.floor(Number(maxLosingStreak || 0))),
      })
      setRiskStatus('Risk settings saved.')
      const [events, readinessData] = await Promise.all([risk.listEvents(20), risk.readiness()])
      setRiskEvents(events.events ?? [])
      setReadiness({
        ready: readinessData.ready,
        blockers: readinessData.blockers ?? [],
        liveAutomationEnabled: readinessData.liveAutomationEnabled,
        maintenanceReason: readinessData.maintenanceReason,
        hasSafeTradableConnection: readinessData.hasSafeTradableConnection,
        hasRiskPolicyEnabled: readinessData.hasRiskPolicyEnabled,
      })
    } catch {
      setRiskStatus('Failed to save risk settings.')
    } finally {
      setSavingRisk(false)
    }
  }

  const sendHelp = async () => {
    setHelpStatus(null)
    const subject = helpSubject.trim()
    const message = helpMessage.trim()
    if (subject.length < 3 || message.length < 8) {
      setHelpStatus('Please enter a valid subject and message.')
      return
    }
    setHelpBusy(true)
    try {
      await support.contact({
        subject,
        message,
        email: email ?? undefined,
      })
      setHelpSubject('')
      setHelpMessage('')
      setHelpStatus('Support request submitted. We will contact you soon.')
    } catch {
      setHelpStatus('Could not submit support request. Use direct email below.')
    } finally {
      setHelpBusy(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-white">Settings</h1>
      </div>

      <Card className="border-white/10 bg-[#0a0a0f]">
        <CardHeader>
          <CardTitle className="text-base text-white">Account</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-zinc-400">
          <p>
            Email: <span className="text-white">{email ?? '—'}</span>
          </p>
          <p>
            Exchange API keys:{' '}
            <Link href="/exchange" className="text-emerald-400 hover:underline">
              Manage connections
            </Link>
          </p>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-[#0a0a0f]">
        <CardHeader>
          <CardTitle className="text-base text-white">Help and support</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-zinc-400">
          <p>
            Need help? Submit your issue and we will track it from your account inbox.
          </p>
          <Input
            value={helpSubject}
            onChange={(e) => setHelpSubject(e.target.value)}
            placeholder="Subject"
            className="border-white/10 bg-black/30"
          />
          <textarea
            value={helpMessage}
            onChange={(e) => setHelpMessage(e.target.value)}
            placeholder="Describe the issue..."
            className="min-h-[110px] w-full rounded-md border border-white/10 bg-black/30 px-3 py-2 text-sm text-white outline-none ring-0"
          />
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={() => void sendHelp()} disabled={helpBusy}>
              {helpBusy ? 'Sending...' : 'Submit support request'}
            </Button>
            <a
              href={`mailto:${supportEmail}?subject=${encodeURIComponent('Trading bot help')}`}
              className="inline-flex items-center rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-2 text-xs font-medium text-blue-200 hover:bg-blue-500/20"
            >
              Email support
            </a>
          </div>
          {helpStatus ? (
            <p className={helpStatus.includes('submitted') ? 'text-emerald-400' : 'text-amber-300'}>{helpStatus}</p>
          ) : null}
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-[#0a0a0f]">
        <CardHeader>
          <CardTitle className="text-base text-white">Automated trading risk policy</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-zinc-400">
          <p>
            These limits are enforced server-side before orders are placed. Leave a field blank to disable that specific limit.
          </p>
          <label className="flex items-center gap-2 text-zinc-200">
            <input
              type="checkbox"
              checked={riskEnabled}
              onChange={(e) => setRiskEnabled(e.target.checked)}
              className="accent-emerald-500"
            />
            Enable risk gate
          </label>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <Input value={maxOrderNotional} onChange={(e) => setMaxOrderNotional(e.target.value)} placeholder="Max order notional (USDT)" />
            <Input value={maxOpenNotional} onChange={(e) => setMaxOpenNotional(e.target.value)} placeholder="Max open notional (USDT)" />
            <Input value={maxDailyLoss} onChange={(e) => setMaxDailyLoss(e.target.value)} placeholder="Max daily loss (USDT)" />
            <Input value={cooldownMinutes} onChange={(e) => setCooldownMinutes(e.target.value)} placeholder="Cooldown minutes after loss streak" />
            <Input value={maxLosingStreak} onChange={(e) => setMaxLosingStreak(e.target.value)} placeholder="Max consecutive losses" />
          </div>
          {riskStatus && <p className={riskStatus.includes('saved') ? 'text-emerald-400' : 'text-red-400'}>{riskStatus}</p>}
          <Button onClick={saveRisk} disabled={loadingRisk || savingRisk}>
            {savingRisk ? 'Saving...' : 'Save risk settings'}
          </Button>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-[#0a0a0f]">
        <CardHeader>
          <CardTitle className="text-base text-white">Live automation status</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm text-zinc-400">
          {readiness ? (
            <>
              <p className={readiness.liveAutomationEnabled ? 'text-emerald-400' : 'text-amber-300'}>
                Operator switch: {readiness.liveAutomationEnabled ? 'Enabled' : 'Disabled'}
              </p>
              {readiness.maintenanceReason && (
                <p className="text-amber-300">Maintenance reason: {readiness.maintenanceReason}</p>
              )}
              <p className={readiness.hasSafeTradableConnection ? 'text-emerald-400' : 'text-amber-300'}>
                Trade-only key check: {readiness.hasSafeTradableConnection ? 'Passed' : 'Missing'}
              </p>
              <p className={readiness.hasRiskPolicyEnabled ? 'text-emerald-400' : 'text-amber-300'}>
                Risk policy check: {readiness.hasRiskPolicyEnabled ? 'Passed' : 'Disabled'}
              </p>
              <p className={readiness.ready ? 'text-emerald-400' : 'text-amber-300'}>
                Overall live preflight: {readiness.ready ? 'Ready' : 'Blocked'}
              </p>
              {!readiness.ready && readiness.blockers.length > 0 && (
                <ul className="space-y-1 text-xs text-amber-200/90">
                  {readiness.blockers.map((blocker) => (
                    <li key={blocker}>- {blocker}</li>
                  ))}
                </ul>
              )}
            </>
          ) : (
            <p>Could not load live automation status.</p>
          )}
          <p className="text-xs text-zinc-500">
            You can switch operator maintenance mode using <code>LIVE_AUTOMATION_ENABLED</code> and{' '}
            <code>LIVE_AUTOMATION_MAINTENANCE_REASON</code> in env, then restart the API.
          </p>
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-[#0a0a0f]">
        <CardHeader>
          <CardTitle className="text-base text-white">Telegram trading alerts</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm text-zinc-400">
          {tgLoading ? (
            <p>Loading Telegram status…</p>
          ) : !tgStatus?.configured ? (
            <p className="text-amber-300">
              Telegram is not configured on the server. Set <code>TELEGRAM_BOT_TOKEN</code> and{' '}
              <code>TELEGRAM_BOT_USERNAME</code> in the API environment, then restart.
            </p>
          ) : tgStatus.botVerified === false ? (
            <div className="space-y-2 rounded border border-amber-500/30 bg-amber-500/10 p-3 text-amber-100">
              <p className="font-medium">Telegram bot is not reachable</p>
              <p className="text-sm text-amber-200/90">
                The server points to{' '}
                {tgStatus.botUsername ? (
                  <code className="text-amber-100">@{tgStatus.botUsername}</code>
                ) : (
                  'a bot username'
                )}{' '}
                but Telegram does not recognize it. The bot may have been deleted or renamed in @BotFather.
              </p>
              {tgStatus.botError ? (
                <p className="font-mono text-xs text-amber-300/80">{tgStatus.botError}</p>
              ) : null}
              <p className="text-xs text-amber-200/80">
                Ask the operator to create a bot via @BotFather, then set <code>TELEGRAM_BOT_TOKEN</code> and{' '}
                <code>TELEGRAM_BOT_USERNAME</code> on the API server and restart.
              </p>
            </div>
          ) : (tgStatus.links?.length ?? 0) > 0 ? (
            <div className="space-y-3">
              <p className="text-emerald-300">
                {tgStatus.links.length} of {tgStatus.maxLinks ?? 3} Telegram accounts connected
                Machine alerts.
              </p>
              <ul className="space-y-2">
                {tgStatus.links.map((link) => (
                  <li
                    key={link.id}
                    className="flex flex-wrap items-center justify-between gap-2 rounded border border-white/10 bg-black/20 px-3 py-2"
                  >
                    <span className="text-zinc-200">
                      @{link.username ?? link.firstName ?? 'Telegram user'} ·{' '}
                      {new Date(link.linkedAt).toLocaleString()}
                    </span>
                    <Button
                      onClick={() => void handleDisconnect(link.id)}
                      disabled={tgBusy}
                      variant="outline"
                      size="sm"
                      className="border-red-500/40 text-red-300"
                    >
                      Remove
                    </Button>
                  </li>
                ))}
              </ul>
              <div className="grid gap-2 md:grid-cols-2">
                {tgStatus.categories.map((cat) => {
                  const enabled = tgStatus.link?.prefs?.[cat.key] ?? false
                  return (
                    <label
                      key={cat.key}
                      className="flex items-start gap-2 rounded border border-white/10 bg-black/20 p-3"
                    >
                      <input
                        type="checkbox"
                        className="mt-1 accent-emerald-500"
                        checked={enabled}
                        onChange={(e) => void togglePref(cat.key, e.target.checked)}
                      />
                      <span>
                        <span className="block text-zinc-200">{cat.label}</span>
                        <span className="block text-xs text-zinc-500">{cat.description}</span>
                      </span>
                    </label>
                  )
                })}
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={handleSendTest} disabled={tgBusy} variant="outline">
                  Send test alert
                </Button>
                {(tgStatus.links?.length ?? 0) < (tgStatus.maxLinks ?? 3) ? (
                  <Button onClick={handleStartLink} disabled={tgBusy} variant="outline">
                    Add another Telegram
                  </Button>
                ) : null}
                <Button
                  onClick={() => void handleDisconnect()}
                  disabled={tgBusy}
                  variant="outline"
                  className="border-red-500/40 text-red-300"
                >
                  Disconnect all
                </Button>
              </div>
              {tgMessage && <p className="text-emerald-300">{tgMessage}</p>}
            </div>
          ) : (
            <div className="space-y-3">
              <p>
                Connect up to <strong className="text-zinc-200">3 Telegram accounts</strong> to receive simple text
                alerts when Super Machine opens or closes a Jupiter trade — invested amount, sold amount, and profit/loss.
              </p>
              {!tgLinkInfo ? (
                <Button onClick={handleStartLink} disabled={tgBusy}>
                  {tgBusy ? 'Generating link…' : 'Connect Telegram'}
                </Button>
              ) : (
                <div className="space-y-3 rounded border border-emerald-500/20 bg-emerald-500/5 p-3">
                  <p className="text-zinc-200">
                    1. Open the bot
                    {tgLinkInfo.deepLink ? (
                      <>
                        {' '}
                        <a
                          href={tgLinkInfo.deepLink}
                          target="_blank"
                          rel="noreferrer"
                          className="text-emerald-300 underline"
                        >
                          {tgLinkInfo.deepLink}
                        </a>
                      </>
                    ) : (
                      ' on Telegram'
                    )}
                    .
                  </p>
                  <p className="text-zinc-200">
                    2. Send this command to the bot:{' '}
                    <code className="rounded bg-black/40 px-2 py-0.5 font-mono text-emerald-200">{tgLinkInfo.command}</code>
                  </p>
                  <p className="text-xs text-zinc-500">
                    Code expires {new Date(tgLinkInfo.expiresAt).toLocaleString()}. After confirmation, refresh this
                    page.
                  </p>
                  <div className="flex flex-wrap gap-2">
                    <Button onClick={() => void reloadTelegram()} variant="outline">
                      I have linked it — refresh
                    </Button>
                    <Button onClick={handleStartLink} variant="outline" disabled={tgBusy}>
                      Generate new code
                    </Button>
                  </div>
                </div>
              )}
              {tgError && <p className="text-red-400">{tgError}</p>}
              {tgMessage && <p className="text-amber-300">{tgMessage}</p>}
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-white/10 bg-[#0a0a0f]">
        <CardHeader>
          <CardTitle className="text-base text-white">Recent risk events</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm text-zinc-400">
          {riskEvents.length === 0 ? (
            <p>No recent risk violations.</p>
          ) : (
            riskEvents.map((event) => (
              <div key={event.id} className="rounded border border-white/10 bg-black/20 p-3">
                <p className="text-zinc-200">
                  [{event.kind}] {event.message}
                </p>
                <p className="text-xs text-zinc-500">
                  {new Date(event.createdAt).toLocaleString()} • {event.severity}
                </p>
              </div>
            ))
          )}
        </CardContent>
      </Card>
    </div>
  )
}
