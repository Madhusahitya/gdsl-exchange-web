'use client'

import { useCallback, useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { personalWallet } from '@/lib/api'

function shortAddr(addr: string): string {
  return `${addr.slice(0, 8)}…${addr.slice(-6)}`
}

/** Explains operator bridge wallets used for BSC ↔ Solana settlement (not the user's wallet). */
export function OperatorPoolInfoCard() {
  const [status, setStatus] = useState<Awaited<ReturnType<typeof personalWallet.crossChainStatus>> | null>(null)
  const [transfers, setTransfers] = useState<
    Awaited<ReturnType<typeof personalWallet.crossChainTransfers>>['items']
  >([])

  const load = useCallback(async () => {
    try {
      const [st, tx] = await Promise.all([
        personalWallet.crossChainStatus(),
        personalWallet.crossChainTransfers().catch(() => ({ items: [] })),
      ])
      setStatus(st)
      setTransfers(tx.items.slice(0, 8))
    } catch {
      setStatus(null)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  return (
    <Card className="border-amber-500/25 bg-[#1a1a1a]">
      <CardHeader>
        <CardTitle className="text-white">Cross-chain bridge</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm">
        {!status?.enabled ? (
          <p className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-amber-100">
            {status?.message ?? 'Cross-chain transfer is not configured on this server yet.'}
          </p>
        ) : (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">BSC bridge wallet</p>
                <p className="mt-1 font-mono text-xs text-zinc-200 break-all">
                  {status.operatorAddresses?.bsc ?? '—'}
                </p>
                <p className="mt-1 text-emerald-300">
                  {status.operatorLiquidity?.bscUsdc != null
                    ? `${status.operatorLiquidity.bscUsdc.toFixed(2)} USDC available`
                    : '—'}
                </p>
              </div>
              <div className="rounded-lg border border-white/10 bg-black/30 px-3 py-2">
                <p className="text-[10px] uppercase tracking-wide text-zinc-500">Solana bridge wallet</p>
                <p className="mt-1 font-mono text-xs text-zinc-200 break-all">
                  {status.operatorAddresses?.solana ?? '—'}
                </p>
                <p className="mt-1 text-emerald-300">
                  {status.operatorLiquidity?.solUsdc != null
                    ? `${status.operatorLiquidity.solUsdc.toFixed(2)} USDC available`
                    : '—'}
                </p>
              </div>
            </div>
          </>
        )}

        <div>
          <p className="mb-2 text-xs font-medium text-zinc-300">Your cross-chain transfers</p>
          {transfers.length === 0 ? (
            <p className="text-xs text-zinc-500">No BSC ↔ Solana transfers yet.</p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-white/10">
              <table className="w-full min-w-[520px] text-left text-xs">
                <thead className="border-b border-white/10 text-zinc-500">
                  <tr>
                    <th className="px-3 py-2 font-normal">Time</th>
                    <th className="px-3 py-2 font-normal">Direction</th>
                    <th className="px-3 py-2 font-normal">Amount</th>
                    <th className="px-3 py-2 font-normal">Receive</th>
                    <th className="px-3 py-2 font-normal">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {transfers.map((t) => (
                    <tr key={t.id} className="border-b border-white/5">
                      <td className="px-3 py-2 text-zinc-400">
                        {new Date(t.requestedAt).toLocaleString()}
                      </td>
                      <td className="px-3 py-2 text-zinc-200">
                        {t.direction === 'BSC_TO_SOL' ? 'BSC → Solana' : 'Solana → BSC'}
                      </td>
                      <td className="px-3 py-2 font-mono text-white">{t.amount} USDC</td>
                      <td className="px-3 py-2 font-mono text-emerald-300">{t.creditAmount} USDC</td>
                      <td
                        className={`px-3 py-2 ${
                          t.status === 'COMPLETED'
                            ? 'text-emerald-300'
                            : t.status === 'FAILED'
                              ? 'text-rose-300'
                              : 'text-amber-300'
                        }`}
                      >
                        {t.status}
                        {t.errorMessage ? (
                          <span className="block text-[10px] text-zinc-500">{t.errorMessage.slice(0, 60)}</span>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <button type="button" onClick={() => void load()} className="text-[11px] text-zinc-500 hover:text-zinc-300">
          Refresh operator status
        </button>
      </CardContent>
    </Card>
  )
}
