'use client'

/**
 * Browser wallet hub — connect MetaMask / Coinbase / WalletConnect on BSC and
 * Phantom / Solflare / Backpack on Solana, keeping the keys in the user's own
 * wallet.
 *
 * Two things a connected wallet can do here:
 *  1. Fund the platform trading wallet in one click (the bot needs a key it can
 *     sign with, so auto-trading always runs against the personal wallet).
 *  2. Receive withdrawals — the address is prefilled on the withdraw forms.
 *
 * Manual self-custody trading lives on /dex-jupiter, which signs with the connected wallet.
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useAccount, useChainId, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import { bsc } from 'wagmi/chains'
import { useConnection, useWallet } from '@solana/wallet-adapter-react'
import { LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from '@solana/web3.js'
import {
  createAssociatedTokenAccountInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddress,
} from '@solana/spl-token'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { USDC_MINT_MAINNET } from '@/lib/solana/config'
import { dexJupiter } from '@/lib/api'

const USDC_DECIMALS = 6

function evmLabel(id: string, name: string): string {
  const key = id.toLowerCase()
  if (key.includes('metamask')) return 'MetaMask'
  if (key.includes('coinbase')) return 'Coinbase Wallet'
  if (key.includes('walletconnect')) return 'WalletConnect'
  if (key === 'injected') return 'Browser wallet'
  return name || id
}

function evmHint(id: string): string {
  const key = id.toLowerCase()
  if (key.includes('metamask')) return 'Browser extension'
  if (key.includes('coinbase')) return 'Extension or app'
  if (key.includes('walletconnect')) return 'Trust, Rainbow, OKX + 50 more via QR'
  if (key === 'injected') return 'Rabby · Brave · other EIP-1193'
  return 'EVM'
}

export function BrowserWalletsPanel() {
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  return (
    <div className="space-y-4">
      {mounted ? (
        <>
          <EvmWalletCard />
          <SolanaWalletCard />
        </>
      ) : (
        <p className="py-8 text-sm text-zinc-500">Loading wallets…</p>
      )}
    </div>
  )
}

function EvmWalletCard() {
  const { address, isConnected, connector } = useAccount()
  const { connectors, connect, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const chainId = useChainId()
  const { switchChain, isPending: switching } = useSwitchChain()

  const rows = useMemo(() => {
    const seen = new Set<string>()
    return connectors.filter((c) => {
      if (seen.has(c.id)) return false
      seen.add(c.id)
      return true
    })
  }, [connectors])

  return (
    <Card className="border-white/10 bg-[#0a0a0f]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm text-white">
          <span>EVM wallet — BNB Smart Chain</span>
          {isConnected ? (
            <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-medium text-emerald-300">
              Connected
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {isConnected ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                {connector?.name ?? 'Wallet'}
              </p>
              <code className="mt-1 block break-all font-mono text-xs text-emerald-200">{address}</code>
            </div>
            {chainId !== bsc.id ? (
              <div className="flex items-center justify-between rounded-lg border border-amber-500/25 bg-amber-500/[0.07] px-3 py-2">
                <p className="text-xs text-amber-200">
                  Wrong network — switch to BNB Smart Chain to deposit or trade.
                </p>
                <Button
                  size="sm"
                  disabled={switching}
                  onClick={() => switchChain({ chainId: bsc.id })}
                >
                  {switching ? 'Switching…' : 'Switch'}
                </Button>
              </div>
            ) : null}
            <Button
              variant="outline"
              size="sm"
              className="border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
              onClick={() => {
                disconnect()
                localStorage.setItem('preferred_trading_wallet', 'personal')
                window.dispatchEvent(new Event('dashboard:refresh'))
                toast.success('EVM wallet disconnected')
              }}
            >
              Disconnect
            </Button>
          </div>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {rows.map((c) => (
              <button
                key={c.id}
                type="button"
                disabled={isPending}
                onClick={() =>
                  connect(
                    { connector: c },
                    {
                      onSuccess: () => {
                        localStorage.setItem('preferred_trading_wallet', 'dex')
                        window.dispatchEvent(new Event('dashboard:refresh'))
                        toast.success(`${evmLabel(c.id, c.name)} connected`)
                      },
                      onError: (err) => toast.error(err.message || 'Connect failed'),
                    },
                  )
                }
                className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left transition hover:bg-white/[0.08] disabled:opacity-50"
              >
                <span className="block text-sm font-medium text-white">{evmLabel(c.id, c.name)}</span>
              </button>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  )
}

function SolanaWalletCard() {
  const { connection } = useConnection()
  const { publicKey, wallets, select, connect, connected, connecting, disconnect, wallet, sendTransaction } =
    useWallet()

  const [balances, setBalances] = useState<{ sol: number; usdc: number } | null>(null)
  const [platformAddress, setPlatformAddress] = useState<string | null>(null)
  const [fundAsset, setFundAsset] = useState<'USDC' | 'SOL'>('USDC')
  const [fundAmount, setFundAmount] = useState('')
  const [funding, setFunding] = useState(false)

  const installed = useMemo(
    () => wallets.filter((w) => w.readyState === 'Installed' || w.readyState === 'Loadable'),
    [wallets],
  )

  const refreshBalances = useCallback(async () => {
    if (!publicKey) {
      setBalances(null)
      return
    }
    try {
      const lamports = await connection.getBalance(publicKey)
      let usdc = 0
      try {
        const ata = await getAssociatedTokenAddress(new PublicKey(USDC_MINT_MAINNET), publicKey)
        const bal = await connection.getTokenAccountBalance(ata)
        usdc = bal.value.uiAmount ?? 0
      } catch {
        // No USDC account yet — that is a zero balance, not an error.
      }
      setBalances({ sol: lamports / LAMPORTS_PER_SOL, usdc })
    } catch {
      setBalances(null)
    }
  }, [connection, publicKey])

  useEffect(() => {
    void refreshBalances()
  }, [refreshBalances])

  useEffect(() => {
    void dexJupiter
      .walletStatus()
      .then((s) => setPlatformAddress(s.wallet?.address ?? null))
      .catch(() => setPlatformAddress(null))
  }, [])

  const fundPlatformWallet = useCallback(async () => {
    const amount = Number(fundAmount)
    if (!publicKey || !platformAddress) return
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter an amount')
      return
    }
    setFunding(true)
    try {
      const destination = new PublicKey(platformAddress)
      const tx = new Transaction()

      if (fundAsset === 'SOL') {
        tx.add(
          SystemProgram.transfer({
            fromPubkey: publicKey,
            toPubkey: destination,
            lamports: Math.round(amount * LAMPORTS_PER_SOL),
          }),
        )
      } else {
        const mint = new PublicKey(USDC_MINT_MAINNET)
        const source = await getAssociatedTokenAddress(mint, publicKey)
        const dest = await getAssociatedTokenAddress(mint, destination)
        // A wallet that has never held USDC has no token account; the sender
        // pays the rent to create it, otherwise the transfer fails.
        const destInfo = await connection.getAccountInfo(dest)
        if (!destInfo) {
          tx.add(createAssociatedTokenAccountInstruction(publicKey, dest, destination, mint))
        }
        tx.add(
          createTransferCheckedInstruction(
            source,
            mint,
            dest,
            publicKey,
            BigInt(Math.round(amount * 10 ** USDC_DECIMALS)),
            USDC_DECIMALS,
          ),
        )
      }

      const signature = await sendTransaction(tx, connection)
      const latest = await connection.getLatestBlockhash()
      await connection.confirmTransaction({ signature, ...latest }, 'confirmed')

      toast.success(`Sent ${amount} ${fundAsset} to your trading wallet`)
      setFundAmount('')
      await refreshBalances()
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Transfer failed'
      toast.error(msg.includes('User rejected') ? 'Transfer cancelled' : msg)
    } finally {
      setFunding(false)
    }
  }, [connection, fundAmount, fundAsset, platformAddress, publicKey, refreshBalances, sendTransaction])

  return (
    <Card className="border-white/10 bg-[#0a0a0f]">
      <CardHeader className="pb-3">
        <CardTitle className="flex items-center justify-between text-sm text-white">
          <span>Solana wallet — Phantom, Solflare, Backpack</span>
          {connected ? (
            <span className="rounded-full bg-violet-500/15 px-2 py-0.5 text-[10px] font-medium text-violet-300">
              Connected
            </span>
          ) : null}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {connected && publicKey ? (
          <div className="space-y-3">
            <div className="rounded-lg border border-white/10 bg-black/40 px-3 py-2.5">
              <p className="text-[10px] uppercase tracking-wide text-zinc-500">
                {wallet?.adapter.name ?? 'Solana wallet'}
              </p>
              <code className="mt-1 block break-all font-mono text-xs text-violet-200">
                {publicKey.toBase58()}
              </code>
              {balances ? (
                <p className="mt-2 text-xs text-zinc-400">
                  {balances.usdc.toFixed(2)} USDC · {balances.sol.toFixed(4)} SOL
                </p>
              ) : null}
            </div>

            {platformAddress ? (
              <div className="space-y-2 rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3">
                <p className="text-xs font-medium text-white">Fund trading wallet</p>
                <div className="flex flex-wrap gap-2">
                  <div className="flex rounded-md border border-white/10 bg-black/40 p-0.5">
                    {(['USDC', 'SOL'] as const).map((a) => (
                      <button
                        key={a}
                        type="button"
                        onClick={() => setFundAsset(a)}
                        className={`rounded px-2.5 py-1 text-xs transition ${fundAsset === a ? 'bg-violet-600 text-white' : 'text-zinc-400 hover:text-white'
                          }`}
                      >
                        {a}
                      </button>
                    ))}
                  </div>
                  <Input
                    value={fundAmount}
                    onChange={(e) => setFundAmount(e.target.value)}
                    placeholder={`Amount in ${fundAsset}`}
                    inputMode="decimal"
                    className="h-8 w-36 text-xs"
                  />
                  <Button size="sm" disabled={funding} onClick={() => void fundPlatformWallet()}>
                    {funding ? 'Sending…' : 'Send'}
                  </Button>
                </div>
              </div>
            ) : (
              <p className="text-xs text-zinc-500">Create a Solana trading wallet first.</p>
            )}

            <Button
              variant="outline"
              size="sm"
              className="border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
              onClick={() => {
                void disconnect()
                toast.success('Solana wallet disconnected')
              }}
            >
              Disconnect
            </Button>
          </div>
        ) : installed.length > 0 ? (
          <div className="grid gap-2 sm:grid-cols-2">
            {installed.map((w) => (
              <button
                key={w.adapter.name}
                type="button"
                disabled={connecting}
                onClick={async () => {
                  try {
                    select(w.adapter.name)
                    await connect()
                    toast.success(`${w.adapter.name} connected`)
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : 'Connect failed'
                    toast.error(msg.includes('rejected') ? 'Connection cancelled' : msg)
                  }
                }}
                className="flex items-center gap-2.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2.5 text-left transition hover:bg-white/[0.08] disabled:opacity-50"
              >
                {/* Wallet-supplied data-URI icon — next/image cannot optimize it. */}
                {w.adapter.icon ? (
                  <img src={w.adapter.icon} alt="" className="h-6 w-6 rounded" />
                ) : null}
                <span className="block text-sm font-medium text-white">{w.adapter.name}</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-3">
            <p className="text-xs text-zinc-400">No Solana wallet detected.</p>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
