'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { dexJupiter, type JupiterAutopilotSettings } from '@/lib/api'

const LS_PREFIX = 'jupiter_autopilot_'

export function JupiterAutopilotPanel() {
  const [settings, setSettings] = useState<JupiterAutopilotSettings>({
    enabled: false,
    maxBuyUsd: 25,
    minLiquidityUsd: 150_000,
    minSignal: 'rising',
    maxOpenPositions: 1,
  })
  const [saving, setSaving] = useState(false)

  const persistLocal = useCallback((next: JupiterAutopilotSettings) => {
    localStorage.setItem(`${LS_PREFIX}enabled`, next.enabled ? '1' : '0')
    localStorage.setItem(`${LS_PREFIX}maxBuyUsd`, String(next.maxBuyUsd))
    localStorage.setItem(`${LS_PREFIX}minLiquidityUsd`, String(next.minLiquidityUsd))
    localStorage.setItem(`${LS_PREFIX}minSignal`, next.minSignal)
    localStorage.setItem(`${LS_PREFIX}maxOpenPositions`, String(next.maxOpenPositions))
  }, [])

  const loadSettings = useCallback(async () => {
    const fromLs: JupiterAutopilotSettings = {
      enabled: localStorage.getItem(`${LS_PREFIX}enabled`) === '1',
      maxBuyUsd: Number.parseFloat(localStorage.getItem(`${LS_PREFIX}maxBuyUsd`) ?? '25') || 25,
      minLiquidityUsd:
        Number.parseFloat(localStorage.getItem(`${LS_PREFIX}minLiquidityUsd`) ?? '150000') || 150_000,
      minSignal: localStorage.getItem(`${LS_PREFIX}minSignal`) === 'strong' ? 'strong' : 'rising',
      maxOpenPositions: Number.parseInt(localStorage.getItem(`${LS_PREFIX}maxOpenPositions`) ?? '1', 10) || 1,
    }
    setSettings(fromLs)
    try {
      const server = await dexJupiter.autopilotSettings()
      setSettings(server)
      persistLocal(server)
    } catch {
      // localStorage fallback
    }
  }, [persistLocal])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const save = async (patch: Partial<JupiterAutopilotSettings>) => {
    const next = { ...settings, ...patch }
    setSettings(next)
    persistLocal(next)
    setSaving(true)
    try {
      const saved = await dexJupiter.saveAutopilotSettings(next)
      setSettings(saved)
      persistLocal(saved)
      if (saved.enabled) {
        toast.success('Auto-pilot enabled — server will scan every ~90s')
      }
    } catch {
      toast.error('Could not sync auto-pilot settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-2.5">
      <label className="flex items-center gap-2 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          checked={settings.enabled}
          onChange={(e) => void save({ enabled: e.target.checked })}
        />
        <strong className="text-amber-100">Auto-pilot</strong>
      </label>

      <div className="grid grid-cols-2 gap-2">
        <label className="text-[10px] text-zinc-500">
          Max buy (USDC)
          <Input
            type="number"
            min={5}
            max={100}
            step={5}
            value={settings.maxBuyUsd}
            disabled={!settings.enabled}
            onChange={(e) =>
              setSettings((p) => ({ ...p, maxBuyUsd: Number.parseFloat(e.target.value) || p.maxBuyUsd }))
            }
            onBlur={() => void save({ maxBuyUsd: settings.maxBuyUsd })}
            className="mt-1 h-8 border-white/10 bg-black/40 font-mono text-xs"
          />
        </label>
        <label className="text-[10px] text-zinc-500">
          Min liquidity $
          <Input
            type="number"
            min={50000}
            step={50000}
            value={settings.minLiquidityUsd}
            disabled={!settings.enabled}
            onChange={(e) =>
              setSettings((p) => ({
                ...p,
                minLiquidityUsd: Number.parseFloat(e.target.value) || p.minLiquidityUsd,
              }))
            }
            onBlur={() => void save({ minLiquidityUsd: settings.minLiquidityUsd })}
            className="mt-1 h-8 border-white/10 bg-black/40 font-mono text-xs"
          />
        </label>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {(['rising', 'strong'] as const).map((sig) => (
          <button
            key={sig}
            type="button"
            disabled={!settings.enabled}
            onClick={() => void save({ minSignal: sig })}
            className={`rounded-md px-2.5 py-1 text-[10px] font-medium transition ${
              settings.minSignal === sig
                ? 'bg-amber-600 text-white'
                : 'bg-white/5 text-zinc-400 hover:bg-white/10'
            }`}
          >
            {sig === 'strong' ? 'Strong only' : 'Rising + strong'}
          </button>
        ))}
      </div>

      {saving ? <p className="text-[9px] text-zinc-600">Syncing…</p> : null}
    </div>
  )
}
