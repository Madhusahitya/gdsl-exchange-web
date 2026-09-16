'use client'

/**
 * Executes a Jupiter swap from the user's own browser wallet.
 *
 * The server builds the route and relays the submission (it holds the Jupiter
 * API key); the wallet signs in between, so no private key ever leaves the
 * extension. Positions opened this way are not auto-managed — the bot has no
 * key to sell them with.
 */
import { useCallback, useState } from 'react'
import { useWallet } from '@solana/wallet-adapter-react'
import { VersionedTransaction } from '@solana/web3.js'
import { dexJupiter } from '@/lib/api'

export type BrowserSwapRequest = {
  side: 'BUY' | 'SELL'
  binanceSymbol: string
  amount: number
  slippageBps?: number
  spendMint?: string
}

export type BrowserSwapOutcome = Awaited<ReturnType<typeof dexJupiter.browserSubmitSwap>>

function toBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const b of bytes) binary += String.fromCharCode(b)
  return window.btoa(binary)
}

function fromBase64(value: string): Uint8Array {
  const binary = window.atob(value)
  const out = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i += 1) out[i] = binary.charCodeAt(i)
  return out
}

export function useBrowserJupiterSwap() {
  const { publicKey, signTransaction, connected } = useWallet()
  const [busy, setBusy] = useState(false)
  const [stage, setStage] = useState<'idle' | 'quoting' | 'signing' | 'submitting'>('idle')

  const swap = useCallback(
    async (request: BrowserSwapRequest): Promise<BrowserSwapOutcome> => {
      if (!connected || !publicKey) throw new Error('Connect your Solana wallet first')
      if (!signTransaction) {
        throw new Error('This wallet cannot sign transactions in the browser. Try Phantom or Solflare.')
      }

      setBusy(true)
      try {
        setStage('quoting')
        const build = await dexJupiter.browserBuildSwap({
          owner: publicKey.toBase58(),
          ...request,
        })

        setStage('signing')
        const unsigned = VersionedTransaction.deserialize(fromBase64(build.transaction))
        const signed = await signTransaction(unsigned)

        setStage('submitting')
        return await dexJupiter.browserSubmitSwap({
          requestId: build.requestId,
          signedTransaction: toBase64(signed.serialize()),
        })
      } finally {
        setBusy(false)
        setStage('idle')
      }
    },
    [connected, publicKey, signTransaction],
  )

  return { swap, busy, stage, canSign: connected && Boolean(signTransaction) }
}
