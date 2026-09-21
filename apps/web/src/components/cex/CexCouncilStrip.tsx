'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { engine, type CouncilDecision } from '@/lib/api'
import { connectSocket } from '@/lib/socket'

type Props = {
  watchSymbol: string | null
  smEnabled: boolean
  smRunning: boolean
}

export function CexCouncilStrip({ watchSymbol, smEnabled, smRunning }: Props) {
  const [last, setLast] = useState<CouncilDecision | null>(null)

  useEffect(() => {
    const load = () => {
      void engine
        .cexCouncilStatus()
        .then((s) => setLast(s.lastDecision ?? null))
        .catch(() => null)
    }
    load()

    const socket = connectSocket()
    const onCouncil = () => load()
    socket.on('cex-council:decision', onCouncil)
    socket.on('super-machine:activity', onCouncil)
    return () => {
      socket.off('cex-council:decision', onCouncil)
      socket.off('super-machine:activity', onCouncil)
    }
  }, [])

  const smLabel = !smEnabled ? 'off' : smRunning ? 'ON' : 'paused'
  const pair = (last?.symbol ?? watchSymbol ?? '').replace(/USDT$/i, '')

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-lg border border-white/10 bg-black/30 px-2 py-1.5 text-[10px]">
      <span className="font-medium text-zinc-400">Council</span>
      <span className="text-zinc-500">·</span>
      {last ? (
        <span className="text-zinc-300">
          Last:{' '}
          <span className={last.action === 'BUY' ? 'text-emerald-400' : 'text-zinc-400'}>{last.action}</span>{' '}
          {pair || '—'} ({Math.round((last.consensus ?? 0) * 100)}% agree)
        </span>
      ) : (
        <span className="text-zinc-500">Council idle</span>
      )}
      <span className="text-zinc-600">|</span>
      <span className={smEnabled && smRunning ? 'text-emerald-400' : smEnabled ? 'text-amber-300' : 'text-zinc-500'}>
        Super Machine {smLabel}
        {watchSymbol ? ` · ${watchSymbol.replace(/USDT$/i, '')}` : ''}
      </span>
      <Link href="/agents" className="ml-auto text-sky-400 hover:text-sky-300">
        Open council →
      </Link>
    </div>
  )
}
