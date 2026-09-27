'use client'

import { useEffect, useState } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { portfolio, withdraw } from '@/lib/api'

const NETWORKS = [
  { value: 'ERC-20', label: 'ERC-20 (Ethereum)' },
  { value: 'BRC-20', label: 'BRC-20 (Bitcoin)' },
  { value: 'Solana', label: 'Solana' },
]

const NETWORK_FEE = 2.50

export default function WithdrawPage() {
  const [balance, setBalance] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [submitting, setSubmitting] = useState(false)
  const [showConfirmDialog, setShowConfirmDialog] = useState(false)
  const [showSuccessToast, setShowSuccessToast] = useState(false)

  // Form state
  const [amount, setAmount] = useState('')
  const [walletAddress, setWalletAddress] = useState('')
  const [network, setNetwork] = useState('ERC-20')
  const [error, setError] = useState('')

  useEffect(() => {
    const fetchBalance = async () => {
      try {
        const data = await portfolio.get()
        setBalance(data.totalValue)
      } catch (error) {
        console.error('Failed to fetch balance:', error)
      } finally {
        setLoading(false)
      }
    }
    fetchBalance()
  }, [])

  const amountNum = parseFloat(amount) || 0
  const finalAmount = amountNum > NETWORK_FEE ? amountNum - NETWORK_FEE : 0
  const isFormValid = amountNum > 0 && amountNum <= (balance ?? 0) && walletAddress.length >= 20

  const handleMaxClick = () => {
    if (balance !== null) {
      setAmount(balance.toString())
    }
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    setError('')

    if (amountNum <= 0) {
      setError('Amount must be greater than 0')
      return
    }

    if (balance !== null && amountNum > balance) {
      setError('Insufficient balance')
      return
    }

    if (walletAddress.length < 20) {
      setError('Please enter a valid wallet address')
      return
    }

    setShowConfirmDialog(true)
  }

  const handleConfirmWithdraw = async () => {
    setSubmitting(true)
    try {
      const result = await withdraw.create(amountNum, walletAddress, network)
      setBalance(result.remainingBalance)
      setShowConfirmDialog(false)
      setShowSuccessToast(true)
      // Reset form
      setAmount('')
      setWalletAddress('')
      setNetwork('ERC-20')
      // Hide toast after 5 seconds
      setTimeout(() => setShowSuccessToast(false), 5000)
    } catch (err: unknown) {
      const error = err as { response?: { data?: { error?: string } } }
      setError(error.response?.data?.error || 'Withdrawal failed. Please try again.')
      setShowConfirmDialog(false)
    } finally {
      setSubmitting(false)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value)
  }

  const truncateAddress = (address: string) => {
    if (address.length <= 16) return address
    return `${address.slice(0, 8)}...${address.slice(-8)}`
  }

  return (
    <div className="space-y-8 max-w-2xl">
      {/* Header */}
      <div>
        <h1 className="text-3xl font-bold text-white">Withdraw Funds</h1>
        <p className="text-gray-400 mt-1">Transfer your funds to an external wallet</p>
      </div>

      {/* Success Toast */}
      {showSuccessToast && (
        <div className="fixed top-4 right-4 z-50 animate-in slide-in-from-top-2">
          <div className="bg-green-500/20 border border-green-500/30 rounded-lg p-4 flex items-center gap-3">
            <div className="w-8 h-8 rounded-full bg-green-500/20 flex items-center justify-center">
              <svg className="w-5 h-5 text-green-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <p className="font-medium text-green-500">Withdrawal Successful</p>
              <p className="text-sm text-green-400/80">Your funds are being processed</p>
            </div>
            <button
              onClick={() => setShowSuccessToast(false)}
              className="ml-4 text-green-400 hover:text-green-300"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Available Balance Card */}
      <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
        <CardHeader className="pb-2">
          <CardTitle className="text-sm font-medium text-gray-400">Available Balance</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <Skeleton className="h-10 w-40 bg-[#2a2a2a]" />
          ) : (
            <>
              <div className="text-4xl font-bold text-white">
                {formatCurrency(balance ?? 0)}
              </div>
              <p className="text-sm text-gray-400 mt-1">Available for withdrawal</p>
            </>
          )}
        </CardContent>
      </Card>

      {/* Withdraw Form Card */}
      <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
        <CardHeader>
          <CardTitle className="text-white flex items-center gap-2">
            <svg className="w-5 h-5 text-amber-500" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2m2 4h10a2 2 0 002-2v-6a2 2 0 00-2-2H9a2 2 0 00-2 2v6a2 2 0 002 2zm7-5a2 2 0 11-4 0 2 2 0 014 0z" />
            </svg>
            Withdrawal Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-6">
            {error && (
              <div className="p-3 rounded-lg bg-red-500/10 border border-red-500/20 text-red-400 text-sm">
                {error}
              </div>
            )}

            {/* Amount Input */}
            <div className="space-y-2">
              <Label htmlFor="amount" className="text-gray-300">Amount</Label>
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">$</span>
                <Input
                  id="amount"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="0.00"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="bg-[#141414] border-[#2a2a2a] text-white pl-8 pr-16"
                />
                <button
                  type="button"
                  onClick={handleMaxClick}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-amber-500 text-sm font-medium hover:text-amber-400"
                >
                  Max
                </button>
              </div>
            </div>

            {/* Wallet Address Input */}
            <div className="space-y-2">
              <Label htmlFor="wallet" className="text-gray-300">Wallet Address</Label>
              <Input
                id="wallet"
                type="text"
                placeholder="Enter your wallet address"
                value={walletAddress}
                onChange={(e) => setWalletAddress(e.target.value)}
                className="bg-[#141414] border-[#2a2a2a] text-white font-mono text-sm"
              />
            </div>

            {/* Network Selector */}
            <div className="space-y-2">
              <Label htmlFor="network" className="text-gray-300">Network</Label>
              <select
                id="network"
                value={network}
                onChange={(e) => setNetwork(e.target.value)}
                className="w-full bg-[#141414] border border-[#2a2a2a] rounded-md px-3 py-2 text-white h-10"
              >
                {NETWORKS.map((net) => (
                  <option key={net.value} value={net.value}>{net.label}</option>
                ))}
              </select>
            </div>

            {/* Fee Info */}
            <div className="space-y-3 pt-4 border-t border-[#2a2a2a]">
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">Network Fee</span>
                <span className="text-white">{formatCurrency(NETWORK_FEE)}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-400">You will receive</span>
                <span className="text-xl font-bold text-amber-500">
                  {formatCurrency(finalAmount)}
                </span>
              </div>
            </div>

            {/* Submit Button */}
            <Button
              type="submit"
              disabled={!isFormValid || loading}
              className="w-full bg-amber-500 hover:bg-amber-600 text-black font-semibold py-6 text-lg disabled:opacity-50"
            >
              Withdraw
            </Button>
          </form>
        </CardContent>
      </Card>

      {/* Confirmation Dialog */}
      <Dialog open={showConfirmDialog} onOpenChange={setShowConfirmDialog}>
        <DialogContent className="bg-[#1a1a1a] border-[#2a2a2a] text-white">
          <DialogHeader>
            <DialogTitle className="text-xl">Confirm Withdrawal</DialogTitle>
            <DialogDescription className="text-gray-400">
              Please review your withdrawal details before confirming.
            </DialogDescription>
          </DialogHeader>
          
          <div className="space-y-4 py-4">
            <div className="flex justify-between py-2 border-b border-[#2a2a2a]">
              <span className="text-gray-400">Amount</span>
              <span className="text-white font-medium">{formatCurrency(amountNum)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-[#2a2a2a]">
              <span className="text-gray-400">Wallet Address</span>
              <span className="text-white font-mono text-sm">{truncateAddress(walletAddress)}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-[#2a2a2a]">
              <span className="text-gray-400">Network</span>
              <span className="text-white">{network}</span>
            </div>
            <div className="flex justify-between py-2 border-b border-[#2a2a2a]">
              <span className="text-gray-400">Network Fee</span>
              <span className="text-white">{formatCurrency(NETWORK_FEE)}</span>
            </div>
            <div className="flex justify-between py-2">
              <span className="text-gray-400">You will receive</span>
              <span className="text-xl font-bold text-amber-500">{formatCurrency(finalAmount)}</span>
            </div>
          </div>

          <DialogFooter className="gap-3">
            <Button
              variant="outline"
              onClick={() => setShowConfirmDialog(false)}
              className="bg-transparent border-[#2a2a2a] text-white hover:bg-[#2a2a2a]"
            >
              Cancel
            </Button>
            <Button
              onClick={handleConfirmWithdraw}
              disabled={submitting}
              className="bg-amber-500 hover:bg-amber-600 text-black font-semibold"
            >
              {submitting ? (
                <span className="flex items-center gap-2">
                  <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                  </svg>
                  Processing...
                </span>
              ) : (
                'Confirm Withdrawal'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
