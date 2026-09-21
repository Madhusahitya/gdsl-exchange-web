'use client'

import Link from 'next/link'
import { BrandMark } from '@/components/platform/BrandMark'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { auth, invalidateAuthMeCache } from '@/lib/api'

const navItems = [
  {
    name: 'Dashboard',
    href: '/dashboard',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2V6zM14 6a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2V6zM4 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2H6a2 2 0 01-2-2v-2zM14 16a2 2 0 012-2h2a2 2 0 012 2v2a2 2 0 01-2 2h-2a2 2 0 01-2-2v-2z" />
      </svg>
    ),
  },
  {
    name: 'History',
    href: '/history',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
      </svg>
    ),
  },
  {
    name: 'Analytics',
    href: '/analytics',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3 3v18h18M9 17V9m4 8V5m4 12v-6" />
      </svg>
    ),
  },
  {
    name: 'Performance',
    href: '/performance',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
      </svg>
    ),
  },
  {
    name: 'Wallet',
    href: '/wallet',
    icon: (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 9V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2h14a2 2 0 002-2v-6a2 2 0 00-2-2h-4z" />
      </svg>
    ),
  },
]

export default function Sidebar() {
  const pathname = usePathname()
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [scan, setScan] = useState(2900)

  useEffect(() => {
    const fetchUser = async () => {
      try {
        const user = await auth.me()
        setUserEmail(user.email)
      } catch {
        setUserEmail(null)
      }
    }
    fetchUser()
  }, [])

  useEffect(() => {
    const id = window.setInterval(() => {
      setScan((n) => n + Math.floor(Math.random() * 2) + 1)
    }, 5000)
    return () => clearInterval(id)
  }, [])

  const handleLogout = async () => {
    try {
      invalidateAuthMeCache()
      localStorage.removeItem('token')
      localStorage.removeItem('refreshToken')
      await auth.logout()
    } catch {
      /* ignore */
    }
    window.location.href = '/login'
  }

  return (
    <aside className="fixed left-0 top-0 h-screen w-64 border-r border-emerald-500/20 bg-[#030705] flex flex-col z-30">
      <div className="p-5 border-b border-emerald-500/15">
        <Link href="/dashboard" className="block">
          <BrandMark />
          <p className="text-[10px] font-mono text-emerald-600/90 mt-2 flex items-center gap-2">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            SCAN #{scan.toLocaleString()}
          </p>
        </Link>
      </div>

      <nav className="flex-1 p-3">
        <ul className="space-y-1 font-mono text-sm">
          {navItems.map((item) => {
            const isActive = pathname === item.href
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  className={`flex items-center gap-3 px-3 py-2.5 rounded-lg transition-colors ${
                    isActive
                      ? 'bg-emerald-500/15 text-emerald-300 border border-emerald-500/30'
                      : 'text-gray-500 hover:bg-emerald-500/5 hover:text-emerald-200/90 border border-transparent'
                  }`}
                >
                  {item.icon}
                  <span>{item.name}</span>
                </Link>
              </li>
            )
          })}
        </ul>
        <div className="mt-6 px-3">
          <Link
            href="/login"
            className="text-xs font-mono text-gray-600 hover:text-emerald-500/90 transition-colors"
          >
            {userEmail ? '// account linked' : '// sign in (optional)'}
          </Link>
        </div>
      </nav>

      <div className="p-4 border-t border-emerald-500/15">
        {userEmail ? (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-8 h-8 rounded-md bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center flex-shrink-0 font-mono text-xs text-emerald-400">
                {userEmail.charAt(0).toUpperCase()}
              </div>
              <span className="text-xs font-mono text-gray-500 truncate">{userEmail}</span>
            </div>
            <button
              onClick={() => { void handleLogout() }}
              className="p-2 text-gray-600 hover:text-emerald-400 transition-colors flex-shrink-0"
              title="Logout"
              type="button"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        ) : (
          <p className="text-[10px] font-mono text-gray-600 leading-relaxed">
            Non-custodial DEX. Connect wallet in the terminal — no exchange API keys required.
          </p>
        )}
      </div>
    </aside>
  )
}
