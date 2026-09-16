/**
 * Resolve API origin so it matches the browser page hostname.
 * Login sets HttpOnly cookies on the API host; if the app is opened at 127.0.0.1:3000
 * but the client calls localhost:4000, cookies are stored for "localhost" and Next.js
 * middleware on 127.0.0.1 never receives cf_token — sign-in appears to "not work".
 */
export function getApiBaseUrl(): string {
  const fallback = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  if (typeof window === 'undefined') return fallback
  if (process.env.NEXT_PUBLIC_USE_API_PROXY === '1') {
    return ''
  }
  try {
    const u = new URL(fallback)
    const port = u.port || '8000'
    const h = window.location.hostname
    if (h === 'localhost' || h === '127.0.0.1') {
      return `${window.location.protocol}//${h}:${port}`
    }
    if (fallback.startsWith('http') && !fallback.includes('localhost')) {
      return fallback
    }
  } catch {
    /* ignore */
  }
  return fallback
}

/** Human-readable API target for error messages (never empty when proxy strips base URL). */
export function getApiOriginForErrors(): string {
  const fallback = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  if (typeof window === 'undefined') return fallback
  const b = getApiBaseUrl()
  if (b) return b
  return `${window.location.origin} (same origin; /api proxied to backend)`
}

/** Socket.IO expects http(s) URL; keep host aligned with getApiBaseUrl */
export function getSocketUrl(): string {
  const fallback = process.env.NEXT_PUBLIC_WS_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000'
  if (typeof window === 'undefined') return fallback
  if (process.env.NEXT_PUBLIC_USE_API_PROXY === '1') {
    return `${window.location.protocol}//${window.location.host}`
  }
  try {
    const u = new URL(fallback)
    const port = u.port || '8000'
    const h = window.location.hostname
    if (h === 'localhost' || h === '127.0.0.1') {
      return `${u.protocol}//${h}:${port}`
    }
    if (fallback.startsWith('http') && !fallback.includes('localhost')) {
      return fallback
    }
  } catch {
    /* ignore */
  }
  return fallback
}
