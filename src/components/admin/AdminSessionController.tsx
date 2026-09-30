'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import { usePathname } from 'next/navigation'
import { ap } from '@/lib/admin-path'
import { subscribeAdminEvents, reconnectAdminEvents } from '@/lib/client/admin-events-client'

const WARN_BEFORE_MS = 60_000
const HEARTBEAT_GAP_MS = 2 * 60_000
const URGENT_WINDOW_MS = 3 * 60_000
const RESYNC_GAP_MS = 5_000
const WAKE_CHECK_MS = 15_000
const WAKE_GAP_MS = 45_000
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'click', 'scroll', 'touchstart', 'wheel']
const CHANNEL = 'admin-session'
const BEAT_LOCK = 'admin-session-heartbeat'

type Sync = { deadlineAt: number; expiresAt: number; serverNow?: number }
type ChannelMsg =
  | { t: 'deadline'; deadlineAt: number; expiresAt: number; serverNow?: number }
  | { t: 'beat'; at: number }
  | { t: 'logout'; reason: string }

/**
 * The server owns the session clock; this tab only follows it. The deadline arrives with the
 * event stream (hello, deadline, logout frames), from heartbeats, and from check-session on
 * focus, wake and reconnect. Real interaction is reported as a heartbeat at most every two
 * minutes; idle tabs make no requests at all. Tabs of one browser share deadline, beats and
 * logout over a BroadcastChannel; other browsers and instances hear about them via the stream.
 */
