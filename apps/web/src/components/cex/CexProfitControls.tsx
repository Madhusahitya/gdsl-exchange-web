'use client'

import { useCallback, useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Input } from '@/components/ui/input'
import { engine } from '@/lib/api'

const LS_PREFIX = 'cex_'

type CexExit = {
  enabled: boolean
  takeProfitPct: number
  stopLossPct: number
  profitSkim: boolean
  trailingStop: boolean
  trailingActivationPct: number
  trailingDeltaPct: number
}

/** Binance CEX exit controls — TP/SL + trailing stop (skim lives on the position card). */
export function CexProfitControls() {
  const [exit, setExit] = useState<CexExit>({
    enabled: true,
    takeProfitPct: 1,
    stopLossPct: 1,
    profitSkim: false,
    trailingStop: false,
    trailingActivationPct: 0.8,
    trailingDeltaPct: 0.4,
  })
  const [saving, setSaving] = useState(false)
  const [preflight, setPreflight] = useState<string[]>([])

  const persistLocal = useCallback((next: CexExit) => {
    localStorage.setItem(`${LS_PREFIX}tpSlEnabled`, next.enabled ? '1' : '0')
    localStorage.setItem(`${LS_PREFIX}takeProfitPct`, String(next.takeProfitPct))
    localStorage.setItem(`${LS_PREFIX}stopLossPct`, String(next.stopLossPct))
    localStorage.setItem(`${LS_PREFIX}profitSkim`, next.profitSkim ? '1' : '0')
    localStorage.setItem(`${LS_PREFIX}trailingStop`, next.trailingStop ? '1' : '0')
    localStorage.setItem(`${LS_PREFIX}trailActivationPct`, String(next.trailingActivationPct))
    localStorage.setItem(`${LS_PREFIX}trailDeltaPct`, String(next.trailingDeltaPct))
  }, [])

  const loadSettings = useCallback(async () => {
    const fromLs: CexExit = {
      enabled: localStorage.getItem(`${LS_PREFIX}tpSlEnabled`) !== '0',
      takeProfitPct: Number.parseFloat(localStorage.getItem(`${LS_PREFIX}takeProfitPct`) ?? '1') || 1,
      stopLossPct: Number.parseFloat(localStorage.getItem(`${LS_PREFIX}stopLossPct`) ?? '1') || 1,
      profitSkim: localStorage.getItem(`${LS_PREFIX}profitSkim`) === '1',
      trailingStop: localStorage.getItem(`${LS_PREFIX}trailingStop`) === '1',
      trailingActivationPct: Number.parseFloat(localStorage.getItem(`${LS_PREFIX}trailActivationPct`) ?? '0.8') || 0.8,
      trailingDeltaPct: Number.parseFloat(localStorage.getItem(`${LS_PREFIX}trailDeltaPct`) ?? '0.4') || 0.4,
    }
    setExit(fromLs)
    try {
      const res = await engine.cexExit()
      setExit(res.settings)
      persistLocal(res.settings)
    } catch {
      /* local fallback */
    }
  }, [persistLocal])

  useEffect(() => {
    void loadSettings()
  }, [loadSettings])

  const saveExit = async (patch: Partial<CexExit>) => {
    const next = { ...exit, ...patch }
    setExit(next)
    persistLocal(next)
    setSaving(true)
    try {
      const saved = await engine.setCexExit(next)
      setExit(saved.settings)
      persistLocal(saved.settings)
    } catch {
      toast.error('Could not sync CEX exit settings — using local values')
    } finally {
      setSaving(false)
    }
  }

  /** Animated readiness steps when enabling Super Machine (Jupiter-style preflight). */
  const runPreflight = useCallback(async () => {
    const steps = [
      'Checking Binance trade-only API key…',
      'Verifying Binance balance + risk limits…',
      'Loading AI council agents (momentum → order book)…',
      'Arming take-profit / stop-loss watcher…',
      'Super Machine ready — council gates entries',
    ]
    setPreflight([])
    for (const s of steps) {
      setPreflight((prev) => [...prev, s])
      await new Promise((r) => setTimeout(r, 280))
    }
  }, [])

  useEffect(() => {
    const onPreflight = () => void runPreflight()
    window.addEventListener('cex-sm:preflight', onPreflight)
    return () => window.removeEventListener('cex-sm:preflight', onPreflight)
  }, [runPreflight])

  return (
    <div className="space-y-3 rounded-xl border border-white/10 bg-[#0a0a0f] p-3">
      <p className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">
        Preflight · exits
      </p>

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
              min={0.2}
              step={0.1}
              value={exit.takeProfitPct}
              disabled={!exit.enabled}
              onChange={(e) =>
                setExit((p) => ({
                  ...p,
                  takeProfitPct: Number.parseFloat(e.target.value) || p.takeProfitPct,
                }))
              }
              onBlur={() => void saveExit({ takeProfitPct: exit.takeProfitPct })}
              className="mt-1 h-8 border-white/10 bg-black/40 font-mono text-xs"
            />
          </label>
          <label className="text-[10px] text-zinc-500">
            Stop loss %
            <Input
              type="number"
              min={0.2}
              step={0.1}
              value={exit.stopLossPct}
              disabled={!exit.enabled}
              onChange={(e) =>
                setExit((p) => ({
                  ...p,
                  stopLossPct: Number.parseFloat(e.target.value) || p.stopLossPct,
                }))
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
                value={exit.trailingActivationPct}
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
                value={exit.trailingDeltaPct}
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

      {preflight.length > 0 ? (
        <ul className="space-y-1 rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-2.5 py-2">
          {preflight.map((s) => (
            <li key={s} className="text-[10px] text-emerald-200/90">
              <span className="text-emerald-400">✓ </span>
              {s}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}
