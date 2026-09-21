'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { toast } from 'sonner'
import {
  dexJupiter,
  type JupiterSuperMachineSettings,
  type JupiterSuperMachineStatus,
  type SuperMachineActivity,
} from '@/lib/api'
import { useSocket } from '@/hooks/useSocket'
import { cn } from '@/lib/utils'
import { MaxTradeSelect } from '@/components/trading/MaxTradeSelect'
/**
 * Preset strategies tuned for Jupiter momentum trading. Each maps to the
 * server-side risk parameters — the multi-agent engine (Oracle news, Quant
 * book, Risk fusion) applies its own gates on top of these.
 */
const STRATEGIES = {
  momentum: {
    label: 'Momentum Scalper',
    desc: 'Fast entries on rising tokens · small size · quick turnover',
    settings: {
      minSignal: 'rising' as const,
      maxTradeUsd: 15,
      maxDailyTrades: 30,
      maxDailyVolumeUsd: 500,
      minLiquidityUsd: 150_000,
      maxOpenPositions: 3,
    },
  },
  trend: {
    label: 'Trend Rider',
    desc: 'Strong signals only · ride confirmed momentum · balanced risk',
    settings: {
      minSignal: 'strong' as const,
      maxTradeUsd: 15,
      maxDailyTrades: 12,
      maxDailyVolumeUsd: 400,
      minLiquidityUsd: 250_000,
      maxOpenPositions: 1,
    },
  },
  safe: {
    label: 'Safe Accumulator',
    desc: 'High-liquidity tokens only · conservative sizing · max protection',
    settings: {
      minSignal: 'rising' as const,
      maxTradeUsd: 10,
      maxDailyTrades: 12,
      maxDailyVolumeUsd: 200,
      minLiquidityUsd: 250_000,
      maxOpenPositions: 3,
    },
  },
} as const

type StrategyKey = keyof typeof STRATEGIES

function detectStrategy(s: JupiterSuperMachineSettings): StrategyKey | 'custom' {
  for (const [key, def] of Object.entries(STRATEGIES) as [StrategyKey, (typeof STRATEGIES)[StrategyKey]][]) {
    const d = def.settings
    if (
      s.minSignal === d.minSignal &&
      s.maxTradeUsd === d.maxTradeUsd &&
      s.maxDailyTrades === d.maxDailyTrades &&
      s.minLiquidityUsd === d.minLiquidityUsd &&
      s.maxOpenPositions === d.maxOpenPositions
    ) {
      return key
    }
  }
  return 'custom'
}

const TERMINAL_COLORS: Record<SuperMachineActivity['type'], string> = {
  scan: 'text-zinc-500',
  signal: 'text-violet-300',
  trade: 'text-emerald-300',
  skip: 'text-amber-300/80',
  error: 'text-red-400',
  profit: 'text-cyan-300',
  exit: 'text-sky-300',
}

function terminalTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('en-GB', {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  })
}

export type PreflightStep = {
  id: string
  field: 'watchSymbol' | 'strategy' | 'maxTradeUsd' | 'minSignal' | 'slippagePct' | 'pair'
  value: string | number
  label: string
  reason: string
  delayMs?: number
}

const SCAN_MODE_LS = 'jupiter_sm_scan_mode'
/** Survives Solana tab unmount so the toggle does not flash OFF while settings refetch. */
const ENABLED_LS = 'jupiter_sm_enabled'

function readCachedEnabled(): boolean {
  if (typeof window === 'undefined') return false
  return sessionStorage.getItem(ENABLED_LS) === 'true'
}

function writeCachedEnabled(enabled: boolean): void {
  if (typeof window === 'undefined') return
  sessionStorage.setItem(ENABLED_LS, enabled ? 'true' : 'false')
}

/** Zod on the API requires SYMBOLUSDT. Chart state may be "BTC" or "BTCUSDT". */
function toWatchSymbol(raw: string | null | undefined): string | null {
  if (!raw) return null
  const s = raw.toUpperCase().replace(/[^A-Z0-9]/g, '')
  if (s.length < 2) return null
  const withUsdt = s.endsWith('USDT') ? s : `${s}USDT`
  if (withUsdt.length < 6 || withUsdt.length > 32) return null
  return withUsdt
}