export default function AdminSessionController() {
  const pathname = usePathname()
  const isLoginPage = pathname === ap('/admin/login') || pathname === '/login'
  const [modal, setModal] = useState<{ secondsLeft: number; absolute: boolean } | null>(null)

  const deadlineRef = useRef<number | null>(null)
  const expiresRef = useRef<number | null>(null)
  const skewRef = useRef(0)
  const dirtyRef = useRef(false)
  const lastBeatRef = useRef(0)
  const lastResyncRef = useRef(0)
  const loggedOutRef = useRef(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const bcRef = useRef<BroadcastChannel | null>(null)
  const inFlightRef = useRef(false)

  const now = () => Date.now() + skewRef.current
  const post = (msg: ChannelMsg) => {
    try {
      bcRef.current?.postMessage(msg)
    } catch {
      /* channel closed */
    }
  }

  const clearTimers = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (tickRef.current) {
      clearInterval(tickRef.current)
      tickRef.current = null
    }
  }

  const logout = useCallback(async (reason: string, notifyServer: boolean) => {
    if (loggedOutRef.current) return
    loggedOutRef.current = true
    clearTimers()
    setModal(null)
    post({ t: 'logout', reason })
    if (notifyServer) {
      try {
        await fetch(ap('/api/admin/logout'), { method: 'POST', credentials: 'include' })
      } catch {
        /* cookie also dies with the session */
      }
    }
    const onAdminSubdomain = /^admin(-[^.]+)?\./.test(window.location.host)
    window.location.href = onAdminSubdomain ? '/login' : ap('/admin/login')
  }, [])

  const heartbeat = useCallback(
    async (force = false) => {
      if (loggedOutRef.current || inFlightRef.current) return
      const t = Date.now()
      const deadline = deadlineRef.current
      const urgent = deadline != null && deadline - now() < URGENT_WINDOW_MS
      if (!force && (!dirtyRef.current || (t - lastBeatRef.current < HEARTBEAT_GAP_MS && !urgent))) return
      const run = async () => {
        inFlightRef.current = true
        try {
          const res = await fetch(ap('/api/admin/session/heartbeat'), {
            method: 'POST',
            credentials: 'include',
            cache: 'no-store',
          })
          if (res.status === 401) {
            await logout('expired', true)
            return
          }
          if (!res.ok) return
          const d = await res.json()
          dirtyRef.current = false
          lastBeatRef.current = Date.now()
          post({ t: 'beat', at: lastBeatRef.current })
          if (typeof d.deadlineAt === 'number')
            applyDeadline({ deadlineAt: d.deadlineAt, expiresAt: d.expiresAt, serverNow: d.serverNow }, true)
        } catch {
          /* retried on next activity */
        } finally {
          inFlightRef.current = false
        }
      }
      const locks = (navigator as any).locks
      if (locks?.request) {
        await locks.request(BEAT_LOCK, { ifAvailable: true }, async (lock: unknown) => {
          if (lock) await run()
        })
      } else {
        await run()
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [logout]
  )

  const resync = useCallback(
    async (force = false) => {
      if (loggedOutRef.current) return
      const t = Date.now()
      if (!force && t - lastResyncRef.current < RESYNC_GAP_MS) return
      lastResyncRef.current = t
      try {
        const res = await fetch(ap('/api/admin/check-session'), { cache: 'no-store', credentials: 'include' })
        if (!res.ok) return
        const d = await res.json()
        if (!d.authenticated || typeof d.deadlineAt !== 'number') {
          await logout('expired', true)
          return
        }
        applyDeadline({ deadlineAt: d.deadlineAt, expiresAt: d.expiresAt, serverNow: d.serverNow }, true)
      } catch {
        /* offline: keep the last known deadline */
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    },
    [logout]
  )

  function applyDeadline(s: Sync, broadcast: boolean) {
    if (typeof s.serverNow === 'number') skewRef.current = s.serverNow - Date.now()
    deadlineRef.current = s.deadlineAt
    expiresRef.current = s.expiresAt
    if (broadcast) post({ t: 'deadline', deadlineAt: s.deadlineAt, expiresAt: s.expiresAt, serverNow: s.serverNow })
    arm()
  }

  function arm() {
    clearTimers()
    const deadline = deadlineRef.current
    if (deadline == null || loggedOutRef.current) return
    const remaining = deadline - now()
    if (remaining <= 0) {
      void onDeadline()
      return
    }
    if (remaining > WARN_BEFORE_MS) {
      setModal(null)
      timerRef.current = setTimeout(arm, remaining - WARN_BEFORE_MS)
      return
    }
    if (dirtyRef.current) {
      void heartbeat(true)
    }
    const absolute = expiresRef.current != null && Math.abs(deadline - expiresRef.current) < 1000
    const tick = () => {
      const left = Math.ceil((deadline - now()) / 1000)
      if (left <= 0) {
        void onDeadline()
        return
      }
      setModal({ secondsLeft: left, absolute })
    }
    tick()
    tickRef.current = setInterval(tick, 1000)
  }

  async function onDeadline() {
    clearTimers()
    if (loggedOutRef.current) return
    // Another browser may have touched the session since we last heard; the server decides.
    try {
      const res = await fetch(ap('/api/admin/check-session'), { cache: 'no-store', credentials: 'include' })
      const d = res.ok ? await res.json() : null
      if (d?.authenticated && typeof d.deadlineAt === 'number' && d.deadlineAt - (d.serverNow ?? Date.now()) > 2000) {
        applyDeadline({ deadlineAt: d.deadlineAt, expiresAt: d.expiresAt, serverNow: d.serverNow }, true)
        return
      }
    } catch {
      /* offline: the server refuses everything past the deadline anyway */
    }
    await logout('idle', true)
  }

  useEffect(() => {
    if (isLoginPage) return
    loggedOutRef.current = false

    try {
      bcRef.current = new BroadcastChannel(CHANNEL)
    } catch {
      bcRef.current = null
    }
    if (bcRef.current) {
      bcRef.current.onmessage = (e: MessageEvent<ChannelMsg>) => {
        const m = e.data
        if (!m) return
        if (m.t === 'logout') {
          void logout(m.reason, false)
          return
        }
        if (m.t === 'beat') {
          lastBeatRef.current = m.at
          dirtyRef.current = false
          return
        }
        if (m.t === 'deadline')
          applyDeadline({ deadlineAt: m.deadlineAt, expiresAt: m.expiresAt, serverNow: m.serverNow }, false)
      }
    }

    let lastActivity = 0
    const onActivity = () => {
      const t = Date.now()
      if (t - lastActivity < 1000) return
      lastActivity = t
      dirtyRef.current = true
      void heartbeat(modal != null)
    }
    ACTIVITY_EVENTS.forEach(e => window.addEventListener(e, onActivity, { passive: true }))

    const onResume = () => {
      if (document.visibilityState === 'hidden') return
      reconnectAdminEvents()
      void resync()
    }
    document.addEventListener('visibilitychange', onResume)
    window.addEventListener('focus', onResume)
    window.addEventListener('online', onResume)
    window.addEventListener('pageshow', onResume)

    let lastWall = Date.now()
    const wake = setInterval(() => {
      const t = Date.now()
      if (t - lastWall > WAKE_GAP_MS) onResume()
      lastWall = t
    }, WAKE_CHECK_MS)

    const unsubscribe = subscribeAdminEvents(
      frame => {
        if (frame.kind !== 'session') return
        if (frame.type === 'logout') {
          void logout(frame.reason, false)
          return
        }
        applyDeadline({ deadlineAt: frame.deadlineAt, expiresAt: frame.expiresAt, serverNow: frame.serverNow }, true)
      },
      status => {
        if (status === 'error') void resync()
      }
    )

    void resync(true)

    return () => {
      clearTimers()
      clearInterval(wake)
      unsubscribe()
      ACTIVITY_EVENTS.forEach(e => window.removeEventListener(e, onActivity))
      document.removeEventListener('visibilitychange', onResume)
      window.removeEventListener('focus', onResume)
      window.removeEventListener('online', onResume)
      window.removeEventListener('pageshow', onResume)
      bcRef.current?.close()
      bcRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoginPage, pathname])

  const handleContinue = async () => {
    dirtyRef.current = true
    if (modal?.absolute) {
      try {
        const res = await fetch(ap('/api/admin/refresh'), { method: 'POST', credentials: 'include' })
        if (!res.ok) {
          await logout('expired', true)
          return
        }
      } catch {
        await logout('expired', true)
        return
      }
      await resync(true)
      return
    }
    await heartbeat(true)
  }

  if (isLoginPage || !modal) return null

  const mm = String(Math.floor(modal.secondsLeft / 60)).padStart(2, '0')
  const ss = String(modal.secondsLeft % 60).padStart(2, '0')

  return (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center backdrop-blur-sm bg-black/60">
      <div className="bg-surface rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-6 flex flex-col items-center gap-4">
        <div className="w-12 h-12 rounded-full bg-yellow-100 dark:bg-yellow-900/30 flex items-center justify-center">
          <svg
            className="w-6 h-6 text-yellow-600 dark:text-yellow-400"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"
            />
          </svg>
        </div>
        <div className="text-center">
          <h2 className="text-base font-bold text-foreground">{modal.absolute ? 'Session Ending' : 'Still there?'}</h2>
          <p className="text-sm text-foreground-secondary mt-1">
            {modal.absolute
              ? 'Your sign-in has reached its maximum length. Continue to start a fresh session window, or you will be signed out.'
              : 'You have been inactive for a while. Continue working or you will be signed out on every device.'}
          </p>
        </div>
        <div className="text-3xl font-mono font-bold text-red-500 tabular-nums">
          {mm}:{ss}
        </div>
        <div className="flex gap-3 w-full">
          <button
            onClick={() => logout('logout', true)}
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
