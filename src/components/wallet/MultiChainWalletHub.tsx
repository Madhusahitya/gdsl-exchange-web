'use client'

import { useState } from 'react'
import { PersonalWalletPanel } from '@/components/wallet/PersonalWalletPanel'
import { SolanaPersonalWalletSection } from '@/components/wallet/SolanaPersonalWalletSection'
import { OperatorPoolInfoCard } from '@/components/wallet/OperatorPoolInfoCard'
import { WalletActivityFeed } from '@/components/wallet/WalletActivityFeed'
import { WalletChainHistory } from '@/components/wallet/WalletChainHistory'
import { BrowserWalletsPanel } from '@/components/wallet/BrowserWalletsPanel'

const TABS = [
  { id: 'browser', label: 'Connect your wallet' },
  { id: 'bsc', label: 'BSC personal wallet' },
  { id: 'solana', label: 'Solana personal wallet' },
  { id: 'cross', label: 'Cross-chain & operator' },
  { id: 'activity', label: 'All activity' },
] as const

type TabId = (typeof TABS)[number]['id']

export function MultiChainWalletHub() {
  const [tab, setTab] = useState<TabId>('browser')

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1 rounded-lg border border-white/10 bg-[#0a0a0f] p-1">
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => setTab(t.id)}
            className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
              tab === t.id
                ? t.id === 'solana'
                  ? 'bg-violet-600 text-white'
                  : t.id === 'cross'
                    ? 'bg-amber-600 text-white'
                    : t.id === 'browser'
                      ? 'bg-sky-600 text-white'
                      : 'bg-emerald-600 text-white'
                : 'text-zinc-400 hover:bg-white/5 hover:text-white'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'browser' ? <BrowserWalletsPanel /> : null}

      {tab === 'bsc' ? <PersonalWalletPanel /> : null}

      {tab === 'solana' ? <SolanaPersonalWalletSection /> : null}

      {tab === 'cross' ? (
        <div className="space-y-4">
          <OperatorPoolInfoCard />
          <WalletChainHistory scope="cross" />
        </div>
      ) : null}

      {tab === 'activity' ? <WalletActivityFeed chainFilter="all" /> : null}
    </div>
  )
}