export function JupiterSuperMachinePanel({
  watchSymbol,
  onPreflightApply,
}: {
  watchSymbol?: string | null
  onPreflightApply?: (symbol: string, slippagePct: number) => void
}) {
  const [settings, setSettings] = useState<JupiterSuperMachineSettings>({
    enabled: readCachedEnabled(),
    maxTradeUsd: 25,
    maxOpenPositions: 3,
    maxDailyTrades: 20,
    maxDailyVolumeUsd: 500,
    minLiquidityUsd: 100_000,
    minSignal: 'rising',
    watchSymbol: null,
    emergencyStop: false,
  })
  const [hydrated, setHydrated] = useState(false)
  const [status, setStatus] = useState<JupiterSuperMachineStatus | null>(null)
  const [activity, setActivity] = useState<SuperMachineActivity[]>([])
  const [saving, setSaving] = useState(false)
  const [terminalOpen, setTerminalOpen] = useState(true)
  const [agentField, setAgentField] = useState<string | null>(null)
  const [agentLabel, setAgentLabel] = useState<string | null>(null)
  const [preflightRunning, setPreflightRunning] = useState(false)
  const [scanMode, setScanMode] = useState<'pair-lock' | 'auto-scan'>(() => {
    if (typeof window === 'undefined') return 'auto-scan'
    const saved = localStorage.getItem(SCAN_MODE_LS)
    return saved === 'pair-lock' || saved === 'auto-scan' ? saved : 'pair-lock'
  })
  const scanModeRef = useRef(scanMode)
  scanModeRef.current = scanMode
  const feedRef = useRef<HTMLDivElement>(null)
  const [agentCursor, setAgentCursor] = useState({ x: 12, y: 18, visible: false })
  const cursorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const pulseAgentCursor = useCallback(() => {
    setAgentCursor({
      x: 6 + Math.random() * 78,
      y: 8 + Math.random() * 72,
      visible: true,
    })
    if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current)
    cursorTimerRef.current = setTimeout(() => {
      setAgentCursor((c) => ({ ...c, visible: false }))
    }, 2000)
  }, [])

  const socket = useSocket()

  const refresh = useCallback(async () => {
    try {
      // Settings first so the toggle hydrates even if status is slow (it can take 10–20s).
      const s = await dexJupiter.superMachineSettings()
      setSettings(s)
      writeCachedEnabled(s.enabled)
      setHydrated(true)
    } catch {
      // still allow turning OFF from the cached toggle
    }
    try {
      const st = await dexJupiter.superMachineStatus()
      setStatus(st)
      if (Array.isArray(st.activity) && st.activity.length > 0) {
        setActivity((prev) => {
          const byId = new Map<string, SuperMachineActivity>()
          for (const e of st.activity) byId.set(e.id, e)
          for (const e of prev) {
            if (!byId.has(e.id)) byId.set(e.id, e)
          }
          return [...byId.values()].sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1))
        })
      }
    } catch {
      // transient — keep cached toggle + schedule one fast retry on remount
    }
  }, [])

  useEffect(() => {
    void refresh()
    const retry = window.setTimeout(() => void refresh(), 1500)
    const id = setInterval(() => void refresh(), 12_000)
    return () => {
      window.clearTimeout(retry)
      clearInterval(id)
    }
  }, [refresh])

  // Real-time: push agent activity straight into the terminal via Socket.IO.
  useEffect(() => {
    if (!socket) return
    const onActivity = (event: SuperMachineActivity) => {
      const isWork =
        event.type === 'scan' ||
        event.type === 'signal' ||
        event.type === 'trade' ||
        event.type === 'exit' ||
        event.type === 'profit' ||
        event.type === 'error'
      if (isWork) pulseAgentCursor()
      setActivity((prev) => {
        if (prev.some((e) => e.id === event.id)) return prev
        return [event, ...prev]
      })
    }
    const onSettings = (next: JupiterSuperMachineSettings) => {
      setSettings(next)
      writeCachedEnabled(next.enabled)
      setHydrated(true)
    }
    const onPreflight = async ({ steps }: { steps: PreflightStep[] }) => {
      setPreflightRunning(true)
      pulseAgentCursor()
      for (const step of steps) {
        await new Promise((r) => setTimeout(r, step.delayMs ?? 500))
        pulseAgentCursor()
        setAgentField(step.field)
        setAgentLabel(step.label)
        if ((step.field === 'pair' || step.field === 'watchSymbol') && typeof step.value === 'string') {
          if (scanModeRef.current === 'pair-lock') {
            onPreflightApply?.(step.value, 0.5)
          }
        }
        if (step.field === 'slippagePct' && typeof step.value === 'number') {
          const sym = steps.find((s) => s.field === 'pair')?.value
          if (typeof sym === 'string') onPreflightApply?.(sym, step.value)
        }
      }
      await new Promise((r) => setTimeout(r, 1500))
      setPreflightRunning(false)
      setAgentField(null)
      setAgentLabel(null)
      void refresh()
    }
    socket.on('super-machine:activity', onActivity)
    socket.on('super-machine:settings', onSettings)
    socket.on('super-machine:preflight', onPreflight)
    return () => {
      socket.off('super-machine:activity', onActivity)
      socket.off('super-machine:settings', onSettings)
      socket.off('super-machine:preflight', onPreflight)
      if (cursorTimerRef.current) clearTimeout(cursorTimerRef.current)
    }
  }, [socket, refresh, onPreflightApply, pulseAgentCursor])

  useEffect(() => {
    if (!settings.enabled) setAgentCursor((c) => ({ ...c, visible: false }))
  }, [settings.enabled])

  const normalizedWatch = watchSymbol ? watchSymbol.toUpperCase() : null

  const save = async (patch: Partial<JupiterSuperMachineSettings>) => {
    // Optimistic merge for UI only — PUT sends the patch alone so defaults
    // (enabled:false on remount) cannot wipe a running Super Machine.
    const prevEnabled = settings.enabled
    setSettings((cur) => ({ ...cur, ...patch }))
    if (patch.enabled !== undefined) writeCachedEnabled(Boolean(patch.enabled))
    setSaving(true)
    try {
      const saved = await dexJupiter.saveSuperMachineSettings(patch)
      setSettings(saved)
      writeCachedEnabled(saved.enabled)
      setHydrated(true)
      if (saved.enabled && !prevEnabled) {
        toast.success('Super Machine activated — agents scanning every 15s')
      } else if (!saved.enabled && prevEnabled) {
        toast.info('Super Machine stopped')
      }
      if (patch.enabled !== undefined) {
        void refresh()
      }
    } catch {
      toast.error('Failed to save settings')
      await refresh()
    } finally {
      setSaving(false)
    }
  }

  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem(SCAN_MODE_LS, scanMode)
    }
  }, [scanMode])

  useEffect(() => {
    const saved = typeof window !== 'undefined' ? localStorage.getItem(SCAN_MODE_LS) : null
    if (saved === 'auto-scan') return
    if (settings.watchSymbol) setScanMode('pair-lock')
  }, [settings.watchSymbol])

  // Pair lock only: sync chart selection → server. Wait until hydrated so we
  // never PUT with the pre-refresh default enabled:false.
  useEffect(() => {
    if (!hydrated) return
    if (scanMode !== 'pair-lock' || !normalizedWatch) return
    if (settings.watchSymbol === toWatchSymbol(normalizedWatch)) return
    void save({ watchSymbol: toWatchSymbol(normalizedWatch) })
    // Deliberately keyed on the chart selection only: including `save` or
    // `settings` would re-push the pair lock on every settings refresh.
  }, [hydrated, normalizedWatch, scanMode])

  const applyStrategy = (key: StrategyKey) => {
    const def = STRATEGIES[key]
    toast.success(`Strategy: ${def.label}`)
    const watch =
      scanMode === 'pair-lock' ? toWatchSymbol(normalizedWatch ?? settings.watchSymbol) : null
    void save({ ...def.settings, watchSymbol: watch })
  }

  const stats = status?.stats
  const winRate = stats && stats.totalTrades > 0 ? `${(stats.winRate * 100).toFixed(0)}%` : '—'
  const pnl = stats ? `${stats.totalPnlUsd >= 0 ? '+' : ''}$${stats.totalPnlUsd.toFixed(2)}` : '$0.00'
  const activeStrategy = detectStrategy(settings)
  /** Server truth when loaded; until then keep last session toggle so navigation does not look like OFF. */
  const toggleOn = hydrated ? settings.enabled : readCachedEnabled()

  return (
    <div
      className={cn(
        'relative flex min-h-0 flex-col rounded-lg border p-3',
        toggleOn ? 'border-violet-500/50 bg-violet-500/5' : 'border-zinc-700/50 bg-zinc-800/30',
      )}
    >
      {(toggleOn || preflightRunning) && agentCursor.visible ? (
        <span
          className="pointer-events-none absolute z-[1] h-1.5 w-1.5 rounded-full bg-violet-400/90 shadow-[0_0_6px_rgba(167,139,250,0.7)] transition-all duration-500 ease-out"
          style={{ left: `${agentCursor.x}%`, top: `${agentCursor.y}%` }}
          aria-hidden
        />
      ) : null}

      <div className="relative z-[2] min-h-0 flex-1 space-y-3 overflow-y-auto pr-0.5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div
            className={cn(
              'h-2 w-2 rounded-full',
              toggleOn && !settings.emergencyStop ? 'animate-pulse bg-violet-500' : 'bg-zinc-600',
            )}
          />
          <span className="text-sm font-medium text-zinc-100">Super Machine</span>
          {toggleOn && hydrated && (
            <span className="rounded bg-violet-500/20 px-1.5 py-0.5 text-[9px] text-violet-300">LIVE</span>
          )}
          {!hydrated ? (
            <span className="rounded bg-zinc-600/40 px-1.5 py-0.5 text-[9px] text-zinc-400">sync…</span>
          ) : null}
        </div>
        <label className="relative inline-flex cursor-pointer items-center">
          <input
            type="checkbox"
            className="peer sr-only"
            checked={toggleOn}
            disabled={settings.emergencyStop || saving}
            onChange={(e) => {
              const turningOn = e.target.checked
              if (!turningOn) {
                // Disable-only payload — never hitch watchSymbol, which can 400 the whole PUT.
                void save({ enabled: false })
                return
              }
              const lock = scanMode === 'pair-lock' ? toWatchSymbol(normalizedWatch ?? settings.watchSymbol) : null
              void save({
                enabled: true,
                watchSymbol: lock,
              })
            }}
          />
          <div className="peer h-5 w-9 rounded-full bg-zinc-700 after:absolute after:left-[2px] after:top-[2px] after:h-4 after:w-4 after:rounded-full after:bg-white after:transition-all after:content-[''] peer-checked:bg-violet-600 peer-checked:after:translate-x-full peer-checked:after:border-white peer-focus:outline-none"></div>
        </label>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Trading scope</span>
        </div>
        <div className="grid grid-cols-2 gap-1">
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setScanMode('pair-lock')
              void save({ watchSymbol: toWatchSymbol(normalizedWatch ?? settings.watchSymbol) })
            }}
            className={cn(
              'rounded border px-2 py-1.5 text-[9px] font-medium leading-tight transition-colors',
              scanMode === 'pair-lock'
                ? 'border-emerald-500/60 bg-emerald-500/15 text-emerald-200'
                : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-400 hover:border-zinc-500',
            )}
          >
            Pair lock
            {scanMode === 'pair-lock' && (normalizedWatch ?? settings.watchSymbol) ? (
              <span className="mt-0.5 block text-[8px] font-normal opacity-80">
                {(normalizedWatch ?? settings.watchSymbol ?? '').replace(/USDT$/i, '/USDT')}
              </span>
            ) : null}
          </button>
          <button
            type="button"
            disabled={saving}
            onClick={() => {
              setScanMode('auto-scan')
              void save({
                watchSymbol: null,
                maxOpenPositions: Math.max(settings.maxOpenPositions, 3),
              })
            }}
            className={cn(
              'rounded border px-2 py-1.5 text-[9px] font-medium leading-tight transition-colors',
              scanMode === 'auto-scan'
                ? 'border-violet-500/60 bg-violet-500/15 text-violet-200'
                : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-400 hover:border-zinc-500',
            )}
          >
            Auto scan
          </button>
        </div>
      </div>

      {preflightRunning && agentLabel ? (
        <p className="animate-pulse rounded border border-violet-400/40 bg-violet-500/15 px-2 py-1.5 font-mono text-[10px] text-violet-200">
          Agent setup: {agentField} → <span className="font-semibold text-white">{agentLabel}</span>
        </p>
      ) : null}

      {/* Strategy presets */}
      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <span className="text-[10px] uppercase tracking-wide text-zinc-500">Strategy</span>
          {activeStrategy === 'custom' && (
            <span className="rounded bg-zinc-700/50 px-1.5 py-0.5 text-[9px] text-zinc-400">Custom</span>
          )}
        </div>
        <div className="grid grid-cols-3 gap-1">
          {(Object.entries(STRATEGIES) as [StrategyKey, (typeof STRATEGIES)[StrategyKey]][]).map(([key, def]) => (
            <button
              key={key}
              type="button"
              disabled={saving}
              onClick={() => applyStrategy(key)}
              className={cn(
                'rounded border px-1 py-1.5 text-center text-[9px] font-medium leading-tight transition-colors',
                agentField === 'strategy' && activeStrategy === key && 'ring-2 ring-violet-400 ring-offset-1 ring-offset-[#0a0a0f] animate-pulse',
                activeStrategy === key
                  ? 'border-violet-500/60 bg-violet-500/15 text-violet-200'
                  : 'border-zinc-700/60 bg-zinc-800/40 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200',
              )}
            >
              {def.label}
            </button>
          ))}
        </div>
      </div>

      {/* Quick stats */}
      {settings.enabled && (
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded bg-zinc-800/50 px-2 py-1.5">
            <div className="text-zinc-500">Win Rate</div>
            <div className={cn('font-semibold', stats && stats.winRate >= 0.5 ? 'text-emerald-400' : 'text-zinc-300')}>
              {winRate}
            </div>
          </div>
          <div className="rounded bg-zinc-800/50 px-2 py-1.5">
            <div className="text-zinc-500">P&L</div>
            <div className={cn('font-semibold', stats && stats.totalPnlUsd >= 0 ? 'text-emerald-400' : 'text-red-400')}>
              {pnl}
            </div>
          </div>
          <div className="rounded bg-zinc-800/50 px-2 py-1.5">
            <div className="text-zinc-500">Today</div>
            <div className="font-semibold text-zinc-300">
              {status?.runtime.tradesToday ?? 0}/{settings.maxDailyTrades}
            </div>
          </div>
          <div className="rounded bg-zinc-800/50 px-2 py-1.5">
            <div className="text-zinc-500">Positions</div>
            <div className="font-semibold text-zinc-300">
              {status?.runtime.openPositions ?? 0}/{settings.maxOpenPositions}
            </div>
          </div>
          <div className="col-span-2 rounded bg-emerald-500/10 px-2 py-1.5">
            <div className="text-zinc-500">Skimmed to wallet (positions still open)</div>
            <div className={cn('font-semibold', (stats?.skimmedProfitUsd ?? 0) > 0 ? 'text-emerald-400' : 'text-zinc-400')}>
              {stats?.skimmedProfitUsd != null && stats.skimmedProfitUsd !== 0
                ? `+$${stats.skimmedProfitUsd.toFixed(2)} USDC`
                : '$0.00 · banks at +0.5%'}
            </div>
          </div>
        </div>
      )}

      {/* Compact settings */}
      <div className="space-y-2">
        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">Max trade</span>
          {scanMode === 'auto-scan' ? (
            <span className="font-mono text-[11px] text-violet-200">
              Auto · up to $
              {(status?.runtime.effectiveMaxTradeUsd ?? settings.maxTradeUsd).toFixed(0)}
              {status?.runtime.walletUsdc != null ? (
                <span className="ml-1 text-[9px] text-zinc-500">
                  ({status.runtime.walletUsdc.toFixed(0)} USDC)
                </span>
              ) : null}
            </span>
          ) : (
            <MaxTradeSelect
              value={settings.maxTradeUsd}
              onChange={(usd) => void save({ maxTradeUsd: usd })}
              min={5}
              max={100}
              disabled={saving}
              inputClassName={cn(agentField === 'maxTradeUsd' && 'ring-2 ring-violet-400 animate-pulse')}
            />
          )}
        </div>

        <div className="flex items-center justify-between text-[11px]">
          <span className="text-zinc-500">Signal</span>
          <select
            className={cn(
              'rounded border border-zinc-700 bg-zinc-800 px-2 py-1 text-[11px] text-zinc-200',
              agentField === 'minSignal' && 'ring-2 ring-violet-400 animate-pulse',
            )}
            value={settings.minSignal}
            onChange={(e) => void save({ minSignal: e.target.value as 'rising' | 'strong' })}
            disabled={saving}
          >
            <option value="rising">Rising+</option>
            <option value="strong">Strong only</option>
          </select>
        </div>
      </div>

      {/* Signal terminal — real-time agent feed */}
      <div className="overflow-hidden rounded-md border border-zinc-800 bg-black">
        <button
          type="button"
          onClick={() => setTerminalOpen((v) => !v)}
          className="flex w-full items-center justify-between border-b border-zinc-800/80 bg-zinc-900/80 px-2 py-1"
        >
          <span className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-wider text-zinc-500">
            <span className={cn('h-1.5 w-1.5 rounded-full', settings.enabled ? 'animate-pulse bg-emerald-500' : 'bg-zinc-700')} />
            signal terminal
          </span>
          <span className="text-[9px] text-zinc-600">{terminalOpen ? '▾' : '▸'}</span>
        </button>
        {terminalOpen && (
          <div ref={feedRef} className="max-h-36 space-y-0.5 overflow-y-auto p-2 font-mono text-[10px] leading-relaxed">
            {activity.length === 0 ? (
              <p className="text-zinc-600">
                {settings.enabled ? '> waiting for agent activity…' : '> enable Super Machine to start the feed'}
              </p>
            ) : (
              activity.map((e) => (
                <p key={e.id} className={cn('break-words', TERMINAL_COLORS[e.type] ?? 'text-zinc-400')}>
                  <span className="text-zinc-600">[{terminalTime(e.timestamp)}]</span> {e.message}
                </p>
              ))
            )}
          </div>
        )}
      </div>
      </div>

      <div className="relative z-[2] mt-2 shrink-0 space-y-2 border-t border-white/10 pt-2">
      {/* Emergency stop — always visible below scroll area */}
      {settings.enabled && (
        <button
          type="button"
          className={cn(
            'w-full rounded py-1.5 text-[11px] font-medium transition-colors',
            settings.emergencyStop
              ? 'border border-red-500/50 bg-red-500/20 text-red-300'
              : 'border border-zinc-700 bg-zinc-800 text-zinc-400 hover:border-red-500/30 hover:text-red-300',
          )}
          onClick={() => void save({ emergencyStop: !settings.emergencyStop })}
          disabled={saving}
        >
          {settings.emergencyStop ? 'Stopped — click to resume' : 'Emergency stop'}
        </button>
      )}

      {/* Agent status */}
      {settings.enabled && status?.agents && (
        <div className="flex flex-wrap gap-1">
          {Object.entries(status.agents).map(([id, agent]) => (
            <span
              key={id}
              className={cn(
                'rounded px-1.5 py-0.5 text-[9px]',
                agent.status === 'running' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-zinc-700/50 text-zinc-500',
              )}
            >
              {id}
            </span>
          ))}
        </div>
      )}
      </div>
    </div>
  )
}
