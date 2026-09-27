'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { dexJupiter, type DexJupiterQuotePreview, type JupiterExitSettings } from '@/lib/api'

const LS_PREFIX = 'jupiter_'

export type SlippagePreset = 'major' | 'mid' | 'meme'

export const SLIPPAGE_PRESETS: Record<
  SlippagePreset,
  { label: string; pct: string; hint: string }
> = {
  major: { label: 'Major', pct: '0.5', hint: 'SOL, USDC, large caps' },
  mid: { label: 'Mid', pct: '1', hint: 'Established alts' },
  meme: { label: 'Meme', pct: '2', hint: 'Volatile / thin pools' },
}

export function tokenSafetyLevel(opts: {
  quoteVolume?: number
  liquidityUsd?: number
}): { level: string; label: string; className: string } {
  const vol = opts.quoteVolume ?? opts.liquidityUsd ?? 0
  if (vol >= 500_000) {
    return { level: 'liquid', label: 'High liquidity', className: 'bg-emerald-500/15 text-emerald-400' }
  }
  if (vol >= 150_000) {
    return { level: 'verified', label: 'Verified · OK liquidity', className: 'bg-violet-500/15 text-violet-300' }
  }
  if (vol >= 50_000) {
    return { level: 'low_liq', label: 'Low liquidity', className: 'bg-amber-500/15 text-amber-300' }
  }
  return { level: 'risky', label: 'Thin pool · high risk', className: 'bg-rose-500/15 text-rose-400' }
}

export function TokenSafetyBadge(props: { quoteVolume?: number; liquidityUsd?: number }) {
  const s = tokenSafetyLevel(props)
  return (
    <span className={`rounded px-1.5 py-0.5 text-[9px] font-medium ${s.className}`}>{s.label}</span>
  )
}

export function EntryQualityBanner({ quote }: { quote: DexJupiterQuotePreview | null }) {
  if (!quote || quote.side !== 'BUY' || !quote.entryQuality) return null
  const styles = {
    good: 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200',
    caution: 'border-amber-500/30 bg-amber-500/10 text-amber-100',
    poor: 'border-rose-500/30 bg-rose-500/10 text-rose-200',
  }
  const icons = { good: 'Good entry', caution: 'Wide spread', poor: 'Blocked' }
  return (
    <div className={`rounded-lg border px-2.5 py-2 text-[11px] leading-snug ${styles[quote.entryQuality]}`}>
      <p className="font-semibold">{icons[quote.entryQuality]}</p>
      {quote.entryQualityNote ? <p className="mt-0.5 opacity-90">{quote.entryQualityNote}</p> : null}
      {quote.minMoveToBreakEvenPct != null ? (
        <p className="mt-1 font-mono text-[10px] opacity-80">
          Break-even move: +{quote.minMoveToBreakEvenPct.toFixed(2)}%
          {quote.roundTripSpreadBps != null
            ? ` · spread ${(quote.roundTripSpreadBps / 100).toFixed(2)}%`
            : ''}
        </p>
      ) : null}
    </div>
  )
}

type Props = {
  slippagePct: string
  onSlippagePctChange: (v: string) => void
  slippagePreset: SlippagePreset
  onSlippagePresetChange: (p: SlippagePreset) => void
}

