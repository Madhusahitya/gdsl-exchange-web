'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { auth, invalidateAuthMeCache } from '@/lib/api'
import { BrandMark } from '@/components/platform/BrandMark'

const navItems = [
  { name: 'Back to Home', href: '/', icon: 'home' as const },
  { name: 'Dashboard', href: '/dashboard', icon: 'grid' as const },
  { name: 'Overview', href: '/overview', icon: 'coins' as const },
  { name: 'Binance', href: '/trading', icon: 'terminal' as const },
  // Hidden for now (routes still work if bookmarked) — frees space for Jupiter terminal.
  // { name: 'DEX Trading', href: '/dex', icon: 'dex' as const },
  // { name: 'DEX 1inch', href: '/dex-1inch', icon: 'swap' as const },
  { name: 'Solana', href: '/dex-jupiter', icon: 'swap' as const },
  { name: 'AI Agents', href: '/agents', icon: 'brain' as const },
  // { name: 'DEX Swap', href: '/dex-swap', icon: 'swap' as const },
  // { name: 'Token Trading', href: '/token-trading', icon: 'coins' as const },
  { name: 'Buy / Sell Fiat', href: '/onramp', icon: 'coins' as const },
  { name: 'Wallet', href: '/wallet', icon: 'wallet' as const },
  { name: 'Orders', href: '/orders', icon: 'orders' as const },
  { name: 'Inbox', href: '/inbox', icon: 'inbox' as const },
  { name: 'Performance', href: '/performance', icon: 'profit' as const },
  { name: 'Referral', href: '/referral', icon: 'gift' as const },
  { name: 'Settings', href: '/settings', icon: 'gear' as const },
]

function Icon({ name }: { name: (typeof navItems)[number]['icon'] }) {
  const cls = 'w-5 h-5 flex-shrink-0'
  switch (name) {
    case 'home':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 12l2-2m0 0l7-7 7 7M5 10v10a1 1 0 001 1h3m10-11l2 2m-2-2v10a1 1 0 01-1 1h-3m-6 0a1 1 0 001-1v-4a1 1 0 011-1h2a1 1 0 011 1v4a1 1 0 001 1m-6 0h6" />
        </svg>
      )
    case 'grid':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
        </svg>
      )
    case 'terminal':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 9l3 3-3 3m5 0h3M5 20h14a2 2 0 002-2V6a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
        </svg>
      )
    case 'wallet':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
        </svg>
      )
    case 'orders':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2" />
        </svg>
      )
    case 'profit':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
        </svg>
      )
    case 'brain':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9.75 3.104v5.714a2.25 2.25 0 01-.659 1.591L5 14.5M9.75 3.104c-.251.023-.501.05-.75.082m.75-.082a24.301 24.301 0 014.5 0m0 0v5.714c0 .597.237 1.17.659 1.591L19.8 15.3M14.25 3.104c.251.023.501.05.75.082M19.8 15.3l-1.57.393A9.065 9.065 0 0112 15a9.065 9.065 0 00-6.23-.693L5 14.5m14.8.8l1.402 1.402c1.232 1.232.65 3.318-1.067 3.611A48.309 48.309 0 0112 21c-2.773 0-5.491-.235-8.135-.687-1.718-.293-2.3-2.379-1.067-3.61L5 14.5" />
        </svg>
      )
    case 'gift':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v13m0-13V6a2 2 0 112 2h-2zm0 0V5.5A2.5 2.5 0 109.5 8H12zm-7 4h14M5 12a2 2 0 110-4h1.586a1 1 0 01.707.293l2.414 2.414a1 1 0 00.707.293H15" />
        </svg>
      )
    case 'gear':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
        </svg>
      )
    case 'inbox':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
        </svg>
      )
    case 'coins':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8c-1.657 0-3 .895-3 2s1.343 2 3 2 3 .895 3 2-1.343 2-3 2m0-8c1.11 0 2.08.402 2.599 1M12 8V7m0 1v8m0 0v1m0-1c-1.11 0-2.08-.402-2.599-1M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      )
    case 'swap':
      return (
        <svg className={cls} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M7 16V4m0 0L3 8m4-4l4 4m6 0v12m0 0l4-4m-4 4l-4-4" />
        </svg>
      )
    default:
      return null
  }
}

