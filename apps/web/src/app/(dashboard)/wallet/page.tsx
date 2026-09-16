'use client'

import { MultiChainWalletHub } from '@/components/wallet/MultiChainWalletHub'

export default function WalletPage() {
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold text-white">Wallet</h1>
      <MultiChainWalletHub />
    </div>
  )
}
