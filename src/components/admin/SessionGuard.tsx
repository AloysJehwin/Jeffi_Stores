'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { ap } from '@/lib/admin-path'

// How often to poll the server for the real expiry time (ms)
const POLL_INTERVAL_MS = 15_000
// Show modal this many seconds before expiry
const WARN_BEFORE_S = 20

export default function SessionGuard() {
  const pathname = usePathname()
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null)
  const [showModal, setShowModal] = useState(false)

  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const expiresAtRef = useRef<number | null>(null)
  const loggedOutRef = useRef(false)

  // Don't run on the login page
  const isLoginPage = pathname === ap('/admin/login')

  const clearTimers = () => {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
  }

  const logout = useCallback(async () => {
    if (loggedOutRef.current) return
    loggedOutRef.current = true
    clearTimers()
    setShowModal(false)
    try { await fetch('/api/admin/logout', { method: 'POST' }) } catch {}
    // Hard reload — forces server layout to re-evaluate with cleared cookie
    window.location.href = ap('/admin/login')
  }, [])

  const startTicker = useCallback(() => {
    if (tickRef.current) clearInterval(tickRef.current)
    tickRef.current = setInterval(() => {
      const exp = expiresAtRef.current
      if (!exp) return
      const sLeft = Math.floor((exp - Date.now()) / 1000)
      if (sLeft <= 0) {
        clearInterval(tickRef.current!)
        tickRef.current = null
        setSecondsLeft(0)
        logout()
      } else {
        setSecondsLeft(sLeft)
      }
    }, 1_000)
  }, [logout])

  const pollSession = useCallback(async () => {
    if (loggedOutRef.current) return
    try {
      const res = await fetch('/api/admin/check-session', { cache: 'no-store' })
      const data = await res.json()

      if (!data.authenticated || !data.expiresAt) {
        expiresAtRef.current = null
        setShowModal(true)
        setSecondsLeft(0)
        logout()
        return
      }

      expiresAtRef.current = data.expiresAt
      const sLeft = Math.floor((data.expiresAt - Date.now()) / 1000)

      if (sLeft <= 0) {
        logout()
        return
      }

      if (sLeft <= WARN_BEFORE_S) {
        setSecondsLeft(sLeft)
        setShowModal(true)
        startTicker()
      } else {
        // Not near expiry — hide modal if it was showing (e.g. after refresh)
        setShowModal(false)
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null }
      }
    } catch {}
  }, [logout, startTicker])

  // Reset everything when page changes (fixes modal showing on login page)
  useEffect(() => {
    loggedOutRef.current = false
    setShowModal(false)
    setSecondsLeft(null)
    clearTimers()

    if (isLoginPage) return

    // Initial poll immediately, then on interval
    pollSession()
    pollRef.current = setInterval(pollSession, POLL_INTERVAL_MS)

    return clearTimers
  }, [pathname, isLoginPage, pollSession])

  const handleContinue = async () => {
    try {
      const res = await fetch('/api/admin/refresh', { method: 'POST' })
      if (res.ok) {
        // Poll immediately to get new expiresAt
        await pollSession()
      } else {
        logout()
      }
    } catch {
      logout()
    }
  }

  if (!showModal || secondsLeft === null) return null

  const mm = String(Math.floor(secondsLeft / 60)).padStart(2, '0')
  const ss = String(secondsLeft % 60).padStart(2, '0')

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/60">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
          <svg className="w-6 h-6 text-yellow-600 dark:text-yellow-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        </div>
        <div className="text-center">
          <h2 className="text-base font-bold text-foreground">Session Expiring</h2>
          <p className="text-sm text-foreground-secondary mt-1">Your session is about to expire. Continue working or you will be logged out.</p>
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

