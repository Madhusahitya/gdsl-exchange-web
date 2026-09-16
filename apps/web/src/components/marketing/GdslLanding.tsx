'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import { BrandMark } from '@/components/platform/BrandMark'

export function GdslLanding() {
  const [scan, setScan] = useState(2840)

  useEffect(() => {
    const id = window.setInterval(() => {
      setScan((n) => n + Math.floor(Math.random() * 3) + 1)
    }, 4000)
    return () => clearInterval(id)
  }, [])

  return (
    <div className="min-h-screen gdsl-grid-bg text-white">
      <header className="border-b border-emerald-500/20 bg-black/40 backdrop-blur-sm sticky top-0 z-20">
        <div className="max-w-6xl mx-auto px-4 py-4 flex flex-wrap items-center justify-between gap-4">
          <Link href="/" className="inline-flex">
            <BrandMark className="text-xl" />
          </Link>
          <div className="flex items-center gap-2 text-xs font-mono text-emerald-500/90">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            BOT SCANNING · #{scan.toLocaleString()}
          </div>
          <div className="flex gap-2">
            <Button asChild variant="outline" className="border-emerald-500/40 text-emerald-300 hover:bg-emerald-500/10">
              <Link href="/login">Sign in</Link>
            </Button>
            <Button asChild className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold">
              <Link href="/dashboard">Open DEX bot</Link>
            </Button>
          </div>
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-4 py-16 space-y-24">
        <section className="text-center space-y-6">
          <p className="text-emerald-500/90 text-xs font-mono tracking-widest">DEX · NON-CUSTODIAL · BNB SMART CHAIN</p>
          <h1 className="text-4xl sm:text-5xl md:text-6xl font-extrabold leading-tight">
            Trades on-chain.
            <span className="text-emerald-400"> You stay in control.</span>
          </h1>
          <p className="text-gray-400 max-w-2xl mx-auto text-sm sm:text-base leading-relaxed font-mono">
            DEX execution assistant: signals, risk gates, and swap routes. You sign every trade.
          </p>
          <div className="flex flex-wrap justify-center gap-3 pt-2">
            <Button asChild size="lg" className="bg-emerald-500 hover:bg-emerald-400 text-black font-semibold px-8">
              <Link href="/dashboard">Launch app</Link>
            </Button>
            <Button asChild size="lg" variant="outline" className="border-gray-600 text-gray-200 hover:bg-white/5">
              <Link href="/dashboard">Dashboard</Link>
            </Button>
          </div>
        </section>

        <section className="space-y-6">
          <p className="text-emerald-500 font-mono text-sm">// THE HONEST PART</p>
          <h2 className="text-3xl sm:text-4xl font-bold max-w-3xl">
            Most automated strategies <span className="text-emerald-400">underperform</span> after fees and bad timing.
          </h2>
          <p className="text-gray-400 font-mono text-sm max-w-3xl leading-relaxed">
            We publish <strong className="text-gray-200">fifteen pre-flight checks</strong>, a session loss circuit, optional Fear &amp; Greed
            gating, and Telegram alerts — so you know what blocked a trade and why. No hidden custody; no guaranteed returns.
          </p>
          <div className="grid sm:grid-cols-2 gap-4 pt-4">
            {[
              {
                title: 'Stress mindset',
                stat: 'Risk-first',
                note: 'Design for survival: caps, kill switch, slippage bounds — not lottery tickets.',
              },
              {
                title: 'Transparency',
                stat: 'Checklist UI',
                note: 'Every gate shows pass/fail before you sign — similar discipline to institutional pre-trade checks.',
              },
              {
                title: 'Your keys',
                stat: 'Non-custodial',
                note: 'WalletConnect or injected wallet; we never batch-sign on your behalf.',
              },
              {
                title: 'Alerts',
                stat: 'Telegram (opt-in)',
                note: 'Server-side bot token only; optional signals to your chat when configured.',
              },
            ].map((c) => (
              <div
                key={c.title}
                className="rounded-xl border border-white/10 bg-black/30 p-5 text-left hover:border-emerald-500/30 transition-colors"
              >
                <p className="text-xs font-mono text-emerald-500/80 uppercase">{c.title}</p>
                <p className="text-2xl font-bold text-amber-200 mt-2">{c.stat}</p>
                <p className="text-sm text-gray-500 mt-2 leading-relaxed">{c.note}</p>
              </div>
            ))}
          </div>
          <p className="text-xs text-gray-600 font-mono max-w-3xl">
            Illustrative framing only. Past performance does not guarantee future results.
          </p>
        </section>

        <section className="space-y-8">
          <p className="text-emerald-500 font-mono text-sm">// HOW IT WORKS</p>
          <h2 className="text-3xl font-bold">
            Configure once. <span className="text-emerald-400">Sign each move.</span>
          </h2>
          <div className="grid md:grid-cols-3 gap-6">
            {[
              {
                step: '01',
                title: 'Connect & cap risk',
                body: 'Link your wallet, set max per trade, slippage, daily loss cap, and optional Fear & Greed ceiling.',
              },
              {
                step: '02',
                title: 'Pass fifteen gates',
                body: 'Our client evaluates liquidity, volatility, signal alignment, RSI consensus, and more before enabling BUY.',
              },
              {
                step: '03',
                title: 'Execute on Pancake',
                body: 'You confirm swaps on BSC. Session P&amp;L estimates and Telegram hooks are optional add-ons.',
              },
            ].map((s) => (
              <div key={s.step} className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-6 space-y-3">
                <span className="text-emerald-400 font-mono text-2xl font-bold">{s.step}</span>
                <h3 className="text-lg font-semibold text-white">{s.title}</h3>
                <p className="text-sm text-gray-400 leading-relaxed">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <footer className="border-t border-white/10 pt-10 pb-16 text-center text-xs text-gray-600 font-mono space-y-3">
          <p>
            koie.fin is software for self-directed trading. Not investment advice. Crypto may go to zero.
          </p>
          <p>
            <Link href="/dashboard" className="text-emerald-500 hover:underline">
              Dashboard
            </Link>
            {' · '}
            <Link href="/login" className="text-emerald-500 hover:underline">
              Sign in
            </Link>
          </p>
        </footer>
      </main>
    </div>
  )
}
