'use client'

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { formatUnits, maxUint256, parseUnits } from 'viem'
import { useAccount, useChainId, useConnect, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { bsc } from 'wagmi/chains'
import { toast } from 'sonner'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { LiveCandle } from '@/components/market/LiveCandle'
import { BSC_TOKENS, candidateSwapPaths } from '@/lib/dex/bscTokens'
import { dexBuyRealizedPnlUsd, dexSellRealizedPnlUsd } from '@/lib/dex/swapPnl'
import { erc20Abi, PANCAKE_V2_ROUTER, routerAbi, USDT_BSC } from '@/lib/dex/bsc'
import { inbox, personalWallet, tokenTrading, trades, type MarketBoardRow } from '@/lib/api'

const BOARD_POLL_MS = 18_000
const FOCUS_DEBOUNCE_MS = 380

/**
 * `transfer` and `approve` are both `(address, uint256)`, so viem cannot tell
 * them apart from the full erc20Abi plus args alone. Narrowing to one function
 * removes the ambiguity.
 */
const erc20TransferAbi = [
  {
    type: 'function',
    name: 'transfer',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

function fmtPrice(p: number): string {
  if (!Number.isFinite(p)) return '—'
  if (p >= 1000) return p.toLocaleString(undefined, { maximumFractionDigits: 2 })
  if (p >= 1) return p.toFixed(4)
  return p.toPrecision(6)
}

function fmtPct(p: number): string {
  if (!Number.isFinite(p)) return '—'
  return `${p >= 0 ? '+' : ''}${p.toFixed(2)}%`
}

function fmtQv(v: number): string {
  if (!Number.isFinite(v)) return '—'
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`
  return v.toFixed(0)
}

function pairLabel(binanceSymbol: string): string {
  const base = binanceSymbol.replace(/USDT$/i, '')
  return `${base}/USDT`
}

function parseSlippageBps(slippagePctText: string): number {
  const n = Number.parseFloat(slippagePctText)
  if (!Number.isFinite(n)) return 100
  return Math.max(10, Math.min(2000, Math.round(n * 100)))
}

function shortHash(hash: string): string {
  if (!hash || hash.length < 14) return hash
  return `${hash.slice(0, 8)}…${hash.slice(-6)}`
}

export default function TokenTradingPage() {
  const { address, isConnected, connector } = useAccount()
  const chainId = useChainId()
  const { connectors, connect, isPending: connectPending } = useConnect()
  const { switchChain } = useSwitchChain()
  const publicClient = usePublicClient()
  const bscPublicClient = usePublicClient({ chainId: bsc.id })
  const { writeContractAsync } = useWriteContract()
  const [rows, setRows] = useState<MarketBoardRow[]>([])
  const [boardUpdatedAt, setBoardUpdatedAt] = useState<string | null>(null)
  const [boardLoading, setBoardLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [selected, setSelected] = useState<string | null>(null)
  const [syncing, setSyncing] = useState(false)
  const [tradeBusy, setTradeBusy] = useState(false)
  const [transferBusy, setTransferBusy] = useState(false)
  const [tradeAmount, setTradeAmount] = useState('25')
  const [slippagePct, setSlippagePct] = useState('1')
  const [transferTo, setTransferTo] = useState('')
  const [transferAmount, setTransferAmount] = useState('0')
  const [walletMode, setWalletMode] = useState<'personal' | 'external'>('personal')
  const [preview, setPreview] = useState<{ title: string; createdAt: string }[]>([])
  const focusSeq = useRef(0)
  const [clientMounted, setClientMounted] = useState(false)

  useEffect(() => {
    setClientMounted(true)
  }, [])

  useEffect(() => {
    const raw = localStorage.getItem('preferred_trading_wallet')
    setWalletMode(raw === 'dex' ? 'external' : 'personal')
  }, [])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => r.symbol.toLowerCase().includes(q))
  }, [rows, search])

  const selectedToken = useMemo(() => {
    if (!selected) return null
    return BSC_TOKENS.find((t) => t.binanceSymbol.toUpperCase() === selected.toUpperCase()) ?? null
  }, [selected])

  const loadBoard = useCallback(async () => {
    setBoardLoading(true)
    try {
      const res = await tokenTrading.marketBoard(500)
      setRows(res.rows)
      setBoardUpdatedAt(res.updatedAt)
    } catch (e: unknown) {
      const ax = e as {
        response?: { status?: number; data?: { error?: string } }
        code?: string
      }
      const serverMsg = ax.response?.data?.error
      const suffix =
        ax.response?.status === 502
          ? ' The API could not load Binance data (network, firewall, or regional block).'
          : ax.code === 'ECONNABORTED'
            ? ' Request timed out — check that the API is running.'
            : ''
      toast.error(serverMsg ? `${serverMsg}${suffix}` : `Could not refresh market list.${suffix}`)
    } finally {
      setBoardLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadBoard()
    const id = window.setInterval(() => void loadBoard(), BOARD_POLL_MS)
    return () => window.clearInterval(id)
  }, [loadBoard])

  useEffect(() => {
    if (filtered.length === 0) {
      setSelected(null)
      return
    }
    if (!selected || !filtered.some((r) => r.symbol === selected)) {
      setSelected(filtered[0]!.symbol)
    }
  }, [filtered, selected])

  useEffect(() => {
    if (!selected) return
    const seq = ++focusSeq.current
    const t = window.setTimeout(() => {
      void (async () => {
        try {
          const row = rows.find((r) => r.symbol === selected)
          const refPx = row?.lastPrice ?? 0

          let walletPayload:
            | { mode: 'personal' }
            | {
                mode: 'external'
                label?: string
                addressTail?: string
                usdtBalance: number
                baseUsdApprox: number
              }

          if (walletMode === 'personal') {
            walletPayload = { mode: 'personal' }
          } else {
            let usdtN = 0
            let baseUsd = 0
            try {
              const rpcClient = bscPublicClient ?? publicClient
              if (rpcClient && address && selectedToken?.address && isConnected) {
                const [usdtRaw, tokRaw] = await Promise.all([
                  rpcClient.readContract({
                    address: USDT_BSC,
                    abi: erc20Abi,
                    functionName: 'balanceOf',
                    args: [address],
                  }),
                  rpcClient.readContract({
                    address: selectedToken.address as `0x${string}`,
                    abi: erc20Abi,
                    functionName: 'balanceOf',
                    args: [address],
                  }),
                ])
                usdtN = Number(formatUnits(usdtRaw as bigint, 18))
                const tokN = Number(formatUnits(tokRaw as bigint, selectedToken.decimals))
                baseUsd = refPx > 0 ? tokN * refPx : 0
              }
            } catch {
              /* balance read failed — server still returns signal */
            }
            walletPayload = {
              mode: 'external',
              label: connector?.name ?? 'Browser wallet',
              addressTail: address ? address.slice(-4) : undefined,
              usdtBalance: usdtN,
              baseUsdApprox: baseUsd,
            }
          }

          const r = await tokenTrading.focusToken(selected, { wallet: walletPayload })
          if (seq !== focusSeq.current) return
          const plainToast =
            typeof r.popupBody === 'string' && r.popupBody.includes('\n---\n')
              ? (r.popupBody.split('\n---\n')[0]?.trim() ?? r.popupBody)
              : r.popupBody
          toast.info(r.popupTitle, { description: plainToast, duration: 14_000 })
          window.dispatchEvent(new CustomEvent('cf:inbox-updated'))
          const list = await inbox.list({ limit: 4 })
          setPreview(list.items.map((i) => ({ title: i.title, createdAt: i.createdAt })))
        } catch (e: unknown) {
          const ax = e as { response?: { status?: number; data?: { error?: string } } }
          if (ax.response?.status === 429) {
            toast.message('Please wait a moment before switching tokens again.')
          } else {
            toast.error(ax.response?.data?.error ?? 'Could not load token insight')
          }
        }
      })()
    }, FOCUS_DEBOUNCE_MS)
    return () => window.clearTimeout(t)
  }, [
    selected,
    walletMode,
    rows,
    address,
    chainId,
    connector,
    publicClient,
    bscPublicClient,
    selectedToken,
    isConnected,
  ])

  const loadPreview = useCallback(async () => {
    try {
      const { items } = await inbox.list({ limit: 4 })
      setPreview(items.map((i) => ({ title: i.title, createdAt: i.createdAt })))
    } catch {
      setPreview([])
    }
  }, [])

  useEffect(() => {
    void loadPreview()
  }, [loadPreview])

  const syncToInbox = async () => {
    setSyncing(true)
    try {
      const res = await tokenTrading.syncAlerts()
      if (res.requiresPersonalWallet) {
        toast.error('Create your Personal Wallet on the Wallet page to enable portfolio-wide sync.')
        return
      }
      toast.success(`Inbox +${res.created} · skipped ${res.skipped}`)
      window.dispatchEvent(new CustomEvent('cf:inbox-updated'))
      await loadPreview()
    } catch (e: unknown) {
      const ax = e as { response?: { status?: number; data?: { retryAfterSec?: number; error?: string } } }
      if (ax.response?.status === 429) {
        toast.error(`Wait ${ax.response.data?.retryAfterSec ?? 60}s before syncing again.`)
      } else {
        toast.error(ax.response?.data?.error ?? 'Sync failed')
      }
    } finally {
      setSyncing(false)
    }
  }

  const onHold = () => {
    if (!selected) return
    toast.success(`HOLD · ${pairLabel(selected)}`, {
      description: 'No trade signal from you recorded. Use Inbox for model notes.',
      duration: 5000,
    })
  }

  const syncWalletPreference = useCallback((mode: 'personal' | 'external') => {
    setWalletMode(mode)
    if (typeof window !== 'undefined') {
      localStorage.setItem('preferred_trading_wallet', mode === 'external' ? 'dex' : 'personal')
      window.dispatchEvent(new Event('dashboard:refresh'))
    }
  }, [])

  const ensureBsc = useCallback(async (): Promise<boolean> => {
    if (chainId === bsc.id) return true
    try {
      await switchChain({ chainId: bsc.id })
      return true
    } catch {
      toast.error('Switch wallet network to BNB Smart Chain (BSC).')
      return false
    }
  }, [chainId, switchChain])

  const executeExternalSwap = useCallback(
    async (side: 'BUY' | 'SELL') => {
      if (!selected || !selectedToken) {
        toast.error('Selected market is not supported for BSC execution.')
        return
      }
      if (!isConnected || !address || !publicClient) {
        toast.error('Connect your external wallet first.')
        return
      }
      const ok = await ensureBsc()
      if (!ok) return

      const amountNum = Number.parseFloat(tradeAmount)
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        toast.error('Enter a valid amount.')
        return
      }

      const inTokenAddress = side === 'BUY' ? USDT_BSC : selectedToken.address
      const inDecimals = side === 'BUY' ? 18 : selectedToken.decimals
      const amountIn = parseUnits(amountNum.toString(), inDecimals)
      // Quote every viable Pancake V2 route at execution time and pick the
      // one returning the most output. Replaces the previous hard-coded
      // 2-hop USDT↔WBNB↔TOKEN path which paid an extra 0.25% LP fee +
      // the WBNB pool's spread on blue chips that have a direct USDT pool
      // (BTCB, ETH, USDC, etc.). See `candidateSwapPaths` for the routing
      // table and the rationale.
      const swapCandidates = candidateSwapPaths(selectedToken, side)
      const slippageBps = BigInt(parseSlippageBps(slippagePct))

      setTradeBusy(true)
      try {
        const readErc20Bal = async (tokenAddr: `0x${string}`, decimals: number) => {
          const raw = await publicClient.readContract({
            address: tokenAddr,
            abi: erc20Abi,
            functionName: 'balanceOf',
            args: [address],
          })
          return Number(formatUnits(raw as bigint, decimals))
        }

        const usdtBalBefore = await readErc20Bal(USDT_BSC, 18)
        const tokBalBefore = await readErc20Bal(selectedToken.address as `0x${string}`, selectedToken.decimals)

        const allowance = await publicClient.readContract({
          address: inTokenAddress,
          abi: erc20Abi,
          functionName: 'allowance',
          args: [address, PANCAKE_V2_ROUTER],
        })
        if (allowance < amountIn) {
          const approveHash = await writeContractAsync({
            chainId: bsc.id,
            address: inTokenAddress,
            abi: erc20Abi,
            functionName: 'approve',
            args: [PANCAKE_V2_ROUTER, maxUint256],
          })
          await publicClient.waitForTransactionReceipt({ hash: approveHash })
        }

        // Quote every candidate path and keep the best one; the WBNB
        // route works as a fallback for tokens whose direct USDT pool
        // doesn't exist or has thin liquidity. A path that reverts on
        // getAmountsOut (no pool) is silently dropped from consideration.
        let bestPath: `0x${string}`[] | null = null
        let expectedOut = 0n
        for (const candidate of swapCandidates) {
          try {
            const out = await publicClient.readContract({
              address: PANCAKE_V2_ROUTER,
              abi: routerAbi,
              functionName: 'getAmountsOut',
              args: [amountIn, [...candidate]],
            })
            const last = out[out.length - 1] as bigint
            if (last > expectedOut) {
              expectedOut = last
              bestPath = [...candidate]
            }
          } catch {
            /* candidate pool missing — skip */
          }
        }
        if (!bestPath || expectedOut <= 0n) {
          throw new Error('No Pancake V2 route available for this token right now.')
        }
        const amountOutMin = (expectedOut * (10_000n - slippageBps)) / 10_000n
        const deadline = BigInt(Math.floor(Date.now() / 1000) + 20 * 60)

        const txHash = await writeContractAsync({
          chainId: bsc.id,
          address: PANCAKE_V2_ROUTER,
          abi: routerAbi,
          functionName: 'swapExactTokensForTokens',
          args: [amountIn, amountOutMin, [...bestPath], address, deadline],
        })
        await publicClient.waitForTransactionReceipt({ hash: txHash })

        const usdtBalAfter = await readErc20Bal(USDT_BSC, 18)
        const tokBalAfter = await readErc20Bal(selectedToken.address as `0x${string}`, selectedToken.decimals)

        const quotedOutNum = Number(formatUnits(expectedOut, side === 'BUY' ? selectedToken.decimals : 18))
        const amountInNum = Number(formatUnits(amountIn, inDecimals))

        let allocationUsd = 0
        let entryPriceEff = 0
        let pnlUsd = 0

        if (side === 'BUY') {
          const spentUsdt = usdtBalBefore - usdtBalAfter
          const recvTok = tokBalAfter - tokBalBefore
          allocationUsd = Math.max(0, spentUsdt)
          entryPriceEff =
            recvTok > 1e-18 ? spentUsdt / recvTok : amountInNum / Math.max(quotedOutNum, Number.EPSILON)
          pnlUsd = dexBuyRealizedPnlUsd({
            spentUsdt,
            recvTok,
            amountInUsdt: amountInNum,
            quotedOutTok: quotedOutNum,
          })
        } else {
          const recvUsdt = usdtBalAfter - usdtBalBefore
          const soldTok = tokBalBefore - tokBalAfter
          allocationUsd = Math.max(0, recvUsdt)
          entryPriceEff =
            soldTok > 1e-18 ? recvUsdt / soldTok : quotedOutNum / Math.max(amountInNum, Number.EPSILON)
          pnlUsd = dexSellRealizedPnlUsd({
            recvUsdt,
            soldTok,
            amountInTok: amountInNum,
            quotedUsdtOut: quotedOutNum,
          })
        }

        const safePnl = Number.isFinite(pnlUsd) ? Math.round(pnlUsd * 1e9) / 1e9 : 0

        await trades.logExecution({
          pair: `${selectedToken.symbol}/USDT`,
          side,
          entryPrice: Number.isFinite(entryPriceEff) && entryPriceEff > 0 ? entryPriceEff : 0.00000001,
          ...(allocationUsd > 1e-9 ? { allocationUsd: Math.round(allocationUsd * 1e8) / 1e8 } : {}),
          pnl: safePnl,
        })
        window.dispatchEvent(new Event('dashboard:refresh'))
        window.dispatchEvent(new Event('portfolio:update'))
        toast.success(`${side} executed · ${selectedToken.symbol} · tx ${shortHash(txHash)}`)
      } catch (e) {
        toast.error((e as Error).message ?? `${side} swap failed`)
      } finally {
        setTradeBusy(false)
      }
    },
    [address, ensureBsc, isConnected, publicClient, selected, selectedToken, slippagePct, tradeAmount, writeContractAsync],
  )

  const executePersonalSwapNow = useCallback(
    async (side: 'BUY' | 'SELL') => {
      if (!selectedToken) {
        toast.error('Selected market is not supported for BSC personal-wallet execution.')
        return
      }
      const amountNum = Number.parseFloat(tradeAmount)
      if (!Number.isFinite(amountNum) || amountNum <= 0) {
        toast.error('Enter a valid amount.')
        return
      }
      setTradeBusy(true)
      try {
        const slippageBps = parseSlippageBps(slippagePct)
        const result = await personalWallet.swap({
          side,
          tokenSymbol: selectedToken.symbol,
          amount: amountNum,
          slippageBps,
        })
        window.dispatchEvent(new Event('dashboard:refresh'))
        window.dispatchEvent(new Event('portfolio:update'))
        toast.success(`${side} executed · ${selectedToken.symbol} · tx ${shortHash(result.txHash)}`)
      } catch (e) {
        const ax = e as { response?: { data?: { error?: string } } }
        toast.error(ax.response?.data?.error ?? (e as Error).message ?? 'Swap failed')
      } finally {
        setTradeBusy(false)
      }
    },
    [selectedToken, slippagePct, tradeAmount],
  )

  const executeTrade = useCallback(
    async (side: 'BUY' | 'SELL') => {
      if (walletMode === 'personal') {
        await executePersonalSwapNow(side)
      } else {
        await executeExternalSwap(side)
      }
    },
    [executeExternalSwap, executePersonalSwapNow, walletMode],
  )

  const executeTransfer = useCallback(async () => {
    if (!selectedToken) {
      toast.error('Select a supported token first.')
      return
    }
    const amountNum = Number.parseFloat(transferAmount)
    if (!Number.isFinite(amountNum) || amountNum <= 0) {
      toast.error('Enter valid transfer amount.')
      return
    }
    if (!transferTo || !/^0x[a-fA-F0-9]{40}$/.test(transferTo)) {
      toast.error('Enter valid destination wallet address.')
      return
    }

    setTransferBusy(true)
    try {
      if (walletMode === 'personal') {
        const res = await personalWallet.withdraw({
          asset: selectedToken.symbol,
          amount: amountNum,
          toAddress: transferTo,
        })
        toast.success(`Transfer submitted · tx ${shortHash(res.txHash)}`)
      } else {
        if (!isConnected || !address || !publicClient) {
          toast.error('Connect your external wallet first.')
          return
        }
        const ok = await ensureBsc()
        if (!ok) return
        const value = parseUnits(amountNum.toString(), selectedToken.decimals)
        const hash = await writeContractAsync({
          chainId: bsc.id,
          address: selectedToken.address,
          abi: erc20TransferAbi,
          functionName: 'transfer',
          args: [transferTo as `0x${string}`, value],
        })
        await publicClient.waitForTransactionReceipt({ hash })
        toast.success(`Transfer confirmed · tx ${shortHash(hash)}`)
      }
      window.dispatchEvent(new Event('dashboard:refresh'))
      window.dispatchEvent(new Event('portfolio:update'))
      setTransferAmount('')
      setTransferTo('')
    } catch (e) {
      const ax = e as { response?: { data?: { error?: string } } }
      toast.error(ax.response?.data?.error ?? (e as Error).message ?? 'Transfer failed')
    } finally {
      setTransferBusy(false)
    }
  }, [address, ensureBsc, isConnected, publicClient, selectedToken, transferAmount, transferTo, walletMode, writeContractAsync])

  return (
    <div className="space-y-5 max-w-6xl">
      <Card className="overflow-hidden border-violet-500/25 bg-gradient-to-br from-violet-950/30 via-[#0b0d13] to-[#0f1220] shadow-[0_0_36px_rgba(139,92,246,0.12)]">
        <CardContent className="pt-6 pb-6">
          <h1 className="text-2xl font-semibold text-white">Token trading</h1>
          <p className="mt-1 text-sm text-zinc-300/80">
            Binance USDT spot board (live refresh) · pick a row for candles, inbox note, and DEX actions.
          </p>
        </CardContent>
      </Card>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap gap-2 items-center">
          <Button type="button" variant="outline" size="sm" className="border-white/15" onClick={() => void loadBoard()} disabled={boardLoading}>
            Refresh list
          </Button>
          <Button type="button" size="sm" className="bg-violet-600 hover:bg-violet-500" disabled={syncing} onClick={() => void syncToInbox()}>
            {syncing ? 'Syncing…' : 'Portfolio sync'}
          </Button>
          <Button asChild variant="ghost" size="sm" className="text-emerald-400">
            <Link href="/inbox">Inbox</Link>
          </Button>
          <Button
            type="button"
            size="sm"
            variant={walletMode === 'personal' ? 'default' : 'outline'}
            className={walletMode === 'personal' ? 'bg-blue-600 hover:bg-blue-500' : 'border-blue-500/40 text-blue-300'}
            onClick={() => syncWalletPreference('personal')}
          >
            Personal Wallet
          </Button>
          <Button
            type="button"
            size="sm"
            variant={walletMode === 'external' ? 'default' : 'outline'}
            className={walletMode === 'external' ? 'bg-emerald-600 hover:bg-emerald-500' : 'border-emerald-500/40 text-emerald-300'}
            onClick={() => syncWalletPreference('external')}
          >
            External Wallet
          </Button>
          {clientMounted && walletMode === 'external' && !isConnected ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="border-amber-500/40 text-amber-300"
              disabled={connectPending || connectors.length === 0}
              onClick={() => {
                const preferred = connectors.find((c) => ['metaMask', 'injected', 'coinbaseWallet', 'walletConnect'].includes(c.id))
                if (!preferred) {
                  toast.error('No wallet connector found.')
                  return
                }
                connect({ connector: preferred })
              }}
            >
              Connect wallet
            </Button>
          ) : null}
        </div>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,340px)_1fr]">
        <Card className="border-white/10 bg-[#0b0d13]/90 shadow-[0_8px_28px_rgba(0,0,0,0.28)] lg:max-h-[calc(100dvh-10rem)] lg:flex lg:flex-col">
          <CardHeader className="shrink-0 space-y-2 pb-2">
            <CardTitle className="text-sm font-medium text-white">USDT pairs · by 24h volume</CardTitle>
            <Input
              placeholder="Search symbol…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="border-white/10 bg-black/40 text-sm"
            />
            <p className="text-[10px] font-mono text-zinc-500">
              {boardLoading ? 'Updating…' : `${filtered.length} shown`}
              {boardUpdatedAt ? ` · ${new Date(boardUpdatedAt).toLocaleTimeString()}` : ''}
            </p>
          </CardHeader>
          <CardContent className="min-h-0 flex-1 overflow-hidden p-0 lg:flex lg:flex-col">
            <div className="max-h-[50vh] overflow-y-auto border-t border-white/5 lg:max-h-none lg:flex-1">
              {filtered.map((r) => {
                const active = r.symbol === selected
                return (
                  <button
                    key={r.symbol}
                    type="button"
                    onClick={() => setSelected(r.symbol)}
                    className={`flex w-full flex-col gap-0.5 border-b border-white/5 px-3 py-2.5 text-left text-xs font-mono transition-colors hover:bg-white/5 ${
                      active ? 'bg-emerald-500/10 ring-1 ring-inset ring-emerald-500/35' : ''
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-white">{r.symbol.replace(/USDT$/, '')}</span>
                      <span className="text-zinc-300">{fmtPrice(r.lastPrice)}</span>
                    </div>
                    <div className="flex items-center justify-between text-[10px] text-zinc-500">
                      <span className={r.priceChangePercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}>{fmtPct(r.priceChangePercent)}</span>
                      <span>Vol {fmtQv(r.quoteVolume)}</span>
                    </div>
                  </button>
                )
              })}
            </div>
          </CardContent>
        </Card>

        <div className="space-y-4">
          {selected ? (
            <>
              <Card className="border-white/10 bg-[#0b0d13]/90 shadow-[0_8px_28px_rgba(0,0,0,0.28)]">
                <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 pb-2">
                  <CardTitle className="text-base text-white">{pairLabel(selected)}</CardTitle>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      type="button"
                      size="sm"
                      className="bg-emerald-600 hover:bg-emerald-500"
                      disabled={tradeBusy || !selectedToken}
                      onClick={() => void executeTrade('BUY')}
                    >
                      {tradeBusy ? 'Working…' : 'Buy'}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="secondary"
                      className="bg-rose-600/90 text-white hover:bg-rose-600"
                      disabled={tradeBusy || !selectedToken}
                      onClick={() => void executeTrade('SELL')}
                    >
                      {tradeBusy ? 'Working…' : 'Sell'}
                    </Button>
                    <Button type="button" size="sm" variant="outline" className="border-white/20" onClick={onHold}>
                      Hold
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="border-white/15"
                      disabled={transferBusy || !selectedToken}
                      onClick={() => void executeTransfer()}
                    >
                      {transferBusy ? 'Transferring…' : 'Transfer'}
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                    <Input
                      value={tradeAmount}
                      onChange={(e) => setTradeAmount(e.target.value)}
                      inputMode="decimal"
                      placeholder={selectedToken ? `Amount (${walletMode === 'personal' ? 'USDT buy / token sell' : 'USDT buy / token sell'})` : 'Amount'}
                      className="border-white/10 bg-black/40"
                    />
                    <Input
                      value={slippagePct}
                      onChange={(e) => setSlippagePct(e.target.value)}
                      inputMode="decimal"
                      placeholder="Slippage % (e.g. 1)"
                      className="border-white/10 bg-black/40"
                    />
                    <Input
                      value={transferAmount}
                      onChange={(e) => setTransferAmount(e.target.value)}
                      inputMode="decimal"
                      placeholder="Transfer amount"
                      className="border-white/10 bg-black/40"
                    />
                    <Input
                      value={transferTo}
                      onChange={(e) => setTransferTo(e.target.value.trim())}
                      placeholder="Transfer to 0x..."
                      className="border-white/10 bg-black/40 font-mono text-xs"
                    />
                  </div>
                  <p className="mb-3 text-[11px] text-zinc-500">
                    Mode: <span className="text-zinc-300">{walletMode === 'personal' ? 'Personal Wallet' : 'External Wallet'}</span>
                    {selectedToken ? ` · Token: ${selectedToken.symbol}` : ' · Select a BSC-supported pair to execute'}
                  </p>
                  {!selectedToken ? (
                    <p className="mb-3 text-xs text-amber-300">
                      This market is not mapped to a supported BSC token yet. Pick BTC/ETH/BNB/SOL/XRP/DOGE and other listed BSC pairs.
                    </p>
                  ) : null}
                  <LiveCandle symbol={selected} pairLabel={pairLabel(selected)} defaultInterval="1m" pollMs={5_000} />
                </CardContent>
              </Card>

              <Card className="border-white/10 bg-[#0b0d13]/90 shadow-[0_8px_28px_rgba(0,0,0,0.28)]">
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm text-white">Latest inbox</CardTitle>
                </CardHeader>
                <CardContent>
                  {preview.length === 0 ? (
                    <p className="text-xs text-zinc-500">Select a token to generate an inbox entry.</p>
                  ) : (
                    <ul className="space-y-1.5 text-xs text-zinc-400">
                      {preview.map((p) => (
                        <li key={p.createdAt + p.title} className="font-mono">
                          <span className="text-zinc-600">{new Date(p.createdAt).toLocaleString()}</span> · {p.title}
                        </li>
                      ))}
                    </ul>
                  )}
                </CardContent>
              </Card>
            </>
          ) : (
            <Card className="border-white/10 bg-[#0b0d13]/90 shadow-[0_8px_28px_rgba(0,0,0,0.28)]">
              <CardContent className="py-10 text-center text-sm text-zinc-500">Select a token from the list.</CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
