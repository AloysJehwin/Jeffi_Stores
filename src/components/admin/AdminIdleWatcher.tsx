'use client'

import { useEffect, useRef } from 'react'

// Client half of admin idle-logout. The server (resolveSession) is the real gate — a session idle
// past the window is refused on the next request even after the browser was closed. This watcher
// only makes an OPEN tab bounce itself to login at the deadline instead of sitting on a stale page.
// It fetches the admin's own idle window, tracks activity, and on timeout clears the cookie + goes
// to the login page.
export default function AdminIdleWatcher({ host }: { host: string }) {
  const deadlineRef = useRef<number>(0)
  const idleMsRef = useRef<number>(0)

  useEffect(() => {
    let cancelled = false
    let timer: ReturnType<typeof setTimeout> | null = null

    const loginUrl = () => {
      // Mirror the admin login path resolution used elsewhere: on an admin subdomain the panel is
      // at /login, otherwise /admin/login.
      const onAdminSubdomain = /^admin(-[^.]+)?\./.test(window.location.host)
      return onAdminSubdomain ? '/login' : '/admin/login'
    }

    async function logout() {
      if (cancelled) return
      try { await fetch('/api/admin/logout', { method: 'POST', credentials: 'include' }) } catch { /* ignore */ }
      window.location.href = loginUrl()
    }

    function arm() {
      if (timer) clearTimeout(timer)
      const ms = Math.max(0, deadlineRef.current - Date.now())
      timer = setTimeout(logout, ms)
    }

    function bump() {
      if (!idleMsRef.current) return
      deadlineRef.current = Date.now() + idleMsRef.current
      arm()
    }

    // A tab that was backgrounded past the deadline must log out the moment it is seen again,
    // without waiting for the (already-fired-or-not) timer.
    function onVisible() {
      if (document.visibilityState === 'visible' && idleMsRef.current && Date.now() >= deadlineRef.current) {
        logout()
      }
    }

    const activity = ['mousemove', 'keydown', 'click', 'scroll', 'touchstart']
    let lastBump = 0
    const onActivity = () => {
      const now = Date.now()
      if (now - lastBump < 30_000) return // throttle: at most one reset per 30s
      lastBump = now
      bump()
    }

    fetch('/api/admin/idle-config', { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(d => {
        if (cancelled || !d || typeof d.idleMinutes !== 'number') return
        idleMsRef.current = d.idleMinutes * 60_000
        deadlineRef.current = Date.now() + idleMsRef.current
        arm()
        activity.forEach(e => window.addEventListener(e, onActivity, { passive: true }))
        document.addEventListener('visibilitychange', onVisible)
      })
      .catch(() => {})

    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
      activity.forEach(e => window.removeEventListener(e, onActivity))
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [host])

  return null
}
