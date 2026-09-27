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

export default function RegisterPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  // null = still loading, true = signups open, false = invite-only.
  const [registrationOpen, setRegistrationOpen] = useState<boolean | null>(null)

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

    const normalizedEmail = email.trim().toLowerCase()
    if (!normalizedEmail) {
      setError('Email is required')
      return
    }
    if (password !== confirmPassword) {
      setError('Passwords do not match')
      return
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters')
      return
    }
    if (!/[A-Z]/.test(password)) {
      setError('Password must contain at least one uppercase letter')
      return
    }
    if (!/[0-9]/.test(password)) {
      setError('Password must contain at least one number')
      return
    }

    setLoading(true)

    try {
      const data = (await auth.register(normalizedEmail, password)) as {
        requiresVerification?: boolean
        email?: string
      }
      const target = encodeURIComponent(data?.email || normalizedEmail)
      router.push(`/verify-email?email=${target}`)
      return
    } catch (err: unknown) {
      const e = err as {
        response?: { data?: { error?: string; requiresVerification?: boolean; email?: string } }
      }
      if (e.response?.data?.requiresVerification) {
        const target = encodeURIComponent(e.response.data.email || normalizedEmail)
        router.push(`/verify-email?email=${target}`)
        return
      }
      setError(e.response?.data?.error || 'Registration failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  // Invite-only branch — when the API tells us public signup is closed, we hide
  // the form entirely and present a contact-your-admin message. This keeps the
  // route accessible but makes the closed state obvious.
  if (registrationOpen === false) {
    return (
      <div className="min-h-screen gdsl-grid-bg flex items-center justify-center px-4 py-12">
        <Card className="w-full max-w-md pb-panel border-emerald-500/25">
          <CardHeader className="text-center space-y-3">
            <p className="text-[10px] font-mono text-emerald-500/90 tracking-widest">// INVITE ONLY</p>
            <BrandMark className="justify-center text-2xl" />
            <p className="text-gray-500 font-mono text-xs">Public signup is closed. Contact your administrator.</p>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="p-4 rounded-lg bg-emerald-950/30 border border-emerald-500/20 text-emerald-200/90 text-xs font-mono leading-relaxed">
              <span className="text-emerald-400">$</span> Already provisioned?
              <br />
              Use your assigned <span className="text-emerald-400">username</span> to sign in.
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            <Link href="/login" className="w-full">
              <Button className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-mono font-semibold">
                Go to sign in →
              </Button>
            </Link>
            <p className="text-xs text-gray-600 font-mono text-center">
              <Link href="/" className="text-gray-500 hover:text-emerald-600">
                Home
              </Link>
            </p>
          </CardFooter>
        </Card>
      </div>
    )
  }

  // Loading the config — render a minimal skeleton so we don't briefly flash
  // the form to invite-only users.
  if (registrationOpen === null) {
    return <div className="min-h-screen gdsl-grid-bg" />
  }

  return (
    <div className="min-h-screen gdsl-grid-bg flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md pb-panel border-emerald-500/25">
        <CardHeader className="text-center space-y-3">
          <p className="text-[10px] font-mono text-emerald-500/90 tracking-widest">// CREATE ACCOUNT</p>
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
              <Label htmlFor="email" className="text-gray-500 font-mono text-xs">
                Email
              </Label>
              <Input
                id="email"
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                required
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
                className="pb-input font-mono text-sm"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirmPassword" className="text-gray-500 font-mono text-xs">
                Confirm password
              </Label>
              <Input
                id="confirmPassword"
                type="password"
                placeholder="••••••••"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                required
                className="pb-input font-mono text-sm"
              />
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button
              type="submit"
              disabled={loading}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-mono font-semibold"
            >
              {loading ? 'Creating…' : 'Create account →'}
            </Button>
            <p className="text-xs text-gray-600 font-mono text-center">
              Have an account?{' '}
              <Link href="/login" className="text-emerald-500 hover:text-emerald-400">
                Sign in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}