export function JupiterProfitControls({
  slippagePct,
  onSlippagePctChange,
  slippagePreset,
  onSlippagePresetChange,
}: Props) {
  const [exit, setExit] = useState<JupiterExitSettings>({
    enabled: true,
    takeProfitPct: 1.0,
    stopLossPct: 1.0,
    trailingStop: false,
    profitSkim: true,
    trailingActivationPct: 0.8,
    trailingDeltaPct: 0.4,
  })
  const [saving, setSaving] = useState(false)

  const persistLocal = useCallback((next: JupiterExitSettings) => {
    localStorage.setItem(`${LS_PREFIX}tpSlEnabled`, next.enabled ? '1' : '0')
    localStorage.setItem(`${LS_PREFIX}takeProfitPct`, String(next.takeProfitPct))
    localStorage.setItem(`${LS_PREFIX}stopLossPct`, String(next.stopLossPct))
    localStorage.setItem(`${LS_PREFIX}trailingStop`, next.trailingStop ? '1' : '0')
    localStorage.setItem(`${LS_PREFIX}profitSkim`, next.profitSkim ? '1' : '0')
    localStorage.setItem(`${LS_PREFIX}trailActivationPct`, String(next.trailingActivationPct ?? 0.8))
    localStorage.setItem(`${LS_PREFIX}trailDeltaPct`, String(next.trailingDeltaPct ?? 0.4))
  }, [])

  const loadSettings = useCallback(async () => {
    const fromLs: JupiterExitSettings = {
      enabled: localStorage.getItem(`${LS_PREFIX}tpSlEnabled`) !== '0',
      takeProfitPct: Number.parseFloat(localStorage.getItem(`${LS_PREFIX}takeProfitPct`) ?? '1') || 1,
      stopLossPct: Number.parseFloat(localStorage.getItem(`${LS_PREFIX}stopLossPct`) ?? '1') || 1,
      trailingStop: localStorage.getItem(`${LS_PREFIX}trailingStop`) === '1',
      profitSkim: localStorage.getItem(`${LS_PREFIX}profitSkim`) !== '0',
      trailingActivationPct: Number.parseFloat(localStorage.getItem(`${LS_PREFIX}trailActivationPct`) ?? '0.8') || 0.8,
      trailingDeltaPct: Number.parseFloat(localStorage.getItem(`${LS_PREFIX}trailDeltaPct`) ?? '0.4') || 0.4,
    }
    setExit(fromLs)
    try {
      const server = await dexJupiter.exitSettings()
      setExit(server)
      persistLocal(server)
    } catch {
      // Use localStorage fallback.
    }
  }, [persistLocal])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const saveExit = async (patch: Partial<JupiterExitSettings>) => {
    const next = { ...exit, ...patch }
    setExit(next)
    persistLocal(next)
    setSaving(true)
    try {
      const saved = await dexJupiter.saveExitSettings(next)
      setExit(saved)
      persistLocal(saved)
    } catch {
      toast.error('Could not sync exit settings — using local values')
    } finally {
      setSaving(false)
    }
  }

  const applyPreset = (key: SlippagePreset) => {
    onSlippagePresetChange(key)
    onSlippagePctChange(SLIPPAGE_PRESETS[key].pct)
    localStorage.setItem(`${LS_PREFIX}slippagePreset`, key)
  }

  useEffect(() => {
    const saved = localStorage.getItem(`${LS_PREFIX}slippagePreset`) as SlippagePreset | null
    if (saved && SLIPPAGE_PRESETS[saved]) {
      onSlippagePresetChange(saved)
      onSlippagePctChange(SLIPPAGE_PRESETS[saved].pct)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- hydrate once on mount
  }, [])

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-white/10 bg-black/20 p-2.5">
        <p className="text-[11px] font-semibold text-zinc-200">Slippage preset</p>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {(Object.keys(SLIPPAGE_PRESETS) as SlippagePreset[]).map((key) => (
            <button
              key={key}
              type="button"
              onClick={() => applyPreset(key)}
              className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition ${
                slippagePreset === key
                  ? 'bg-violet-600 text-white'
                  : 'bg-white/5 text-zinc-400 hover:bg-white/10'
              }`}
            >
              {SLIPPAGE_PRESETS[key].label} · {SLIPPAGE_PRESETS[key].pct}%
            </button>
          ))}
        </div>
        <label className="mt-2 block text-[10px] text-zinc-500">
          Custom %
          <Input
            value={slippagePct}
            onChange={(e) => onSlippagePctChange(e.target.value)}
            className="mt-1 h-8 border-white/10 bg-black/40 font-mono text-xs"
          />
        </label>
      </div>

      <div className="space-y-2 rounded-lg border border-white/10 bg-black/20 p-2.5">
        <label className="flex items-center gap-2 text-[11px] text-zinc-300">
          <input
            type="checkbox"
            checked={exit.enabled}
            onChange={(e) => void saveExit({ enabled: e.target.checked })}
          />
          <strong className="text-white">Auto take-profit &amp; stop-loss</strong>
        </label>

        <div className="grid grid-cols-2 gap-2">
          <label className="text-[10px] text-zinc-500">
            Take profit %
            <Input
              type="number"
              min={0.1}
              step={0.1}
              value={exit.takeProfitPct}
              disabled={!exit.enabled}
              onChange={(e) =>
                setExit((p) => ({ ...p, takeProfitPct: Number.parseFloat(e.target.value) || p.takeProfitPct }))
              }
              onBlur={() => void saveExit({ takeProfitPct: exit.takeProfitPct })}
              className="mt-1 h-8 border-white/10 bg-black/40 font-mono text-xs"
            />
          </label>
          <label className="text-[10px] text-zinc-500">
            Stop loss %
            <Input
              type="number"
              min={0.1}
              step={0.1}
              value={exit.stopLossPct}
              disabled={!exit.enabled}
              onChange={(e) =>
                setExit((p) => ({ ...p, stopLossPct: Number.parseFloat(e.target.value) || p.stopLossPct }))
              }
              onBlur={() => void saveExit({ stopLossPct: exit.stopLossPct })}
              className="mt-1 h-8 border-white/10 bg-black/40 font-mono text-xs"
            />
          </label>
        </div>

        <label className="flex items-center gap-2 text-[10px] text-zinc-400">
          <input
            type="checkbox"
            checked={exit.profitSkim}
            disabled={!exit.enabled}
            onChange={(e) => void saveExit({ profitSkim: e.target.checked })}
          />
          <strong className="text-zinc-200">Profit skim</strong>
        </label>

        <label className="flex items-center gap-2 text-[10px] text-zinc-400">
          <input
            type="checkbox"
            checked={exit.trailingStop}
            disabled={!exit.enabled}
            onChange={(e) => void saveExit({ trailingStop: e.target.checked })}
          />
          <strong className="text-zinc-200">Trailing stop</strong>
        </label>

        {exit.trailingStop ? (
          <div className="grid grid-cols-2 gap-2 pl-5">
            <label className="text-[10px] text-zinc-500">
              Arm after +%
              <Input
                type="number"
                min={0.2}
                max={10}
                step={0.1}
                value={exit.trailingActivationPct ?? 0.8}
                disabled={!exit.enabled}
                onChange={(e) =>
                  setExit((p) => ({
                    ...p,
                    trailingActivationPct: Number.parseFloat(e.target.value) || p.trailingActivationPct,
                  }))
                }
                onBlur={() => void saveExit({ trailingActivationPct: exit.trailingActivationPct })}
                className="mt-1 h-8 border-white/10 bg-black/40 font-mono text-xs"
              />
            </label>
            <label className="text-[10px] text-zinc-500">
              Trail distance %
              <Input
                type="number"
                min={0.1}
                max={10}
                step={0.1}
                value={exit.trailingDeltaPct ?? 0.4}
                disabled={!exit.enabled}
                onChange={(e) =>
                  setExit((p) => ({
                    ...p,
                    trailingDeltaPct: Number.parseFloat(e.target.value) || p.trailingDeltaPct,
                  }))
                }
                onBlur={() => void saveExit({ trailingDeltaPct: exit.trailingDeltaPct })}
                className="mt-1 h-8 border-white/10 bg-black/40 font-mono text-xs"
              />
            </label>
          </div>
        ) : null}

        {saving ? <p className="text-[9px] text-zinc-600">Syncing…</p> : null}
      </div>
    </div>
  )
}
