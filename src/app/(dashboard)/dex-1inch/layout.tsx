import { Suspense } from 'react'

export default function DexOneInchLayout({ children }: { children: React.ReactNode }) {
  return <Suspense fallback={null}>{children}</Suspense>
}
