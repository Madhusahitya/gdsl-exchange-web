'use client'

import { useEffect, useState } from 'react'
import { dexJupiter } from '@/lib/api'

/** Suggests keeping USDC for trading vs earning yield on Jupiter Lend (external). */
export function JupiterIdleUsdcPanel() {
  const [usdc, setUsdc] = useState<number | null>(null)
  const [totalUsd, setTotalUsd] = useState<number | null>(null)
  const [bankedSkim, setBankedSkim] = useState<number>(0)

  useEffect(() => {
    void dexJupiter
      .walletBalances()
      .then((b) => {
        setUsdc(b.usdc)
        setTotalUsd(b.totalUsd)
      })
      .catch(() => {
        setUsdc(null)
        setTotalUsd(null)
      })
    void dexJupiter
      .positions()
      .then((r) => setBankedSkim(r.totalBankedSkimUsd ?? 0))
      .catch(() => setBankedSkim(0))
  }, [])

  if (usdc == null) return null

  const tradingReserve = 50
  const idle = Math.max(0, usdc - tradingReserve)

  return (
    <div className="rounded-lg border border-white/10 bg-gradient-to-br from-violet-500/5 to-transparent p-2.5">
      <p className="text-[11px] font-semibold text-zinc-200">Idle USDC</p>
      <p className="mt-1 font-mono text-sm text-white">${usdc.toFixed(2)} USDC</p>
      {bankedSkim > 0 ? (
        <p className="mt-1 rounded border border-emerald-500/20 bg-emerald-500/10 px-1.5 py-1 font-mono text-[10px] text-emerald-300">
          Super Machine skimmed +${bankedSkim.toFixed(2)} (already in this wallet · open lots still running)
        </p>
      ) : null}
      <p className="mt-1 text-[10px] leading-snug text-zinc-500">
        Keep ~${tradingReserve} for quick Jupiter buys.{' '}
        {idle >= 10 ? (
          <>
            You have ~${idle.toFixed(0)} idle — can earn yield on{' '}
            <a
              href="https://jup.ag/lend"
              target="_blank"
              rel="noopener noreferrer"
              className="text-violet-400 underline hover:text-violet-300"
            >
              Jupiter Lend
            </a>{' '}
            (separate from this trading wallet).
          </>
        ) : (
          'Fund more USDC to trade momentum picks.'
        )}
      </p>
      {totalUsd != null && totalUsd > 0 ? (
        <p className="mt-1 text-[9px] text-zinc-600">Wallet total ≈ ${totalUsd.toFixed(2)}</p>
      ) : null}
    </div>
  )
}
