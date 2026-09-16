'use client'

import type { Connector } from 'wagmi'
import { Button } from '@/components/ui/button'
import { getWalletConnectorPresentation } from '@/components/web3/walletLabels'

type Props = {
  connectors: readonly Connector[]
  connectPending: boolean
  onConnect: (connector: Connector) => void
}

export function DexWalletPicker({ connectors, connectPending, onConnect }: Props) {
  return (
    <div className="space-y-4">
      <ul className="grid gap-3 sm:grid-cols-2">
        {connectors.map((c) => {
          const { title, subtitle } = getWalletConnectorPresentation(c)
          return (
            <li key={c.uid}>
              <Button
                type="button"
                variant="outline"
                className="h-auto min-h-[4.5rem] w-full flex-col items-start gap-1 border-emerald-500/35 bg-black/20 py-3 text-left font-mono hover:border-emerald-400/50 hover:bg-emerald-500/5"
                disabled={connectPending}
                onClick={() => onConnect(c)}
              >
                <span className="text-sm font-semibold text-white">{title}</span>
                <span className="whitespace-normal text-[11px] font-normal leading-snug text-gray-500">{subtitle}</span>
              </Button>
            </li>
          )
        })}
      </ul>
      <p className="text-[11px] leading-relaxed text-gray-500 font-mono">
        <strong className="text-gray-400">Trust Wallet:</strong> use <strong className="text-emerald-400/90">WalletConnect</strong> on
        mobile (scan QR), or install the Trust browser extension and use <strong className="text-emerald-400/90">Browser wallet</strong>.
      </p>
      <p className="text-[11px] leading-relaxed text-amber-500/80 font-mono">
        Never paste your <strong className="text-amber-400">seed phrase</strong> or <strong className="text-amber-400">private key</strong>{' '}
        into this site. Connect only via MetaMask / Trust / WalletConnect — that is the safe pattern.
      </p>
    </div>
  )
}
