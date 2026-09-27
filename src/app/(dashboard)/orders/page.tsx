'use client'

import { useEffect, useState } from 'react'
import { orders, exchange, wallet } from '@/lib/api'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import Link from 'next/link'

type OrderRow = {
  id: string
  symbol: string
  side: string
  type: string
  quantity: string
  price: string | null
  status: string
  createdAt: string
}

export default function OrdersPage() {
  const [connectionId, setConnectionId] = useState<string>('')
  const [symbol, setSymbol] = useState<'BTCUSDT' | 'ETHUSDT' | 'SOLUSDT'>('BTCUSDT')
  const [side, setSide] = useState<'BUY' | 'SELL'>('BUY')
  const [type, setType] = useState<'MARKET' | 'LIMIT'>('MARKET')
  const [quantity, setQuantity] = useState('0.001')
  const [price, setPrice] = useState('')
  const [rows, setRows] = useState<OrderRow[]>([])
  const [submitting, setSubmitting] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [availableUsdt, setAvailableUsdt] = useState(0)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const [orderData, connections, balances] = await Promise.all([orders.list({ limit: 20 }), exchange.listConnections(), wallet.balances()])
      setRows(orderData.orders ?? [])
      if (!connectionId && connections[0]?.id) setConnectionId(connections[0].id)
      const usdt = (balances.assets ?? []).find((a: { asset: string; free: number }) => a.asset === 'USDT')
      setAvailableUsdt(usdt?.free ?? 0)
    } catch {
      setRows([])
      setAvailableUsdt(0)
      setError('Unable to reach API. Make sure backend is running on the configured URL.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  const submit = async () => {
    const qty = Number(quantity)
    const px = type === 'LIMIT' ? Number(price || 0) : 0
    if (side === 'BUY' && type === 'LIMIT' && qty > 0 && px > 0 && qty * px > availableUsdt) {
      setError(`Insufficient USDT balance. Required ${ (qty * px).toFixed(4) }, available ${availableUsdt.toFixed(4) }.`)
      return
    }

    setSubmitting(true)
    setError(null)
    try {
      await orders.create({
        exchangeConnectionId: connectionId,
        symbol,
        side,
        type,
        quantity: Number(quantity),
        ...(type === 'LIMIT' && price ? { price: Number(price), timeInForce: 'GTC' } : {}),
      })
      await load()
    } catch {
      setError('Order request failed. Check API connectivity, exchange key setup, and request fields.')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold text-white">Orders</h1>
        <p className="text-gray-400 mt-1">Place and monitor live exchange orders.</p>
      </div>

      <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
        <CardHeader><CardTitle className="text-white">New Order</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/10 px-3 py-2 flex items-center justify-between">
            <p className="text-emerald-300 text-sm">Available USDT for trading</p>
            <p className="text-white font-mono">{availableUsdt.toLocaleString('en-US', { maximumFractionDigits: 4 })}</p>
          </div>
          {!connectionId && (
            <p className="text-amber-400 text-sm">No exchange key connected. <Link href="/exchange" className="underline">Connect wallet key first</Link>.</p>
          )}
          <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          <select className="bg-[#141414] border border-[#2a2a2a] rounded px-3 py-2 text-white" value={symbol} onChange={(e) => setSymbol(e.target.value as typeof symbol)}>
            <option value="BTCUSDT">BTCUSDT</option>
            <option value="ETHUSDT">ETHUSDT</option>
            <option value="SOLUSDT">SOLUSDT</option>
          </select>
          <select className="bg-[#141414] border border-[#2a2a2a] rounded px-3 py-2 text-white" value={side} onChange={(e) => setSide(e.target.value as typeof side)}>
            <option value="BUY">BUY</option>
            <option value="SELL">SELL</option>
          </select>
          <select className="bg-[#141414] border border-[#2a2a2a] rounded px-3 py-2 text-white" value={type} onChange={(e) => setType(e.target.value as typeof type)}>
            <option value="MARKET">MARKET</option>
            <option value="LIMIT">LIMIT</option>
          </select>
          <Input value={quantity} onChange={(e) => setQuantity(e.target.value)} placeholder="Quantity" />
          <Input value={price} onChange={(e) => setPrice(e.target.value)} placeholder="Price (limit only)" disabled={type === 'MARKET'} />
          <Button onClick={submit} disabled={!connectionId || submitting}>{submitting ? 'Placing...' : 'Place Order'}</Button>
          </div>
        </CardContent>
      </Card>

      <Card className="bg-[#1a1a1a] border-[#2a2a2a]">
        <CardHeader><CardTitle className="text-white">Recent Orders</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          {loading ? (
            <p className="text-gray-400">Loading orders...</p>
          ) : error ? (
            <p className="text-red-400">{error}</p>
          ) : rows.length === 0 ? (
            <p className="text-gray-400">No orders yet.</p>
          ) : rows.map((row) => (
            <div key={row.id} className="flex items-center justify-between rounded-lg border border-[#2a2a2a] bg-[#141414] px-4 py-3">
              <div>
                <p className="text-white">{row.symbol} {row.side} {row.type}</p>
                <p className="text-xs text-gray-400">{new Date(row.createdAt).toLocaleString()}</p>
              </div>
              <div className="text-right">
                <p className="text-white font-mono">{Number(row.quantity)} {row.price ? `@ ${Number(row.price)}` : ''}</p>
                <p className="text-xs text-gray-400">{row.status}</p>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>
    </div>
  )
}
