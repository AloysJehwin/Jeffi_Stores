'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { useRouter } from 'next/navigation'

const CHECK_INTERVAL_MS = 5_000
const WARNING_COUNTDOWN_S = 5 * 60

export default function SessionGuard() {
  const router = useRouter()
  const [expired, setExpired] = useState(false)
  const [countdown, setCountdown] = useState(WARNING_COUNTDOWN_S)
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const checkRef = useRef<ReturnType<typeof setInterval> | null>(null)

  const logout = useCallback(() => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    if (checkRef.current) clearInterval(checkRef.current)
    router.push('/admin/login')
  }, [router])

  const startCountdown = useCallback(() => {
    setCountdown(WARNING_COUNTDOWN_S)
    countdownRef.current = setInterval(() => {
      setCountdown(prev => {
        if (prev <= 1) {
          clearInterval(countdownRef.current!)
          logout()
          return 0
        }
        return prev - 1
      })
    }, 1_000)
  }, [logout])

  const checkSession = useCallback(async () => {
    try {
      const res = await fetch('/api/admin/check-session', { cache: 'no-store' })
      const data = await res.json()
      if (!data.authenticated && !expired) {
        setExpired(true)
        if (checkRef.current) clearInterval(checkRef.current)
        startCountdown()
      }
    } catch {}
  }, [expired, startCountdown])

  useEffect(() => {
    checkRef.current = setInterval(checkSession, CHECK_INTERVAL_MS)
    return () => {
      if (checkRef.current) clearInterval(checkRef.current)
      if (countdownRef.current) clearInterval(countdownRef.current)
    }
  }, [checkSession])

  const handleContinue = async () => {
    if (countdownRef.current) clearInterval(countdownRef.current)
    try {
      const res = await fetch('/api/admin/refresh', { method: 'POST' })
      if (res.ok) {
        setExpired(false)
        setCountdown(WARNING_COUNTDOWN_S)
        checkRef.current = setInterval(checkSession, CHECK_INTERVAL_MS)
      } else {
        logout()
      }
    } catch {
      logout()
    }
  }

  if (!expired) return null

  const mm = String(Math.floor(countdown / 60)).padStart(2, '0')
  const ss = String(countdown % 60).padStart(2, '0')

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/60">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
          <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <div className="text-center">
          <h2 className="text-base font-bold text-foreground">Session Expired</h2>
          <p className="text-sm text-foreground-secondary mt-1">Your session has expired. Continue working or you will be logged out.</p>
        </div>
        <div className="text-3xl font-mono font-bold text-red-500 tabular-nums">{mm}:{ss}</div>
        <div className="flex gap-3 w-full">
          <button
            onClick={logout}
            className="flex-1 px-4 py-2 border border-border-default rounded-lg text-sm font-medium text-foreground-secondary hover:bg-surface-secondary transition-colors"
          >
            Log out
          </button>
          <button
            onClick={handleContinue}
            className="flex-1 px-4 py-2 bg-accent-500 hover:bg-accent-600 text-white rounded-lg text-sm font-bold transition-colors"
          >
            Continue working
          </button>
        </div>
      </div>
    </div>
  )
}
