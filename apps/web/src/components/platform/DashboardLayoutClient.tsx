'use client'

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import PlatformSidebar from '@/components/platform/PlatformSidebar'
import PlatformTopBar from '@/components/platform/PlatformTopBar'
import { FloatingCryptoCalculator } from '@/components/platform/FloatingCryptoCalculator'
import { ensureAuthSession } from '@/lib/api'

const NAV_COLLAPSED_KEY = 'gdsl_nav_collapsed'

export default function DashboardLayoutClient({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [mobileNavOpen, setMobileNavOpen] = useState(false)
  const [navCollapsed, setNavCollapsed] = useState(false)
  const isDexJupiter = (pathname ?? '').startsWith('/dex-jupiter')

  useEffect(() => {
    try {
      setNavCollapsed(localStorage.getItem(NAV_COLLAPSED_KEY) === '1')
    } catch {
      /* ignore */
    }
  }, [])

  const toggleNavCollapsed = () => {
    setNavCollapsed((prev) => {
      const next = !prev
      try {
        localStorage.setItem(NAV_COLLAPSED_KEY, next ? '1' : '0')
      } catch {
        /* ignore */
      }
      return next
    })
  }

  useEffect(() => {
    if (!mobileNavOpen) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = prev
    }
  }, [mobileNavOpen])

  useEffect(() => {
    if (!mobileNavOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMobileNavOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [mobileNavOpen])

  // Soft session keep-alive — uses /me when possible (no cookie rotation).
  // Aggressive focus refresh was racing multi-tab rotations and logging users out.
  useEffect(() => {
    const tick = () => {
      void ensureAuthSession()
    }
    const first = window.setTimeout(tick, 2_500)
    const id = window.setInterval(tick, 45 * 60_000)
    let lastFocus = 0
    const onFocus = () => {
      const now = Date.now()
      if (now - lastFocus < 5 * 60_000) return
      lastFocus = now
      void ensureAuthSession()
    }
    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') onFocus()
    })
    return () => {
      window.clearTimeout(first)
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return (
    <div className="min-h-screen overflow-x-hidden bg-[#050508] text-white">
      <PlatformSidebar
        mobileOpen={mobileNavOpen}
        onClose={() => setMobileNavOpen(false)}
        desktopCollapsed={navCollapsed}
      />
      {mobileNavOpen ? (
        <button
          type="button"
          className="fixed inset-0 z-30 bg-black/65 backdrop-blur-[2px] lg:hidden touch-manipulation"
          aria-label="Close navigation menu"
          onClick={() => setMobileNavOpen(false)}
        />
      ) : null}
      <div
        className={`min-h-screen border-l border-white/10 transition-[margin] duration-200 ${
          navCollapsed ? 'lg:ml-0' : 'lg:ml-64'
        }`}
      >
        <PlatformTopBar
          onMenuClick={() => setMobileNavOpen(true)}
          onToggleNav={toggleNavCollapsed}
          navCollapsed={navCollapsed}
        />
        <main
          className={
            isDexJupiter
              ? 'w-full px-2 pb-2 pt-1 sm:px-3'
              : 'mx-auto w-full max-w-6xl px-4 pb-10 pt-2 sm:px-5 md:px-6 lg:pl-6'
          }
        >
          {children}
        </main>
        {!isDexJupiter ? <FloatingCryptoCalculator /> : null}
      </div>
    </div>
  )
}
