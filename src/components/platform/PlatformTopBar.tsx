'use client'

import { WalletActions } from './WalletActions'

type PlatformTopBarProps = {
  onMenuClick?: () => void
  onToggleNav?: () => void
  navCollapsed?: boolean
}

export default function PlatformTopBar({ onMenuClick, onToggleNav, navCollapsed }: PlatformTopBarProps) {
  return (
    <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-2 border-b border-white/10 bg-[#050508]/95 px-3 backdrop-blur-md sm:px-4">
      <div className="flex min-w-0 flex-1 items-center gap-1.5">
        <button
          type="button"
          className="-ml-0.5 shrink-0 rounded-lg p-2 text-zinc-300 hover:bg-white/10 hover:text-white lg:hidden touch-manipulation"
          aria-label="Open navigation menu"
          onClick={onMenuClick}
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>
        {onToggleNav ? (
          <button
            type="button"
            className="hidden shrink-0 rounded-lg border border-white/10 p-1.5 text-zinc-300 hover:bg-white/10 hover:text-white lg:inline-flex"
            aria-label={navCollapsed ? 'Show navigation' : 'Hide navigation'}
            title={navCollapsed ? 'Show menu' : 'Hide menu'}
            onClick={onToggleNav}
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {navCollapsed ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 19l-7-7 7-7m8 14l-7-7 7-7" />
              )}
            </svg>
          </button>
        ) : null}
      </div>
      <div className="shrink-0">
        <WalletActions />
      </div>
    </header>
  )
}
