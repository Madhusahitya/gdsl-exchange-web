export default function RootLoading() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-[#030705]">
      <div className="text-center">
        <div className="mx-auto mb-4 h-8 w-8 animate-spin rounded-full border-2 border-emerald-500/30 border-t-emerald-400" />
        <p className="font-mono text-sm text-emerald-400/80">Loading terminal…</p>
        <p className="mt-2 text-xs text-white/40">First compile in dev can take 1–2 minutes</p>
      </div>
    </div>
  )
}
