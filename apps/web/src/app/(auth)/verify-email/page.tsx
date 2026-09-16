'use client'

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card'
import { auth } from '@/lib/api'

const OTP_LENGTH = 6
const RESEND_COOLDOWN_SECONDS = 60

function VerifyEmailInner() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const emailFromQuery = (searchParams?.get('email') ?? '').trim().toLowerCase()
  const email = emailFromQuery

  const [digits, setDigits] = useState<string[]>(() => Array(OTP_LENGTH).fill(''))
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [resending, setResending] = useState(false)
  const [resendIn, setResendIn] = useState(0)
  const inputsRef = useRef<Array<HTMLInputElement | null>>([])
  const hasAutoSubmittedRef = useRef(false)

  const code = useMemo(() => digits.join(''), [digits])
  const codeComplete = code.length === OTP_LENGTH && /^\d{6}$/.test(code)

  useEffect(() => {
    if (resendIn <= 0) return
    const id = window.setInterval(() => setResendIn((s) => (s > 0 ? s - 1 : 0)), 1000)
    return () => window.clearInterval(id)
  }, [resendIn])

  // Initial focus + start the resend countdown (the API already sent a code on
  // register / forced-resend during login, so we honour the same 60 s cooldown).
  useEffect(() => {
    inputsRef.current[0]?.focus()
    setResendIn(RESEND_COOLDOWN_SECONDS)
  }, [])

  const handleVerify = useCallback(
    async (override?: string) => {
      const candidate = (override ?? code).trim()
      if (!email) {
        setError('No email provided — please register again.')
        return
      }
      if (!/^\d{6}$/.test(candidate)) {
        setError('Enter the 6-digit code from your email.')
        return
      }
      setError('')
      setSuccess('')
      setSubmitting(true)
      try {
        await auth.verifyEmail(email, candidate)
        setSuccess('Verified — taking you to your dashboard…')
        // Tiny pause so the success state is visible before the redirect.
        window.setTimeout(() => router.push('/dashboard'), 600)
      } catch (err: unknown) {
        const e = err as { response?: { data?: { error?: string; expired?: boolean } } }
        setError(e.response?.data?.error || 'Verification failed. Please try again.')
        // If the code was expired/locked, clear the inputs so the next code is easier to enter.
        if (e.response?.data?.expired) {
          setDigits(Array(OTP_LENGTH).fill(''))
          inputsRef.current[0]?.focus()
        }
        setSubmitting(false)
      }
    },
    [code, email, router],
  )

  // Auto-submit once a complete 6-digit code is entered/pasted (don't retry on error).
  useEffect(() => {
    if (codeComplete && !submitting && !hasAutoSubmittedRef.current) {
      hasAutoSubmittedRef.current = true
      void handleVerify(code)
    }
    if (!codeComplete) {
      hasAutoSubmittedRef.current = false
    }
  }, [codeComplete, submitting, code, handleVerify])

  const setDigit = (idx: number, value: string) => {
    const clean = value.replace(/\D/g, '').slice(0, 1)
    setDigits((prev) => {
      const next = [...prev]
      next[idx] = clean
      return next
    })
    if (clean && idx < OTP_LENGTH - 1) {
      inputsRef.current[idx + 1]?.focus()
    }
  }

  const handleKeyDown = (idx: number) => (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Backspace' && !digits[idx] && idx > 0) {
      inputsRef.current[idx - 1]?.focus()
      setDigits((prev) => {
        const next = [...prev]
        next[idx - 1] = ''
        return next
      })
      e.preventDefault()
      return
    }
    if (e.key === 'ArrowLeft' && idx > 0) {
      inputsRef.current[idx - 1]?.focus()
      e.preventDefault()
      return
    }
    if (e.key === 'ArrowRight' && idx < OTP_LENGTH - 1) {
      inputsRef.current[idx + 1]?.focus()
      e.preventDefault()
      return
    }
  }

  const handlePaste = (idx: number) => (e: React.ClipboardEvent<HTMLInputElement>) => {
    const text = e.clipboardData.getData('text').replace(/\D/g, '').slice(0, OTP_LENGTH - idx)
    if (!text) return
    e.preventDefault()
    setDigits((prev) => {
      const next = [...prev]
      for (let i = 0; i < text.length; i++) {
        next[idx + i] = text[i]
      }
      return next
    })
    const nextFocus = Math.min(idx + text.length, OTP_LENGTH - 1)
    inputsRef.current[nextFocus]?.focus()
  }

  const handleResend = async () => {
    if (!email || resendIn > 0 || resending) return
    setError('')
    setSuccess('')
    setResending(true)
    try {
      await auth.resendOtp(email)
      setSuccess('A fresh code is on its way — check your inbox.')
      setResendIn(RESEND_COOLDOWN_SECONDS)
      setDigits(Array(OTP_LENGTH).fill(''))
      hasAutoSubmittedRef.current = false
      inputsRef.current[0]?.focus()
    } catch (err: unknown) {
      const e = err as { response?: { data?: { error?: string; retryAfter?: number } } }
      if (e.response?.data?.retryAfter) {
        setResendIn(e.response.data.retryAfter)
      }
      setError(e.response?.data?.error || 'Could not resend the code. Please try again shortly.')
    } finally {
      setResending(false)
    }
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    void handleVerify()
  }

  return (
    <div className="min-h-screen gdsl-grid-bg flex items-center justify-center px-4 py-12">
      <Card className="w-full max-w-md pb-panel border-emerald-500/25">
        <CardHeader className="text-center space-y-3">
          <p className="text-[10px] font-mono text-emerald-500/90 tracking-widest">// VERIFY YOUR EMAIL</p>
          <CardTitle className="text-2xl font-bold text-white font-mono tracking-tight">Confirm it&apos;s you</CardTitle>
          <CardDescription className="text-gray-500 font-mono text-xs">
            We sent a 6-digit code to{' '}
            <span className="text-emerald-400 break-all">{email || 'your email'}</span>
            {'. '}Enter it below to finish creating your account.
          </CardDescription>
        </CardHeader>
        <form onSubmit={onSubmit}>
          <CardContent className="space-y-5">
            {error && (
              <div className="p-3 rounded-lg bg-red-950/50 border border-red-500/30 text-red-300 text-xs font-mono">
                {error}
              </div>
            )}
            {success && (
              <div className="p-3 rounded-lg bg-emerald-950/50 border border-emerald-500/30 text-emerald-300 text-xs font-mono">
                {success}
              </div>
            )}

            <div className="flex items-center justify-center gap-2">
              {digits.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    inputsRef.current[i] = el
                  }}
                  type="text"
                  inputMode="numeric"
                  autoComplete={i === 0 ? 'one-time-code' : 'off'}
                  pattern="\d*"
                  maxLength={1}
                  value={d}
                  disabled={submitting}
                  onChange={(e) => setDigit(i, e.target.value)}
                  onKeyDown={handleKeyDown(i)}
                  onPaste={handlePaste(i)}
                  className="w-11 h-13 sm:w-12 sm:h-14 text-center text-xl font-mono font-semibold rounded-lg bg-black/60 border border-emerald-500/25 text-emerald-300 focus:outline-none focus:border-emerald-400 focus:ring-2 focus:ring-emerald-500/30 disabled:opacity-60"
                  aria-label={`Digit ${i + 1}`}
                />
              ))}
            </div>

            <p className="text-center text-[11px] text-gray-600 font-mono">
              Didn&apos;t get it? Check your spam folder, or{' '}
              <button
                type="button"
                onClick={handleResend}
                disabled={resendIn > 0 || resending || !email}
                className="text-emerald-500 hover:text-emerald-400 disabled:text-gray-600 disabled:cursor-not-allowed"
              >
                {resending
                  ? 'sending…'
                  : resendIn > 0
                    ? `resend in ${resendIn}s`
                    : 'resend code'}
              </button>
              .
            </p>
          </CardContent>
          <CardFooter className="flex flex-col gap-4">
            <Button
              type="submit"
              disabled={submitting || !codeComplete}
              className="w-full bg-emerald-500 hover:bg-emerald-400 text-black font-mono font-semibold"
            >
              {submitting ? 'Verifying…' : 'Verify & continue →'}
            </Button>
            <p className="text-xs text-gray-600 font-mono text-center">
              Wrong email?{' '}
              <Link href="/register" className="text-emerald-500 hover:text-emerald-400">
                Start over
              </Link>
              {' · '}
              <Link href="/login" className="text-gray-500 hover:text-emerald-600">
                Sign in
              </Link>
            </p>
          </CardFooter>
        </form>
      </Card>
    </div>
  )
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={<div className="min-h-screen gdsl-grid-bg" />}>
      <VerifyEmailInner />
    </Suspense>
  )
}
