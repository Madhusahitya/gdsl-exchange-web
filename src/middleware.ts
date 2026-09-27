import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'
import { AUTH_GUARD_ENABLED } from '@/lib/authGuard'

const PROTECTED_PREFIXES = [
  '/dashboard',
  '/overview',
  '/trading',
  '/dex',
  '/dex-swap',
  '/dex-1inch',
  '/dex-jupiter',
  '/token-trading',
  '/inbox',
  '/history',
  '/analytics',
  '/performance',
  '/withdraw',
  '/wallet',
  '/exchange',
  '/orders',
  '/profit',
  '/referral',
  '/settings',
]

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl
  const token = request.cookies.get('cf_token')?.value
  // Access JWT is short-lived. Refresh cookie lasts 7d — allow the page to
  // load so the client can silently refresh instead of kicking to /login.
  // Also accept readable cf_csrf as a session hint (set alongside auth cookies).
  const refresh = request.cookies.get('cf_refresh_token')?.value
  const csrf = request.cookies.get('cf_csrf')?.value
  const hasSession = Boolean(token || refresh || csrf)

  const needsAuth = PROTECTED_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`))
  if (AUTH_GUARD_ENABLED && needsAuth && !hasSession) {
    const login = new URL('/login', request.url)
    login.searchParams.set('next', pathname)
    return NextResponse.redirect(login)
  }

  if (AUTH_GUARD_ENABLED && (pathname === '/login' || pathname === '/register') && hasSession) {
    return NextResponse.redirect(new URL('/dashboard', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: [
    '/dashboard/:path*',
    '/overview/:path*',
    '/trading/:path*',
    '/dex',
    '/dex/:path*',
    '/dex-swap/:path*',
    '/dex-1inch/:path*',
    '/dex-jupiter/:path*',
    '/token-trading/:path*',
    '/inbox/:path*',
    '/history/:path*',
    '/analytics/:path*',
    '/performance/:path*',
    '/withdraw/:path*',
    '/wallet/:path*',
    '/exchange/:path*',
    '/orders/:path*',
    '/profit/:path*',
    '/referral/:path*',
    '/settings/:path*',
    '/login',
    '/register',
  ],
}
