'use client'

import DexQuickTrade from '@/components/dashboard/DexQuickTrade'

export default function DexSwapPage() {
  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-semibold text-white">DEX Swap</h1>
      </div>
      <DexQuickTrade />
    </div>
  )
}

