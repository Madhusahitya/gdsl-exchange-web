'use client'

import { JupiterHoverTip } from '@/components/dex/JupiterHoverTip'

export type JupiterTradeMode = 'market' | 'limit' | 'recurring'

const MODES: { id: JupiterTradeMode; label: string; tip: string }[] = [
  {
    id: 'market',
    label: 'Market',
    tip: 'Buy or sell right now at the best Jupiter price available.',
  },
  {
    id: 'limit',
    label: 'Limit',
    tip: 'Set a target price — buy only when ask drops to it, or sell when bid rises to it.',
  },
  {
    id: 'recurring',
    label: 'Recurring',
    tip: 'Buy the same USD amount on a schedule — uses Autopilot + Council rules.',
  },
]

type Props = {
  mode: JupiterTradeMode
  onModeChange: (m: JupiterTradeMode) => void
}

export function JupiterTradeModeTabs({ mode, onModeChange }: Props) {
  return (
    <div className="flex gap-0.5 rounded-lg border border-white/10 bg-black/40 p-0.5">
      {MODES.map((m) => (
        <JupiterHoverTip
          key={m.id}
          label={m.label}
          tip={m.tip}
          active={mode === m.id}
          onClick={() => onModeChange(m.id)}
        />
      ))}
    </div>
  )
}
