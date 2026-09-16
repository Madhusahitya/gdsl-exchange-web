'use client'

import { useEffect, useState, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Input } from '@/components/ui/input'
import { Skeleton } from '@/components/ui/skeleton'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { trades } from '@/lib/api'

interface Trade {
  id: string
  pair: string
  strategy: string
  entryPrice: number
  exitPrice: number | null
  pnl: number | null
  status: string
  createdAt: string
}

interface TradesResponse {
  trades: Trade[]
  total: number
  page: number
  totalPages: number
}

const PAIRS = ['All', 'BTC/USDT', 'ETH/USDT', 'SOL/USDT']
const STATUSES = ['All', 'Open', 'Closed']

export default function HistoryPage() {
  const [tradesList, setTradesList] = useState<Trade[]>([])
  const [loading, setLoading] = useState(true)
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [total, setTotal] = useState(0)

  // Filters
  const [dateFrom, setDateFrom] = useState('')
  const [dateTo, setDateTo] = useState('')
  const [statusFilter, setStatusFilter] = useState('All')
  const [pairFilter, setPairFilter] = useState('All')

  const fetchTrades = useCallback(async (pageNum: number) => {
    setLoading(true)
    try {
      const params: { page: number; status?: string; pair?: string } = { page: pageNum }
      if (statusFilter !== 'All') {
        params.status = statusFilter.toLowerCase()
      }
      if (pairFilter !== 'All') {
        params.pair = pairFilter
      }
      const response: TradesResponse = await trades.list(params)
      
      // Client-side date filtering (API doesn't support date range)
      let filteredTrades = response.trades
      if (dateFrom) {
        const fromDate = new Date(dateFrom)
        filteredTrades = filteredTrades.filter(t => new Date(t.createdAt) >= fromDate)
      }
      if (dateTo) {
        const toDate = new Date(dateTo)
        toDate.setHours(23, 59, 59, 999)
        filteredTrades = filteredTrades.filter(t => new Date(t.createdAt) <= toDate)
      }
      
      setTradesList(filteredTrades)
      setTotalPages(response.totalPages)
      setTotal(response.total)
      setPage(pageNum)
    } catch (error) {
      console.error('Failed to fetch trades:', error)
    } finally {
      setLoading(false)
    }
  }, [statusFilter, pairFilter, dateFrom, dateTo])

  useEffect(() => {
    fetchTrades(1)
  }, [])

  const handleApplyFilters = () => {
    fetchTrades(1)
  }

  const handleReset = () => {
    setDateFrom('')
    setDateTo('')
    setStatusFilter('All')
    setPairFilter('All')
    setPage(1)
    // Fetch with reset filters
    setTimeout(() => fetchTrades(1), 0)
  }

  const handlePrevPage = () => {
    if (page > 1) {
      fetchTrades(page - 1)
    }
  }

  const handleNextPage = () => {
    if (page < totalPages) {
      fetchTrades(page + 1)
    }
  }

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
      minimumFractionDigits: 2,
    }).format(value)
  }

  const formatDate = (dateStr: string) => {
    return new Date(dateStr).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  }

  const calculateDuration = (trade: Trade) => {
    if (trade.status === 'OPEN') return '—'
    // For demo, show a placeholder duration
    return '< 1m'
  }

  const exportToCSV = () => {
    const headers = ['Date', 'Pair', 'Strategy', 'Entry Price', 'Exit Price', 'P&L', 'Status']
    const rows = tradesList.map(trade => [
      new Date(trade.createdAt).toISOString(),
      trade.pair,
      trade.strategy,
      trade.entryPrice.toString(),
      trade.exitPrice?.toString() ?? '',
      trade.pnl?.toString() ?? '',
      trade.status,
    ])

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(',')),
    ].join('\n')

    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' })
    const link = document.createElement('a')
    link.href = URL.createObjectURL(blob)
    link.download = 'trades-export.csv'
    link.click()
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-white">Trade History</h1>
          <p className="text-gray-400 mt-1">View and export your trading activity</p>
        </div>
        <Button
          onClick={exportToCSV}
          disabled={tradesList.length === 0}
          variant="outline"
          className="bg-[#1a1a1a] border-[#2a2a2a] text-white hover:bg-[#2a2a2a] hover:text-white"
        >
          <svg className="w-4 h-4 mr-2" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
          </svg>
          Export CSV
        </Button>
      </div>

      {/* Filter Bar */}
      <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
        <CardContent className="pt-6">
          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2">
              <label className="text-sm text-gray-400">From</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
                className="bg-[#141414] border-[#2a2a2a] text-white w-40"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">To</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
                className="bg-[#141414] border-[#2a2a2a] text-white w-40"
              />
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Status</label>
              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="bg-[#141414] border border-[#2a2a2a] rounded-md px-3 py-2 text-white h-10 w-32"
              >
                {STATUSES.map((status) => (
                  <option key={status} value={status}>{status}</option>
                ))}
              </select>
            </div>
            <div className="space-y-2">
              <label className="text-sm text-gray-400">Pair</label>
              <select
                value={pairFilter}
                onChange={(e) => setPairFilter(e.target.value)}
                className="bg-[#141414] border border-[#2a2a2a] rounded-md px-3 py-2 text-white h-10 w-36"
              >
                {PAIRS.map((pair) => (
                  <option key={pair} value={pair}>{pair}</option>
                ))}
              </select>
            </div>
            <Button
              onClick={handleApplyFilters}
              className="bg-amber-500 hover:bg-amber-600 text-black font-medium"
            >
              Apply Filters
            </Button>
            <button
              onClick={handleReset}
              className="text-sm text-gray-400 hover:text-white transition-colors underline"
            >
              Reset
            </button>
          </div>
        </CardContent>
      </Card>

      {/* Trades Table */}
      <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
        <CardContent className="pt-6">
          {loading ? (
            <div className="space-y-4">
              {[...Array(5)].map((_, i) => (
                <Skeleton key={i} className="h-14 w-full bg-[#2a2a2a]" />
              ))}
            </div>
          ) : tradesList.length === 0 ? (
            <div className="text-center py-16">
              <svg className="w-16 h-16 mx-auto text-gray-600 mb-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
              </svg>
              <h3 className="text-lg font-medium text-white mb-2">No trades found</h3>
              <p className="text-gray-400 text-sm">
                Start your trading bot to see your trade history here.
              </p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow className="border-[#2a2a2a] hover:bg-transparent">
                  <TableHead className="text-gray-400">Date</TableHead>
                  <TableHead className="text-gray-400">Pair</TableHead>
                  <TableHead className="text-gray-400">Strategy</TableHead>
                  <TableHead className="text-gray-400 text-right">Entry Price</TableHead>
                  <TableHead className="text-gray-400 text-right">Exit Price</TableHead>
                  <TableHead className="text-gray-400 text-right">P&L</TableHead>
                  <TableHead className="text-gray-400 text-center">Status</TableHead>
                  <TableHead className="text-gray-400 text-right">Duration</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {tradesList.map((trade) => (
                  <TableRow key={trade.id} className="border-[#2a2a2a] hover:bg-[#242424]">
                    <TableCell className="text-gray-300 text-sm">
                      {formatDate(trade.createdAt)}
                    </TableCell>
                    <TableCell className="font-medium text-white">{trade.pair}</TableCell>
                    <TableCell className="text-gray-300">{trade.strategy}</TableCell>
                    <TableCell className="text-right text-gray-300">
                      {formatCurrency(trade.entryPrice)}
                    </TableCell>
                    <TableCell className="text-right text-gray-300">
                      {trade.exitPrice ? formatCurrency(trade.exitPrice) : '—'}
                    </TableCell>
                    <TableCell className="text-right">
                      {trade.pnl !== null ? (
                        <span className={`flex items-center justify-end gap-1 ${
                          trade.pnl >= 0 ? 'text-green-500' : 'text-red-500'
                        }`}>
                          {trade.pnl >= 0 ? (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                            </svg>
                          ) : (
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 14l-7 7m0 0l-7-7m7 7V3" />
                            </svg>
                          )}
                          {trade.pnl >= 0 ? '+' : ''}{formatCurrency(trade.pnl)}
                        </span>
                      ) : (
                        <span className="text-gray-500">—</span>
                      )}
                    </TableCell>
                    <TableCell className="text-center">
                      <Badge
                        className={`${
                          trade.status === 'CLOSED'
                            ? 'bg-green-500/20 text-green-500 border-green-500/30'
                            : 'bg-amber-500/20 text-amber-500 border-amber-500/30'
                        }`}
                      >
                        {trade.status === 'CLOSED' ? 'Closed' : 'Open'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right text-gray-400 text-sm">
                      {calculateDuration(trade)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {/* Pagination */}
      {!loading && tradesList.length > 0 && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-gray-400">
            Showing {tradesList.length} of {total} trades
          </p>
          <div className="flex items-center gap-4">
            <Button
              onClick={handlePrevPage}
              disabled={page === 1}
              variant="outline"
              className="bg-[#1a1a1a] border-[#2a2a2a] text-white hover:bg-[#2a2a2a] hover:text-white disabled:opacity-50"
            >
              <svg className="w-4 h-4 mr-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
              </svg>
              Previous
            </Button>
            <span className="text-sm text-gray-400">
              Page {page} of {totalPages}
            </span>
            <Button
              onClick={handleNextPage}
              disabled={page === totalPages}
              variant="outline"
              className="bg-[#1a1a1a] border-[#2a2a2a] text-white hover:bg-[#2a2a2a] hover:text-white disabled:opacity-50"
            >
              Next
              <svg className="w-4 h-4 ml-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
              </svg>
            </Button>
          </div>
        </div>
      )}
    </div>
  )
}
