'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { dexJupiter, type CouncilStatus } from '@/lib/api'

import { connectSocket } from '@/lib/socket'

type Props = {
  watchSymbol: string | null
}

export function JupiterCouncilStrip({ watchSymbol }: Props) {
  const [council, setCouncil] = useState<CouncilStatus | null>(null)
  const [sm, setSm] = useState<{ enabled: boolean; watchSymbol: string | null } | null>(null)

  useEffect(() => {
    // Single initial load on mount
    void dexJupiter.councilStatus().then(setCouncil).catch(() => null)
    void dexJupiter.superMachineSettings().then((s) => {
      setSm({ enabled: s.enabled, watchSymbol: s.watchSymbol ?? null })
    }).catch(() => null)

    const socket = connectSocket()
    const onCouncil = () => void dexJupiter.councilStatus().then(setCouncil).catch(() => null)
    const onSettings = (next: { enabled?: boolean; watchSymbol?: string | null }) => {
      setSm({
        enabled: Boolean(next.enabled),
        watchSymbol: next.watchSymbol ?? null,
      })
    }

    socket.on('council:decision', onCouncil)
    socket.on('super-machine:settings', onSettings)

    return () => {
      socket.off('council:decision', onCouncil)
      socket.off('super-machine:settings', onSettings)
    }
  }, [])

  const last = council?.lastDecision
  const smOn = sm?.enabled ?? false
  const smWatch = sm?.watchSymbol ?? null

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[10px]">
      <span className="font-medium text-zinc-400">Council</span>
      <span className="text-zinc-500">·</span>
      {last ? (
        <span className="text-zinc-300">
          Last:{' '}
          <span className={last.action === 'BUY' ? 'text-emerald-400' : 'text-zinc-400'}>
            {last.action}
          </span>{' '}
          {last.symbol?.replace(/USDT$/i, '') ?? '—'} ({Math.round((last.consensus ?? 0) * 100)}% agree)
        </span>
      ) : (
        <span className="text-zinc-500">Council idle</span>
      )}
      <span className="text-zinc-600">|</span>
      <span className={smOn ? 'text-emerald-400' : 'text-zinc-500'}>
        Super Machine {smOn ? 'ON' : 'off'}
        {smOn && smWatch
          ? ` · ${smWatch.replace(/USDT$/i, '')}`
          : smOn && !smWatch
            ? ' · auto-scan all tokens'
            : watchSymbol
              ? ` · chart ${watchSymbol.replace(/USDT$/i, '')}`
              : ''}
      </span>
      <Link href="/agents" className="ml-auto text-violet-400 hover:text-violet-300">
        Open council →
      </Link>
    </div>
  )
}
