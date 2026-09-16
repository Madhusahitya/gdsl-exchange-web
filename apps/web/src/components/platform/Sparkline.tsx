'use client'

export default function Sparkline({ values, accent = '#34d399' }: { values: number[]; accent?: string }) {
  if (!values.length) {
    return <div className="h-8 w-24 rounded bg-white/5" />
  }
  const min = Math.min(...values)
  const max = Math.max(...values)
  const pad = max === min ? 1 : max - min
  const w = 96
  const h = 32
  const pts = values
    .map((v, i) => {
      const x = (i / Math.max(values.length - 1, 1)) * w
      const y = h - ((v - min) / pad) * (h - 4) - 2
      return `${x},${y}`
    })
    .join(' ')
  return (
    <svg width={w} height={h} className="overflow-visible" aria-hidden>
      <polyline fill="none" stroke={accent} strokeWidth="1.5" points={pts} />
    </svg>
  )
}
