'use client'

/**
 * WalletActions — top-bar controls for connect, deposit, withdraw, transfer, and convert.
 */

import { useEffect, useMemo, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { usePathname } from 'next/navigation'
import {
  useAccount,
  useChainId,
  usePublicClient,
  useSendTransaction,
  useSwitchChain,
  useWriteContract,
} from 'wagmi'
import { bsc } from 'wagmi/chains'
import { erc20Abi, parseEther, parseUnits, type Address } from 'viem'
import { toast } from 'sonner'
import { tryNormalizeEvmAddress } from '@/lib/evmAddress'
import { connectSocket } from '@/lib/socket'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { ConnectWalletModal } from '@/components/web3/ConnectWalletModal'
import { useActiveWallet } from '@/context/ActiveWalletContext'
import { SolanaWalletPanel } from '@/components/dex/SolanaWalletPanel'
import { CrossChainTransferPanel } from '@/components/dex/CrossChainTransferPanel'
import { SolanaConvertPanel } from '@/components/dex/SolanaConvertPanel'
import { BscConvertPanel } from '@/components/dex/BscConvertPanel'
import {
  dexJupiter,
  personalWallet,
  type PersonalWalletSummary,
} from '@/lib/api'

const BSC_CHAIN_ID = 56

const DEPOSIT_TOKENS: Record<string, { address: Address | null; decimals: number }> = {
  USDT: { address: '0x55d398326f99059fF775485246999027B3197955', decimals: 18 },
  USDC: { address: '0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d', decimals: 18 },
  BNB: { address: null, decimals: 18 },
  BTCB: { address: '0x7130d2A12B9BCbFAe4f2634d864A1Ee1Ce3Ead9c', decimals: 18 },
  ETH: { address: '0x2170Ed0880ac9A755fd29B2688956BD959F933F8', decimals: 18 },
}

const SUPPORTED_WITHDRAW_ASSETS = ['USDT', 'USDC', 'BNB', 'BTCB', 'ETH', 'XRP', 'DOGE']

function shortAddr(addr: string | undefined | null): string {
  if (!addr) return ''
  return `${addr.slice(0, 6)}…${addr.slice(-4)}`
}

export function WalletActions() {
  const pathname = usePathname()
  const isSolanaContext = (pathname ?? '').includes('/dex-jupiter')
  const networkLabel = isSolanaContext ? 'Solana' : 'BSC'

  const { address, isConnected } = useAccount()
  const { solana: activeSol } = useActiveWallet()
  const solBrowserActive = isSolanaContext && activeSol.source === 'browser'
  const solBrowserAddress = solBrowserActive ? activeSol.browserAddress : null
  const chainId = useChainId()
  const { switchChain, isPending: switchPending } = useSwitchChain()
  const publicClient = usePublicClient()
  const { writeContractAsync, isPending: writePending } = useWriteContract()
  const { sendTransactionAsync, isPending: sendPending } = useSendTransaction()

  const [walletHubOpen, setWalletHubOpen] = useState(false)
  const [connectOpen, setConnectOpen] = useState(false)
  const [depositOpen, setDepositOpen] = useState(false)
  const [withdrawOpen, setWithdrawOpen] = useState(false)
  const [mounted, setMounted] = useState(false)
  useEffect(() => {
    setMounted(true)
  }, [])
  const showConnected = mounted && isConnected

  const [walletConfigured, setWalletConfigured] = useState(true)
  const [walletData, setWalletData] = useState<PersonalWalletSummary | null>(null)
  const [walletLoading, setWalletLoading] = useState(false)

  const [solAddress, setSolAddress] = useState<string | null>(null)
  const [solUsdc, setSolUsdc] = useState<number | null>(null)
  const [solHubOpen, setSolHubOpen] = useState(false)
  const [solHubTab, setSolHubTab] = useState<'deposit' | 'withdraw'>('deposit')
  const [transferOpen, setTransferOpen] = useState(false)
  const [convertOpen, setConvertOpen] = useState(false)

  const [depositAsset, setDepositAsset] = useState<keyof typeof DEPOSIT_TOKENS>('USDT')
  const [depositAmount, setDepositAmount] = useState('')
  const [depositBusy, setDepositBusy] = useState(false)
  const [showQr, setShowQr] = useState(false)

  const [withdrawAsset, setWithdrawAsset] = useState('USDT')
  const [withdrawAmount, setWithdrawAmount] = useState('')
  const [withdrawTo, setWithdrawTo] = useState('')
  const [withdrawBusy, setWithdrawBusy] = useState(false)

  useEffect(() => {
    if (!localStorage.getItem('preferred_trading_wallet')) {
      localStorage.setItem('preferred_trading_wallet', 'personal')
    }
  }, [])

  const refreshWallet = async () => {
    setWalletLoading(true)
    try {
      const status = await personalWallet.status()
      setWalletConfigured(status.configured)
      setWalletData(status.wallet)
    } catch {
      // best effort
    } finally {
      setWalletLoading(false)
    }
  }

  useEffect(() => {
    void refreshWallet()
  }, [])

  useEffect(() => {
    if (!isSolanaContext) return
    let cancelled = false
    const loadSol = async () => {
      try {
        if (!solAddress) {
          const status = await dexJupiter.walletStatus()
          if (cancelled) return
          if (status.wallet?.address) {
            setSolAddress(status.wallet.address)
          } else if (status.configured) {
            const created = await dexJupiter.ensureWallet()
            if (!cancelled) setSolAddress(created.address)
          }
        }
        // The pill must report the wallet that will actually pay for trades.
        if (solBrowserAddress) {
          const held = await dexJupiter.holdingsAt(solBrowserAddress)
          if (!cancelled && held) setSolUsdc(held.usdc)
        } else {
          const bal = await dexJupiter.walletBalances()
          if (!cancelled && bal) setSolUsdc(bal.usdc)
        }
      } catch {
        // best effort
      }
    }
    // Switching wallets must not leave the previous wallet's number on screen.
    setSolUsdc(null)
    void loadSol()
    const onRefresh = () => void loadSol()
    window.addEventListener('dashboard:refresh', onRefresh)
    const socket = connectSocket()
    socket.on('trade:executed', onRefresh)
    socket.on('portfolio:update', onRefresh)
    return () => {
      cancelled = true
      window.removeEventListener('dashboard:refresh', onRefresh)
      socket.off('trade:executed', onRefresh)
      socket.off('portfolio:update', onRefresh)
    }
  }, [isSolanaContext, solBrowserAddress])

  useEffect(() => {
    if (!walletHubOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setWalletHubOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
    }
  }, [walletHubOpen])

  const closeHub = () => setWalletHubOpen(false)

  const openFromHub = (action: () => void) => {
    closeHub()
    action()
  }

  useEffect(() => {
    if (address && !withdrawTo) {
      setWithdrawTo(address)
    }
  }, [address, withdrawTo])

  const ensureGdslWallet = async (): Promise<PersonalWalletSummary | null> => {
    if (walletData) return walletData
    if (!walletConfigured) {
      toast.error('Personal wallets are not enabled on this server. Ask the operator to set WALLET_ENCRYPTION_KEY.')
      return null
    }
    try {
      await personalWallet.create()
      const status = await personalWallet.status()
      setWalletConfigured(status.configured)
      setWalletData(status.wallet)
      return status.wallet
    } catch (e) {
      toast.error((e as Error).message ?? 'Could not create personal wallet')
      return null
    }
  }

  const handleDepositClick = async () => {
    setDepositOpen(true)
    await ensureGdslWallet()
  }

  const handleWithdrawClick = async () => {
    setWithdrawOpen(true)
    await ensureGdslWallet()
  }

  const handleCopyAddress = async () => {
    if (!walletData) return
    try {
      await navigator.clipboard.writeText(walletData.address)
      toast.success('koie.fin address copied')
    } catch {
      toast.error('Copy failed')
    }
  }

  const ensureBsc = async (): Promise<boolean> => {
    if (chainId === BSC_CHAIN_ID) return true
    try {
      await switchChain({ chainId: BSC_CHAIN_ID })
      return true
    } catch {
      toast.error('Please switch your wallet to BNB Smart Chain (BSC).')
      return false
    }
  }

  const handleSendFromMetaMask = async () => {
    if (!walletData) {
      toast.error('koie.fin wallet not ready')
      return
    }
    if (!isConnected || !address || !publicClient) {
      toast.error('Connect your external wallet first')
      return
    }
    const amount = parseFloat(depositAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    const onBsc = await ensureBsc()
    if (!onBsc) return

    setDepositBusy(true)
    try {
      const token = DEPOSIT_TOKENS[depositAsset]
      let txHash: `0x${string}`
      const dest = walletData.address as Address
      if (token.address == null) {
        const value = parseEther(depositAmount)
        txHash = await sendTransactionAsync({ to: dest, value, chainId: bsc.id })
      } else {
        const value = parseUnits(depositAmount, token.decimals)
        txHash = await writeContractAsync({
          chainId: bsc.id,
          address: token.address,
          abi: erc20Abi,
          functionName: 'transfer',
          args: [dest, value],
        })
      }
      toast.loading(`Sending ${amount} ${depositAsset} · tx ${shortAddr(txHash)}`, { id: 'gdsl-deposit' })
      await publicClient.waitForTransactionReceipt({ hash: txHash })
      toast.success(`Deposit confirmed · ${amount} ${depositAsset}`, {
        id: 'gdsl-deposit',
        duration: 6000,
      })
      setDepositAmount('')
      await refreshWallet()
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      const msg = (e as Error).message ?? 'Deposit failed'
      toast.error(msg.includes('User rejected') ? 'Deposit cancelled in wallet' : msg, { id: 'gdsl-deposit' })
    } finally {
      setDepositBusy(false)
    }
  }

  const handleWithdrawSubmit = async () => {
    if (!walletData) {
      toast.error('koie.fin wallet not ready')
      return
    }
    const amount = parseFloat(withdrawAmount)
    if (!Number.isFinite(amount) || amount <= 0) {
      toast.error('Enter a valid amount')
      return
    }
    const normalizedTo = tryNormalizeEvmAddress(withdrawTo)
    if (!normalizedTo) {
      toast.error('Enter a valid BSC / EVM address')
      return
    }
    setWithdrawBusy(true)
    try {
      const result = await personalWallet.withdraw({
        asset: withdrawAsset,
        amount,
        toAddress: normalizedTo,
      })
      toast.success(
        `Withdrawal submitted · tx ${shortAddr(result.txHash)} (status ${result.status})`,
        { duration: 6000 },
      )
      setWithdrawAmount('')
      setWithdrawOpen(false)
      await refreshWallet()
      window.dispatchEvent(new Event('dashboard:refresh'))
    } catch (e) {
      const msg = (e as { response?: { data?: { error?: string } } }).response?.data?.error
      toast.error(msg ?? (e as Error).message ?? 'Withdrawal failed')
    } finally {
      setWithdrawBusy(false)
    }
  }

  const personalAddr = isSolanaContext ? solAddress : walletData?.address ?? null
  /** What the top-right pill reports: the wallet trades will be paid from. */
  const pillAddr = solBrowserActive ? solBrowserAddress : personalAddr
  const pillLabel = isSolanaContext
    ? solBrowserActive
      ? (activeSol.browserLabel ?? 'Browser wallet')
      : 'Personal'
    : 'Wallet'

  const balanceFor = (asset: string) =>
    walletData?.balances.find((b) => b.asset === asset)?.amount ?? 0

  const qrSrc = useMemo(() => {
    if (!walletData) return ''
    return `https://api.qrserver.com/v1/create-qr-code/?size=200x200&margin=8&data=${encodeURIComponent(walletData.address)}`
  }, [walletData])

  type HubTileProps = {
    label: string
    onClick: () => void
    accent?: 'amber' | 'emerald' | 'sky' | 'blue' | 'violet'
    icon: ReactNode
    highlight?: boolean
  }

  const accentMap = {
    amber: 'border-amber-400/30 bg-amber-400/10 hover:bg-amber-400/20 text-amber-100',
    emerald: 'border-emerald-400/30 bg-emerald-400/10 hover:bg-emerald-400/20 text-emerald-100',
    sky: 'border-sky-400/30 bg-sky-400/10 hover:bg-sky-400/20 text-sky-100',
    blue: 'border-blue-400/30 bg-blue-400/10 hover:bg-blue-400/20 text-blue-100',
    violet: 'border-violet-400/30 bg-violet-400/10 hover:bg-violet-400/20 text-violet-100',
  } as const

  function HubTile({ label, onClick, accent = 'emerald', icon, highlight }: HubTileProps) {
    return (
      <button
        type="button"
        onClick={onClick}
        className={`flex min-h-[4rem] flex-col items-start justify-between rounded-2xl border p-3.5 text-left transition active:scale-[0.98] touch-manipulation ${
          highlight
            ? 'border-emerald-400/50 bg-emerald-400/20 text-white shadow-[0_0_24px_rgba(52,211,153,0.15)]'
            : accentMap[accent]
        }`}
      >
        <span className="rounded-xl bg-black/25 p-2">{icon}</span>
        <span className="block text-sm font-semibold leading-tight">{label}</span>
      </button>
    )
  }

  const walletHubPortal =
    mounted && walletHubOpen
      ? createPortal(
          <div className="fixed inset-0 z-[9999] isolate" role="presentation">
            <button
              type="button"
              aria-label="Close wallet panel"
              className="absolute inset-0 bg-white/[0.03] transition-opacity"
              style={{
                WebkitBackdropFilter: 'blur(28px) saturate(1.25)',
                backdropFilter: 'blur(28px) saturate(1.25)',
              }}
              onClick={closeHub}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Wallet actions"
              className="absolute right-3 top-[3.5rem] w-[min(calc(100vw-1.5rem),22rem)] animate-in fade-in slide-in-from-top-2 duration-200 sm:right-6 sm:top-[3.75rem] sm:w-[22rem]"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="overflow-hidden rounded-3xl border border-white/25 bg-white/10 shadow-[0_20px_60px_rgba(0,0,0,0.35)] backdrop-blur-3xl backdrop-saturate-150">
                <div className="flex items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
                  <p className="text-sm font-semibold text-white">Wallet</p>
                  <button
                    type="button"
                    onClick={closeHub}
                    aria-label="Close"
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-white/10 text-zinc-300 transition hover:bg-white/20 hover:text-white"
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>

                {isSolanaContext ? (
                  <div className="flex items-center justify-between gap-2 border-b border-white/10 px-4 py-2.5">
                    <span className="text-[11px] text-zinc-400">Trade from</span>
                    <div className="flex rounded-lg border border-white/10 bg-black/40 p-0.5">
                      <button
                        type="button"
                        onClick={() => activeSol.setPreference('platform')}
                        className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                          activeSol.source === 'platform'
                            ? 'bg-white/15 text-white'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        Personal
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (activeSol.browserConnected) activeSol.setPreference('browser')
                          else openFromHub(() => setConnectOpen(true))
                        }}
                        className={`rounded-md px-2.5 py-1 text-[11px] transition ${
                          activeSol.source === 'browser'
                            ? 'bg-violet-600 text-white'
                            : 'text-zinc-400 hover:text-zinc-200'
                        }`}
                      >
                        {activeSol.browserConnected ? (activeSol.browserLabel ?? 'Browser') : 'Browser wallet'}
                      </button>
                    </div>
                  </div>
                ) : null}

                <div className="grid grid-cols-2 gap-2.5 p-3.5">
                  <HubTile
                    label="Connect"
                    accent={showConnected ? 'emerald' : 'amber'}
                    onClick={() => openFromHub(() => setConnectOpen(true))}
                    icon={
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 12h8M12 8v8" />
                      </svg>
                    }
                  />
                  <HubTile
                    label="Deposit"
                    highlight
                    onClick={() =>
                      openFromHub(() => {
                        if (isSolanaContext) {
                          setSolHubTab('deposit')
                          setSolHubOpen(true)
                        } else {
                          void handleDepositClick()
                        }
                      })
                    }
                    icon={
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
                      </svg>
                    }
                  />
                  <HubTile
                    label="Withdraw"
                    accent="emerald"
                    onClick={() =>
                      openFromHub(() => {
                        if (isSolanaContext) {
                          setSolHubTab('withdraw')
                          setSolHubOpen(true)
                        } else {
                          void handleWithdrawClick()
                        }
                      })
                    }
                    icon={
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.75}
                          d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z"
                        />
                      </svg>
                    }
                  />
                  <HubTile
                    label="Transfer"
                    accent="sky"
                    onClick={() => openFromHub(() => setTransferOpen(true))}
                    icon={
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 7h12m0 0l-4-4m4 4l-4 4m4 6H4m0 0l4 4m-4-4l4-4" />
                      </svg>
                    }
                  />
                  <HubTile
                    label="Convert"
                    accent="emerald"
                    onClick={() => openFromHub(() => setConvertOpen(true))}
                    icon={
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
                      </svg>
                    }
                  />
                  <HubTile
                    label="Personal"
                    accent="blue"
                    onClick={() =>
                      openFromHub(() => {
                        if (isSolanaContext) {
                          setSolHubTab('deposit')
                          setSolHubOpen(true)
                        } else {
                          void handleDepositClick()
                        }
                      })
                    }
                    icon={
                      <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path
                          strokeLinecap="round"
                          strokeLinejoin="round"
                          strokeWidth={1.75}
                          d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                        />
                      </svg>
                    }
                  />
                </div>
              </div>
            </div>
          </div>,
          document.body,
        )
      : null

  return (
    <>
      <button
        type="button"
        onClick={() => setWalletHubOpen(true)}
        aria-expanded={walletHubOpen}
        aria-haspopup="dialog"
        className="inline-flex h-9 max-w-[16rem] items-center gap-2 rounded-xl border border-white/15 bg-white/[0.06] px-3 text-xs font-medium text-white backdrop-blur-sm transition hover:bg-white/10 active:scale-[0.98] touch-manipulation sm:max-w-[20rem]"
      >
        <svg className="h-4 w-4 shrink-0 text-emerald-300" viewBox="0 0 24 24" fill="none" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.75}
            d="M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
          />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.75} d="M8 12h8M12 8v8" />
        </svg>
        <span className="truncate">
          <span className="font-semibold">{pillLabel}</span>
          {isSolanaContext && solUsdc != null ? (
            <span className="font-mono text-emerald-300"> · ${solUsdc.toFixed(2)} USDC</span>
          ) : null}
          {pillAddr ? (
            <span className="text-zinc-400"> · {shortAddr(pillAddr)}</span>
          ) : (
            <span className="text-zinc-500"> · {networkLabel}</span>
          )}
        </span>
        {showConnected || (mounted && solBrowserActive) ? (
          <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />
        ) : null}
      </button>

      {walletHubPortal}

      <SolanaWalletPanel
        address={solAddress}
        hideTrigger
        open={solHubOpen}
        onOpenChange={setSolHubOpen}
        initialTab={solHubTab}
      />

      <CrossChainTransferPanel
        hideTrigger
        open={transferOpen}
        onOpenChange={setTransferOpen}
        defaultDirection={isSolanaContext ? 'SOL_TO_BSC' : 'BSC_TO_SOL'}
      />

      {isSolanaContext ? (
        <SolanaConvertPanel hideTrigger open={convertOpen} onOpenChange={setConvertOpen} />
      ) : (
        <BscConvertPanel hideTrigger open={convertOpen} onOpenChange={setConvertOpen} />
      )}

      <ConnectWalletModal
        open={connectOpen}
        onOpenChange={setConnectOpen}
        networkLabel={networkLabel}
        personalAddr={personalAddr}
        onPersonalWallet={async () => {
          if (isSolanaContext) {
            await dexJupiter.ensureWallet().catch(() => null)
            setSolHubTab('deposit')
            setSolHubOpen(true)
          } else {
            await ensureGdslWallet()
            setDepositOpen(true)
          }
        }}
        onSolanaDeposit={async () => {
          await dexJupiter.ensureWallet().catch(() => null)
          setSolHubTab('deposit')
          setSolHubOpen(true)
        }}
      />

      <Dialog open={depositOpen} onOpenChange={setDepositOpen}>
        <DialogContent className="border-white/10 bg-[#0c0c10] text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Deposit</DialogTitle>
          </DialogHeader>

          {walletLoading && !walletData ? (
            <p className="text-sm text-zinc-400">Loading wallet…</p>
          ) : !walletConfigured ? (
            <p className="text-sm text-amber-300">
              Personal wallets are disabled on this server. Set <code>WALLET_ENCRYPTION_KEY</code> in the API env.
            </p>
          ) : !walletData ? (
            <div className="space-y-3">
              <Button onClick={() => void ensureGdslWallet()} disabled={walletLoading} className="bg-emerald-400 text-black hover:bg-emerald-300">
                {walletLoading ? 'Creating…' : 'Create wallet'}
              </Button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <Label className="text-xs uppercase tracking-wide text-zinc-500">Deposit address</Label>
                <div className="mt-1 flex items-center gap-2">
                  <code className="flex-1 break-all rounded-md border border-white/10 bg-black/40 px-3 py-2 text-xs text-emerald-200">
                    {walletData.address}
                  </code>
                  <Button variant="outline" size="sm" onClick={handleCopyAddress}>
                    Copy
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => setShowQr((v) => !v)}>
                    {showQr ? 'Hide QR' : 'QR'}
                  </Button>
                </div>
                {showQr ? (
                  <div className="mt-3 flex justify-center">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={qrSrc} alt="Deposit QR" width={200} height={200} className="rounded-md bg-white p-1" />
                  </div>
                ) : null}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="dep-asset" className="text-xs uppercase tracking-wide text-zinc-500">Asset</Label>
                  <select
                    id="dep-asset"
                    value={depositAsset}
                    onChange={(e) => setDepositAsset(e.target.value as keyof typeof DEPOSIT_TOKENS)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                  >
                    {Object.keys(DEPOSIT_TOKENS).map((sym) => (
                      <option key={sym} value={sym}>
                        {sym}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="dep-amount" className="text-xs uppercase tracking-wide text-zinc-500">Amount</Label>
                  <Input
                    id="dep-amount"
                    inputMode="decimal"
                    value={depositAmount}
                    onChange={(e) => setDepositAmount(e.target.value)}
                    placeholder="100"
                    className="mt-1 border-white/10 bg-black/40"
                  />
                </div>
              </div>

              <DialogFooter className="gap-2 sm:gap-2">
                <Button type="button" variant="ghost" onClick={() => setDepositOpen(false)}>
                  Close
                </Button>
                <Button
                  type="button"
                  className="bg-emerald-400 text-black hover:bg-emerald-300"
                  disabled={
                    !isConnected || depositBusy || writePending || sendPending || switchPending || !depositAmount
                  }
                  onClick={handleSendFromMetaMask}
                >
                  {depositBusy || writePending || sendPending
                    ? 'Sending…'
                    : isConnected
                      ? `Send ${depositAmount || '0'} ${depositAsset}`
                      : 'Connect wallet to send'}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <Dialog open={withdrawOpen} onOpenChange={setWithdrawOpen}>
        <DialogContent className="border-white/10 bg-[#0c0c10] text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Withdraw</DialogTitle>
          </DialogHeader>

          {!walletConfigured ? (
            <p className="text-sm text-amber-300">
              Personal wallets are disabled on this server. Set <code>WALLET_ENCRYPTION_KEY</code> in the API env.
            </p>
          ) : !walletData ? (
            <p className="text-sm text-zinc-400">Set up your wallet from Deposit first.</p>
          ) : (
            <div className="space-y-3">
              <div className="rounded-lg border border-white/10 bg-white/[0.02] p-3 text-xs text-zinc-400">
                Available: {walletData.balances.length === 0 ? 'no balances yet' : null}
                {walletData.balances
                  .filter((b) => b.amount > 0)
                  .map((b) => (
                    <span key={b.asset} className="mr-3 text-zinc-300">
                      {b.amount.toLocaleString(undefined, { maximumFractionDigits: 8 })} {b.asset}
                    </span>
                  ))}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label htmlFor="wd-asset" className="text-xs uppercase tracking-wide text-zinc-500">Asset</Label>
                  <select
                    id="wd-asset"
                    value={withdrawAsset}
                    onChange={(e) => setWithdrawAsset(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-white/10 bg-black/40 px-3 py-2 text-sm text-white"
                  >
                    {SUPPORTED_WITHDRAW_ASSETS.map((sym) => (
                      <option key={sym} value={sym}>
                        {sym} ({balanceFor(sym).toLocaleString(undefined, { maximumFractionDigits: 4 })})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <Label htmlFor="wd-amount" className="text-xs uppercase tracking-wide text-zinc-500">Amount</Label>
                  <Input
                    id="wd-amount"
                    inputMode="decimal"
                    value={withdrawAmount}
                    onChange={(e) => setWithdrawAmount(e.target.value)}
                    placeholder="0.00"
                    className="mt-1 border-white/10 bg-black/40"
                  />
                </div>
              </div>

              <div>
                <Label htmlFor="wd-dest" className="text-xs uppercase tracking-wide text-zinc-500">
                  Destination address
                  {address ? (
                    <button
                      type="button"
                      onClick={() => setWithdrawTo(address)}
                      className="ml-2 text-emerald-300 hover:text-emerald-200 underline"
                    >
                      Use connected wallet
                    </button>
                  ) : null}
                </Label>
                <Input
                  id="wd-dest"
                  value={withdrawTo}
                  onChange={(e) => setWithdrawTo(e.target.value.trim())}
                  placeholder="0x…"
                  className="mt-1 border-white/10 bg-black/40 font-mono text-xs"
                />
              </div>

              <DialogFooter className="gap-2 sm:gap-2">
                <Button type="button" variant="ghost" onClick={() => setWithdrawOpen(false)}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  className="bg-emerald-400 text-black hover:bg-emerald-300"
                  disabled={withdrawBusy || !walletData.enabled}
                  onClick={handleWithdrawSubmit}
                >
                  {withdrawBusy ? 'Submitting…' : `Withdraw ${withdrawAmount || '0'} ${withdrawAsset}`}
                </Button>
              </DialogFooter>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
