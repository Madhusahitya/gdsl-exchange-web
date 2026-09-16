/** Platform wordmark — koie.fin */
export function BrandMark({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-flex items-baseline font-sans text-lg font-semibold tracking-tight sm:text-xl ${className}`}
    >
      <span className="text-white">koie</span>
      <span className="text-emerald-400">.fin</span>
    </span>
  )
}
