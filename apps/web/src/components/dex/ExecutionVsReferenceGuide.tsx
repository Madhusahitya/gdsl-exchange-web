'use client'

import Link from 'next/link'

type Props = {
  /** Compact = trade panel; full = more detail visible by default */
  variant?: 'compact' | 'full'
  className?: string
}

export function ExecutionVsReferenceGuide({ variant = 'compact', className = '' }: Props) {
  return (
    <details
      id="execution-guide"
      className={`group rounded-lg border border-sky-500/20 bg-sky-500/5 ${className}`}
      open={variant === 'full'}
    >
      <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-sky-200 [&::-webkit-details-marker]:hidden">
        <span className="inline-flex items-center gap-1.5">
          <span className="text-sky-400">ⓘ</span>
          Why 1inch price ≠ chart price (client guide)
          <span className="text-[10px] font-normal text-zinc-500 group-open:hidden">— tap to expand</span>
        </span>
      </summary>
      <div className="space-y-2 border-t border-sky-500/15 px-3 py-2 text-[11px] leading-relaxed text-zinc-400">
        <p>
          <strong className="text-zinc-200">Chart (Binance)</strong> = reference only — trends and
          comparison. <strong className="text-zinc-200">1inch execution price</strong> = what you
          actually pay or receive on BSC. The gap is normal (different venue, size, fees, route).
        </p>
        <ul className="list-inside list-disc space-y-1 text-zinc-500">
          <li>
            <strong className="text-zinc-400">BUY</strong> with positive “vs Binance” → you pay more per
            token than the chart.
          </li>
          <li>
            Dashboard <strong className="text-zinc-400">avg fill</strong> stays at your real buy;{' '}
            <strong className="text-zinc-400">exit mark</strong> uses a live 1inch sell quote for PnL.
          </li>
          <li>We cannot guarantee fills at Binance spot — we show the gap so you decide before swapping.</li>
        </ul>
        <p className="text-[10px] text-zinc-600">
          Shareable PDF: ask your operator for{' '}
          <code className="rounded bg-black/40 px-1 text-zinc-400">docs/execution-vs-reference-price.md</code>{' '}
          (print to PDF from repo or Notion).
        </p>
        <Link
          href="/dashboard"
          className="inline-block text-[10px] text-sky-400 underline hover:text-sky-300"
        >
          Dashboard open positions →
        </Link>
      </div>
    </details>
  )
}
