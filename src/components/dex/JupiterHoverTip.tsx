'use client'

/** One-line hover tooltip — plain language, no jargon. */
export function JupiterHoverTip({
  label,
  tip,
  active,
  disabled,
  onClick,
  badge,
  className,
}: {
  label: string
  tip: string
  active?: boolean
  disabled?: boolean
  onClick?: () => void
  badge?: string
  className?: string
}) {
  return (
    <span className={`group relative inline-flex ${className ?? ''}`}>
      <button
        type="button"
        disabled={disabled}
        onClick={onClick}
        className={`rounded-md px-3 py-1.5 text-xs font-medium transition ${
          active
            ? 'bg-emerald-600/90 text-white'
            : disabled
              ? 'cursor-not-allowed text-zinc-600'
              : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
        }`}
      >
        {label}
        {badge ? (
          <span className="ml-1 rounded bg-white/10 px-1 py-0.5 text-[9px] font-normal text-zinc-400">
            {badge}
          </span>
        ) : null}
      </button>
      <span
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-2 w-max max-w-[220px] -translate-x-1/2 rounded-md border border-white/10 bg-zinc-900 px-2.5 py-1.5 text-[11px] leading-snug text-zinc-200 opacity-0 shadow-xl transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
      >
        {tip}
      </span>
    </span>
  )
}
