'use client'

/**
 * Uniswap-style connect modal — Personal wallet first, then detected browser wallets.
 */
import { useMemo } from 'react'
import type { Connector } from 'wagmi'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { useWallet } from '@solana/wallet-adapter-react'
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { isWalletConnectConfigured } from '@/lib/wagmi/config'
import { useActiveWallet } from '@/context/ActiveWalletContext'
import { toast } from 'sonner'

type Props = {
  open: boolean
  onOpenChange: (open: boolean) => void
  networkLabel: string
  personalAddr: string | null
  onPersonalWallet: () => void
  onSolanaDeposit: () => void
  /** When true, only browser wallets — personal / Binance are chosen earlier. */
  browserOnly?: boolean
}

const short = (a?: string | null) => (a ? `${a.slice(0, 6)}…${a.slice(-4)}` : '')

function connectorLabel(c: Connector): string {
  const id = c.id.toLowerCase()
  if (id.includes('metamask')) return 'MetaMask'
  if (id.includes('coinbase')) return 'Coinbase Wallet'
  if (id.includes('walletconnect')) return 'WalletConnect'
  if (id === 'injected') return 'Browser wallet'
  return c.name || c.id
}

export function ConnectWalletModal({
  open,
  onOpenChange,
  networkLabel,
  personalAddr,
  onPersonalWallet,
  onSolanaDeposit,
  browserOnly = false,
}: Props) {
  const { isConnected, address } = useAccount()
  const { connectors, connect, isPending } = useConnect()
  const { disconnect } = useDisconnect()
  const wcOn = isWalletConnectConfigured()
  const solana = useWallet()
  const active = useActiveWallet()
  const isSolanaContext = networkLabel === 'Solana'
  const solShort = solana.publicKey ? short(solana.publicKey.toBase58()) : ''

  const solanaWallets = useMemo(
    () => solana.wallets.filter((w) => w.readyState === 'Installed'),
    [solana.wallets],
  )

  const rows = useMemo(() => {
    const preferred = ['metaMask', 'coinbaseWallet', 'walletConnect', 'injected']
    const list = connectors.filter((c) => preferred.includes(c.id) || c.type === 'injected')
    const seen = new Set<string>()
    return list.filter((c) => {
      if (seen.has(c.id)) return false
      seen.add(c.id)
      return true
    })
  }, [connectors])

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="border-white/10 bg-[#111113] p-0 text-white sm:max-w-md overflow-hidden">
        <DialogHeader className="border-b border-white/10 px-5 py-4 text-center sm:text-center">
          <DialogTitle className="text-lg font-semibold tracking-tight">
            {browserOnly ? 'Browser wallet' : 'Connect a wallet'}
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-2 px-3 py-3">
          {!browserOnly ? (
            <>
          <button
            type="button"
            onClick={() => {
              if (isSolanaContext) active.solana.setPreference('platform')
              else active.evm.setPreference('platform')
              onOpenChange(false)
              onPersonalWallet()
            }}
            className="flex w-full items-center justify-between rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left transition hover:bg-white/[0.1]"
          >
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-sky-500/20 text-sm font-bold text-sky-200">
                K
              </span>
              <span className="text-sm font-semibold text-white">Personal Wallet</span>
            </span>
            <span className="flex items-center gap-1.5">
              {(isSolanaContext ? active.solana.source : active.evm.source) === 'platform' ? (
                <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                  Trading
                </span>
              ) : null}
              <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] font-medium text-zinc-300">
                {personalAddr ? short(personalAddr) : 'Set up'}
              </span>
            </span>
          </button>

          <button
            type="button"
            onClick={() => {
              onOpenChange(false)
              onSolanaDeposit()
            }}
            className="flex w-full items-center justify-between rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left transition hover:bg-white/[0.1]"
          >
            <span className="flex items-center gap-3">
              <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-violet-500/20 text-xs font-bold text-violet-200">
                SOL
              </span>
              <span className="text-sm font-semibold text-white">Solana deposit</span>
            </span>
            <span className="text-zinc-500">→</span>
          </button>

          <div className="flex items-center gap-3 px-1 py-2">
            <span className="h-px flex-1 bg-white/10" />
            <span className="text-[10px] uppercase tracking-wider text-zinc-600">or connect</span>
            <span className="h-px flex-1 bg-white/10" />
          </div>
            </>
          ) : null}

          {solanaWallets.map((w) => {
            const isCurrent = solana.connected && solana.wallet?.adapter.name === w.adapter.name
            const isTrading = isCurrent && active.solana.source === 'browser'
            return (
              <button
                key={w.adapter.name}
                type="button"
                disabled={solana.connecting}
                onClick={async () => {
                  try {
                    if (!isCurrent) {
                      solana.select(w.adapter.name)
                      await solana.connect()
                    }
                    active.solana.setPreference('browser')
                    toast.success(isCurrent ? `Trading from ${w.adapter.name}` : `${w.adapter.name} connected`)
                    onOpenChange(false)
                    window.dispatchEvent(new Event('dashboard:refresh'))
                  } catch (err) {
                    const msg = err instanceof Error ? err.message : 'Connect failed'
                    toast.error(msg.includes('rejected') ? 'Connection cancelled' : msg)
                  }
                }}
                className="flex w-full items-center justify-between rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left transition hover:bg-white/[0.1] disabled:opacity-50"
              >
                <span className="flex items-center gap-3">
                  {w.adapter.icon ? (
                    <img src={w.adapter.icon} alt="" className="h-9 w-9 rounded-xl" />
                  ) : null}
                  <span className="text-sm font-semibold text-white">{w.adapter.name}</span>
                </span>
                <span className="flex items-center gap-1.5">
                  {isTrading ? (
                    <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-medium text-emerald-200">
                      Trading
                    </span>
                  ) : null}
                  <span className="rounded-full bg-zinc-700/80 px-2 py-0.5 text-[10px] text-zinc-300">
                    {isCurrent ? (solShort || 'Connected') : 'Detected'}
                  </span>
                </span>
              </button>
            )
          })}

          {rows.map((c) => {
            const detected =
              typeof window !== 'undefined' &&
              (c.id === 'metaMask'
                ? Boolean((window as unknown as { ethereum?: { isMetaMask?: boolean } }).ethereum?.isMetaMask)
                : c.id === 'injected'
                  ? Boolean((window as unknown as { ethereum?: unknown }).ethereum)
                  : false)
            return (
              <button
                key={c.id}
                type="button"
                disabled={isPending}
                onClick={() => {
                  connect(
                    { connector: c },
                    {
                      onSuccess: () => {
                        localStorage.setItem('preferred_trading_wallet', 'dex')
                        active.evm.setPreference('browser')
                        toast.success(`${connectorLabel(c)} connected`)
                        onOpenChange(false)
                        window.dispatchEvent(new Event('dashboard:refresh'))
                      },
                      onError: (err) => toast.error(err.message || 'Connect failed'),
                    },
                  )
                }}
                className="flex w-full items-center justify-between rounded-2xl bg-white/[0.06] px-4 py-3.5 text-left transition hover:bg-white/[0.1] disabled:opacity-50"
              >
                <span className="text-sm font-semibold text-white">{connectorLabel(c)}</span>
                {detected ? (
                  <span className="rounded-full bg-zinc-700/80 px-2 py-0.5 text-[10px] text-zinc-300">
                    Detected
                  </span>
                ) : c.id === 'walletConnect' ? (
                  <span className="text-[10px] text-zinc-500">{wcOn ? 'QR' : 'Enable WC'}</span>
                ) : null}
              </button>
            )
          })}
        </div>

        {isConnected || solana.connected ? (
          <div className="space-y-2 border-t border-white/10 px-4 py-3">
            {solana.connected ? (
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-2xl border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                onClick={async () => {
                  try {
                    await solana.disconnect()
                  } catch {
                    /* adapter may already be gone */
                  }
                  active.solana.setPreference('platform')
                  toast.success(`${solana.wallet?.adapter.name ?? 'Solana wallet'} disconnected`)
                  window.dispatchEvent(new Event('dashboard:refresh'))
                }}
              >
                Disconnect {solana.wallet?.adapter.name ?? 'Solana wallet'}
                {solShort ? <span className="ml-2 font-mono text-[11px] opacity-70">{solShort}</span> : null}
              </Button>
            ) : null}
            {isConnected ? (
              <Button
                type="button"
                variant="outline"
                className="w-full rounded-2xl border-rose-500/30 bg-rose-500/10 text-rose-200 hover:bg-rose-500/20"
                onClick={() => {
                  disconnect()
                  localStorage.setItem('preferred_trading_wallet', 'personal')
                  active.evm.setPreference('platform')
                  toast.success('Browser wallet disconnected')
                  window.dispatchEvent(new Event('dashboard:refresh'))
                }}
              >
                Disconnect browser wallet
                <span className="ml-2 font-mono text-[11px] opacity-70">{short(address)}</span>
              </Button>
            ) : null}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  )
}
