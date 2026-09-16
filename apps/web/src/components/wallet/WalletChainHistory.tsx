'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { personalWallet, type WalletActivityItem } from '@/lib/api'

type Scope = 'bsc' | 'solana' | 'cross' | 'all'

const TITLES: Record<Scope, string> = {
  bsc: 'BSC wallet history',
  solana: 'Solana wallet history',
  cross: 'Cross-chain transfer history',
  all: 'Wallet activity',
}

function statusClass(status: string): string {
  if (status === 'COMPLETED' || status === 'CLOSED') return 'text-emerald-300'
  if (status === 'FAILED') return 'text-rose-300'
  if (status === 'OPEN') return 'text-sky-300'
  if (status === 'CREDIT_PENDING') return 'text-amber-300'
  return 'text-amber-300'
}

export function WalletChainHistory({
  scope,
  title,
  refreshKey = 0,
}: {
  scope: Scope
  title?: string
  refreshKey?: number
}) {
  const [items, setItems] = useState<WalletActivityItem[]>([])
  const [loading, setLoading] = useState(true)
  const [retrying, setRetrying] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const res = await personalWallet.activity({ scope, limit: 50 }).catch(() => ({ items: [] }))
      setItems(res.items)
    } finally {
      setLoading(false)
    }
  }, [scope])

  useEffect(() => {
    void load()
  }, [load, refreshKey])

  const retryCredit = async (transferId: string) => {
    setRetrying(transferId)
    try {
      await personalWallet.crossChainRetry(transferId)
      toast.success('Cross-chain delivery completed on Solana')
      await load()
    } catch (e: unknown) {
      const ax = e as { response?: { data?: { error?: string } } }
      toast.error(ax.response?.data?.error ?? 'Still waiting — operator bridge wallet needs ~0.005 BNB for gas')
    } finally {
      setRetrying(null)
    }
  }

  return (
    <Card className="border-white/10 bg-[#1a1a1a]">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <div>
          <CardTitle className="text-white">{title ?? TITLES[scope]}</CardTitle>
          <p className="mt-1 text-xs text-zinc-500">
            Withdrawals, converts, and cross-chain moves for this wallet. On-chain deposits show as balance increases.
          </p>
        </div>
        <button type="button" onClick={() => void load()} className="text-xs text-zinc-500 hover:text-zinc-300">
          Refresh
        </button>
      </CardHeader>
      <CardContent className="overflow-x-auto p-0">
        {loading ? (
          <p className="px-4 py-6 text-sm text-zinc-500">Loading history…</p>
        ) : items.length === 0 ? (
          <p className="px-4 py-6 text-sm text-zinc-500">No activity yet.</p>
        ) : (
          <table className="w-full min-w-[640px] text-left text-xs">
            <thead className="border-b border-white/10 text-zinc-500">
              <tr>
                <th className="px-3 py-2 font-normal">Time</th>
                <th className="px-3 py-2 font-normal">Type</th>
                <th className="px-3 py-2 font-normal">Detail</th>
                <th className="px-3 py-2 font-normal">Amount</th>
                <th className="px-3 py-2 font-normal">Status</th>
                <th className="px-3 py-2 font-normal">Tx</th>
              </tr>
            </thead>
            <tbody>
              {items.map((row) => (
                <tr key={row.id} className="border-b border-white/5 hover:bg-white/[0.02]">
                  <td className="px-3 py-2 text-zinc-400">{new Date(row.at).toLocaleString()}</td>
                  <td className="px-3 py-2 font-medium text-white">{row.type}</td>
                  <td className="px-3 py-2 text-zinc-400">
                    {row.detail}
                    {row.statusNote ? (
                      <p className="mt-1 text-[10px] leading-snug text-amber-200/80">{row.statusNote}</p>
                    ) : null}
                  </td>
                  <td className="px-3 py-2 font-mono text-zinc-200">{row.amount}</td>
                  <td className={`px-3 py-2 ${statusClass(row.status)}`}>
                    <div className="space-y-1">
                      <span>{row.status}</span>
                      {row.canRetryCredit && row.transferId ? (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 border-amber-500/40 px-2 text-[10px] text-amber-100"
                          disabled={retrying === row.transferId}
                          onClick={() => void retryCredit(row.transferId!)}
                        >
                          {retrying === row.transferId ? 'Retrying…' : 'Retry delivery'}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                  <td className="px-3 py-2">
                    {row.txLink ? (
                      <span className="flex flex-wrap gap-2">
                        <a href={row.txLink} target="_blank" rel="noreferrer" className="text-sky-300 underline">
                          {row.type === 'Transfer' ? 'Debit' : 'View'}
                        </a>
                        {row.txLink2 ? (
                          <a href={row.txLink2} target="_blank" rel="noreferrer" className="text-violet-300 underline">
                            Credit
                          </a>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-zinc-600">—</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </CardContent>
    </Card>
  )
}
