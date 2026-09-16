'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardFooter, CardHeader } from '@/components/ui/card'
import { auth } from '@/lib/api'
import { BrandMark } from '@/components/platform/BrandMark'

export default function LoginPage() {
  const router = useRouter()
  const [identifier, setIdentifier] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null)

  // Best-effort: ask the API whether public signup is enabled so we can show
  // or hide the "No account? Register" link. Silently no-op if it fails.
  useEffect(() => {
    let cancelled = false
    auth
      .config()
      .then((c) => {
        if (!cancelled) setRegistrationOpen(Boolean(c.registrationOpen))
      })
      .catch(() => {
        if (!cancelled) setRegistrationOpen(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    const normalizedIdentifier = identifier.trim().toLowerCase()
    if (!normalizedIdentifier || !password) {
      setError('Enter both your username (or email) and password.')
      return
    }
    setLoading(true)

    try {
      await auth.login(normalizedIdentifier, password)
      // Tokens set via HttpOnly cookies by the server
      router.push('/dashboard')
    } catch (err: unknown) {
      const e = err as {
        response?: {
          status?: number
          data?: { error?: string; requiresVerification?: boolean; email?: string }
        }
      }
      if (e.response?.data?.requiresVerification) {
        // Password was correct but email isn't verified yet — bounce to the OTP page.
        const target = encodeURIComponent(e.response.data.email || normalizedIdentifier)
        router.push(`/verify-email?email=${target}`)
        return
      }
      setError(e.response?.data?.error || 'Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen gdsl-grid-bg flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md pb-panel border-emerald-500/25">
        <CardHeader className="text-center space-y-3">
          <p className="text-[10px] font-mono text-emerald-500/90 tracking-widest">// SECURE LOGIN</p>
          <BrandMark className="justify-center text-2xl" />
        </CardHeader>
        <form onSubmit={handleSubmit}>
          <CardContent className="space-y-4">
            {error && (
              <div className="p-3 rounded-lg bg-red-950/50 border border-red-500/30 text-red-300 text-xs font-mono">
                {error}
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="identifier" className="text-gray-500 font-mono text-xs">
                Username or Email
              </Label>
              <Input
                id="identifier"
                type="text"
                inputMode="email"
                placeholder="godsland100 or you@example.com"
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                autoComplete="username"
                spellCheck={false}
                autoCapitalize="off"
                className="pb-input font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="password" className="text-gray-500 font-mono text-xs">
                Password
              </Label>
              <Input
                id="password"
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                required
                autoComplete="current-password"
                className="pb-input font-mono text-sm"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button
              type="submit"
              disabled={loading || !identifier.trim() || !password}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-mono font-semibold"
            >
              {loading ? 'Signing in…' : 'Sign in →'}
            </Button>
            <p className="text-xs text-gray-600 font-mono text-center">
              {registrationOpen ? (
                <>
                  No account?{' '}
                  <Link href="/register" className="text-emerald-500 hover:text-emerald-400">
                    Register
                  </Link>
                  {' · '}
                </>
              ) : (
                <>Invite-only · </>
              )}
              <Link href="/" className="text-gray-500 hover:text-emerald-600">
                Home
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
