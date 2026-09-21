'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { inbox, type InboxCategory, type InboxMessageRow } from '@/lib/api'

function categoryLabel(c: InboxCategory): string {
  switch (c) {
    case 'TOKEN_TRADING_SIGNAL':
      return 'Token signal'
    case 'BALANCE_ALLOCATION':
      return 'Balance ideas'
    case 'SYSTEM':
      return 'System'
    default:
      return c
  }
}

function signalFromMeta(meta: Record<string, unknown> | null): 'BUY' | 'SELL' | 'HOLD' | null {
  if (!meta || typeof meta.signal !== 'string') return null
  const s = meta.signal
  if (s === 'BUY' || s === 'SELL' || s === 'HOLD') return s
  return null
}

function splitPlainTechnical(body: string): { plain: string; rest: string } {
  const sep = '\n---\n'
  const idx = body.indexOf(sep)
  if (idx === -1) return { plain: body.trim(), rest: '' }
  return { plain: body.slice(0, idx).trim(), rest: body.slice(idx + sep.length).trim() }
}

function SignalBadge({ signal }: { signal: 'BUY' | 'SELL' | 'HOLD' }) {
  const cls =
    signal === 'BUY'
      ? 'border-emerald-500/40 bg-emerald-500/15 text-emerald-200'
      : signal === 'SELL'
        ? 'border-rose-500/40 bg-rose-500/15 text-rose-200'
        : 'border-amber-500/40 bg-amber-500/15 text-amber-100'
  const label = signal === 'BUY' ? 'Buy idea' : signal === 'SELL' ? 'Sell idea' : 'Hold · wait'
  return (
    <span className={`rounded-md border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${cls}`}>{label}</span>
  )
}

function fmtTime(iso: string): string {
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

export default function InboxPage() {
  const [items, setItems] = useState<InboxMessageRow[]>([])
  const [filter, setFilter] = useState<'all' | 'unread'>('all')
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')

  const load = useCallback(async () => {
    setErr('')
    setLoading(true)
    try {
      const res = await inbox.list({ limit: 80, unreadOnly: filter === 'unread' })
      setItems(res.items)
    } catch {
      setErr('Could not load inbox. Is the API running and are you signed in?')
    } finally {
      setLoading(false)
    }
  }, [filter])

  useEffect(() => {
    void load()
  }, [load])

  const onOpenRow = async (m: InboxMessageRow) => {
    if (m.readAt) return
    try {
      await inbox.markRead(m.id)
      setItems((prev) => prev.map((x) => (x.id === m.id ? { ...x, readAt: new Date().toISOString() } : x)))
      window.dispatchEvent(new CustomEvent('cf:inbox-updated'))
    } catch {
      /* ignore */
    }
  }

  const markAll = async () => {
    try {
      await inbox.markAllRead()
      await load()
      window.dispatchEvent(new CustomEvent('cf:inbox-updated'))
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="space-y-6">
      <Card className="overflow-hidden border-sky-500/25 bg-gradient-to-br from-sky-950/25 via-[#0b0d13] to-[#101826] shadow-[0_0_32px_rgba(56,189,248,0.1)]">
        <CardContent className="pt-5 pb-5">
          <h1 className="text-xl font-semibold text-white">Inbox</h1>
          <p className="mt-1 text-sm text-zinc-300/80">
            Token signals lead with a plain-English block (what HOLD / BUY / SELL means for you), then optional technical detail.
            Binance prices are reference-only — swaps run from Token Trading on BNB Chain via PancakeSwap when you confirm.
          </p>
        </CardContent>
      </Card>

      {err ? <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">{err}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          variant={filter === 'all' ? 'default' : 'outline'}
          size="sm"
          className={filter === 'all' ? 'bg-emerald-600 hover:bg-emerald-500' : 'border-white/15'}
          onClick={() => setFilter('all')}
        >
          All
        </Button>
        <Button
          type="button"
          variant={filter === 'unread' ? 'default' : 'outline'}
          size="sm"
          className={filter === 'unread' ? 'bg-emerald-600 hover:bg-emerald-500' : 'border-white/15'}
          onClick={() => setFilter('unread')}
        >
          Unread
        </Button>
        <Button type="button" variant="ghost" size="sm" className="text-zinc-400" onClick={() => void load()} disabled={loading}>
          Refresh
        </Button>
        <Button type="button" variant="outline" size="sm" className="ml-auto border-white/15" onClick={() => void markAll()}>
          Mark all read
        </Button>
      </div>

      <Card className="border-white/10 bg-[#0b0d13]/90 shadow-[0_8px_24px_rgba(0,0,0,0.25)]">
        <CardHeader className="pb-2">
          <CardTitle className="text-base text-white">Messages</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {loading ? <p className="text-sm text-zinc-500 font-mono">Loading…</p> : null}
          {!loading && items.length === 0 ? (
            <p className="text-sm text-zinc-500">No messages yet. Open Token Trading and run &quot;Sync alerts to inbox&quot;.</p>
          ) : null}
          {items.map((m) => {
            const sig = m.category === 'TOKEN_TRADING_SIGNAL' ? signalFromMeta(m.metadata) : null
            const { plain, rest } =
              m.category === 'TOKEN_TRADING_SIGNAL' ? splitPlainTechnical(m.body) : { plain: m.body, rest: '' }

            return (
              <button
                key={m.id}
                type="button"
                onClick={() => void onOpenRow(m)}
                className={`w-full rounded-xl border px-4 py-3 text-left transition-colors ${
                  m.readAt ? 'border-white/5 bg-white/[0.02]' : 'border-emerald-500/25 bg-emerald-500/5'
                }`}
              >
                <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="rounded bg-white/10 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wide text-zinc-300">
                    {categoryLabel(m.category)}
                  </span>
                  {sig ? <SignalBadge signal={sig} /> : null}
                  <span>{fmtTime(m.createdAt)}</span>
                  {!m.readAt ? <span className="text-emerald-400">Unread</span> : null}
                </div>
                <p className="mt-2 text-sm font-medium text-white">{m.title}</p>
                {m.category === 'TOKEN_TRADING_SIGNAL' && plain ? (
                  <>
                    <div className="mt-3 rounded-lg border border-sky-500/25 bg-sky-950/30 px-3 py-2 text-[12px] leading-snug text-zinc-100">
                      <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-sky-300/90">Summary</p>
                      <p className="whitespace-pre-wrap">{plain}</p>
                    </div>
                    {rest ? (
                      <div className="mt-3 max-h-52 overflow-y-auto rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                        <p className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-zinc-500">Details</p>
                        <p className="whitespace-pre-wrap text-[11px] leading-relaxed text-zinc-400">{rest}</p>
                      </div>
                    ) : null}
                  </>
                ) : (
                  <p className="mt-2 max-h-48 overflow-y-auto whitespace-pre-wrap text-xs leading-relaxed text-zinc-400">{m.body}</p>
                )}
              </button>
            )
          })}
        </CardContent>
      </Card>
    </div>
  )
}
