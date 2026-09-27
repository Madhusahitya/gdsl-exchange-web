import { io, Socket } from 'socket.io-client'
import { AUTH_GUARD_ENABLED } from '@/lib/authGuard'
import { getSocketUrl } from '@/lib/apiBaseUrl'

let socket: Socket | null = null

function getCookie(name: string): string | null {
  if (typeof window === 'undefined') return null
  const match = document.cookie
    .split('; ')
    .find((c) => c.startsWith(`${name}=`))
  return match?.split('=')[1] ?? null
}

export function connectSocket(): Socket {
  if (socket) {
    if (!socket.connected) socket.connect()
    return socket
  }

  const token = getCookie('cf_token')

  socket = io(getSocketUrl(), {
    auth: { token },
    transports: ['websocket', 'polling'],
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,
    reconnectionDelayMax: 10000,
    timeout: 10000,
    withCredentials: true,
  })

  socket.on('connect', () => {
    console.warn('[WS] Connected')
  })

  socket.on('disconnect', (reason) => {
    console.warn('[WS] Disconnected:', reason)
    // Never force /login from socket disconnect — HttpOnly cf_token is invisible
    // to document.cookie, and server restarts must not kick active sessions.
  })

  socket.on('reconnect_attempt', (attempt) => {
    console.warn(`[WS] Reconnect attempt ${attempt}`)
    const freshToken = getCookie('cf_token')
    socket!.auth = { token: freshToken }
  })

  socket.on('reconnect_failed', () => {
    console.error('[WS] All reconnect attempts failed')
  })

  socket.connect()
  return socket
}

export function disconnectSocket(): void {
  if (socket) {
    socket.disconnect()
  }
}

export function getSocket(): Socket | null {
  return socket
}
