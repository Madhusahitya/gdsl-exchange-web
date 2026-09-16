export default function AgentsLoading() {
  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-4 p-3 sm:p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="h-7 w-48 animate-pulse rounded-lg bg-white/10" />
        <div className="flex gap-2">
          <div className="h-7 w-20 animate-pulse rounded-full bg-white/10" />
          <div className="h-7 w-20 animate-pulse rounded-full bg-white/10" />
          <div className="h-7 w-24 animate-pulse rounded-full bg-white/10" />
        </div>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="h-36 animate-pulse rounded-xl border border-white/10 bg-white/[0.03]" />
        ))}
      </div>
    </div>
  )
}