type PlatformSidebarProps = {
  /** When false on small screens, drawer is off-canvas; always visible on `lg+` unless collapsed. */
  mobileOpen?: boolean
  /** Called after navigating (closes mobile drawer). */
  onClose?: () => void
  /** Desktop: hide the full nav rail so trading screens get full width. */
  desktopCollapsed?: boolean
}

export default function PlatformSidebar({
  mobileOpen = false,
  onClose,
  desktopCollapsed = false,
}: PlatformSidebarProps) {
  const pathname = usePathname()
  const [email, setEmail] = useState<string | null>(null)

  useEffect(() => {
    auth.me().then((u) => setEmail(u.email)).catch(() => setEmail(null))
  }, [])

  const logout = async () => {
    invalidateAuthMeCache()
    localStorage.removeItem('token')
    localStorage.removeItem('refreshToken')
    try {
      await auth.logout()
    } catch {
      // fall through to login redirect
    }
    window.location.href = '/login'
  }

  const navAfterClick = () => {
    onClose?.()
  }

  return (
    <aside
      className={`fixed left-0 top-0 z-40 flex h-[100dvh] w-[min(18rem,85vw)] flex-col border-r border-white/10 bg-[#050508] transition-transform duration-200 ease-out sm:w-64 ${
        mobileOpen ? 'translate-x-0' : '-translate-x-full'
      } ${desktopCollapsed ? 'lg:-translate-x-full' : 'lg:translate-x-0'}`}
    >
      <div className="border-b border-white/10 p-4 sm:p-5">
        <div className="flex items-center justify-between gap-2 lg:hidden">
          <span className="text-xs font-medium uppercase tracking-wider text-zinc-500">Menu</span>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-zinc-400 hover:bg-white/10 hover:text-white touch-manipulation"
            aria-label="Close menu"
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <Link href="/dashboard" className="mt-2 flex items-center gap-2 lg:mt-0" onClick={navAfterClick}>
          <span className="flex h-9 w-9 items-center justify-center rounded-lg bg-gradient-to-br from-emerald-400/30 to-emerald-600/10">
            <svg className="h-5 w-5 text-emerald-300" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7h8m0 0v8m0-8l-8 8-4-4-6 6" />
            </svg>
          </span>
          <BrandMark />
        </Link>
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
        {navItems.map((item) => {
          const active = item.href === '/' ? pathname === '/' : pathname === item.href || pathname.startsWith(`${item.href}/`)
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={navAfterClick}
              className={`flex min-h-[44px] items-center gap-3 rounded-xl px-3 py-2.5 text-sm transition-colors touch-manipulation ${
                active
                  ? 'bg-white/10 text-white shadow-sm ring-1 ring-emerald-500/30'
                  : 'text-zinc-400 hover:bg-white/5 hover:text-zinc-200'
              }`}
            >
              <Icon name={item.icon} />
              {item.name}
            </Link>
          )
        })}
      </nav>

      <div className="border-t border-white/10 p-4">
        {email ? (
          <div className="flex items-center justify-between gap-2">
            <div className="min-w-0 flex-1">
              <p className="truncate text-xs text-zinc-400">{email}</p>
            </div>
            <button
              type="button"
              onClick={() => { void logout() }}
              className="rounded-lg p-2 text-zinc-500 hover:bg-white/5 hover:text-white"
              title="Sign out"
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        ) : (
          <Link href="/login" className="text-xs text-emerald-400/90 hover:underline" onClick={navAfterClick}>
            Sign in
          </Link>
        )}
      </div>
    </aside>
  )
}
