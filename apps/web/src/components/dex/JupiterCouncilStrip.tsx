'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { dexJupiter, type CouncilStatus, type JupiterSuperMachineStatus } from '@/lib/api'

import { connectSocket } from '@/lib/socket'

type Props = {
  watchSymbol: string | null
}

export function JupiterCouncilStrip({ watchSymbol }: Props) {
  const [council, setCouncil] = useState<CouncilStatus | null>(null)
  const [sm, setSm] = useState<JupiterSuperMachineStatus | null>(null)

  useEffect(() => {
    const load = () => {
      void dexJupiter.councilStatus().then(setCouncil).catch(() => null)
      void dexJupiter.superMachineStatus().then(setSm).catch(() => null)
    }
    load()

    const socket = connectSocket()
    const onCouncil = () => void dexJupiter.councilStatus().then(setCouncil).catch(() => null)
    const onActivity = () => void dexJupiter.superMachineStatus().then(setSm).catch(() => null)

    socket.on('council:decision', onCouncil)
    socket.on('super-machine:activity', onActivity)

    return () => {
      socket.off('council:decision', onCouncil)
      socket.off('super-machine:activity', onActivity)
    }
  }, [])

  const last = council?.lastDecision
  const smOn = sm?.settings.enabled ?? false
  const smWatch = sm?.settings.watchSymbol ?? null

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
        {smWatch ? ` · ${smWatch.replace(/USDT$/i, '')}` : watchSymbol ? ` · watching ${watchSymbol.replace(/USDT$/i, '')}` : ''}
      </span>
      <Link href="/agents" className="ml-auto text-violet-400 hover:text-violet-300">
        Open council →
      </Link>
    </div>
  )
}
