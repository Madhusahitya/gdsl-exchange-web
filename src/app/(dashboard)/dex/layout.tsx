import { Suspense } from 'react'

export default function DexLayout({ children }: { children: React.ReactNode }) {
  return (
    <Suspense fallback={<div className="py-10 text-center text-sm text-zinc-500 font-mono">Loading DEX terminal…</div>}>
      {children}
    </Suspense>
  )
}
