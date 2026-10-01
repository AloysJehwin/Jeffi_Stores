'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { createPortal } from 'react-dom'
import { ap } from '@/lib/shared/admin-path'
import { subscribeAdminEvents } from '@/lib/client/admin-events-client'

interface Notification {
  id: string
  type: string
  category: string
  title: string
  message: string | null
  link: string | null
  severity: 'info' | 'warning' | 'critical'
  is_read: boolean
  created_at: string
}

const SEVERITY_DOT: Record<string, string> = {
  info: 'bg-blue-500',
  warning: 'bg-amber-500',
  critical: 'bg-red-500',
}

function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  const diff = Date.now() - then
  const m = Math.round(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.round(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
}

export default function NotificationBell() {
  const [items, setItems] = useState<Notification[]>([])
  const [unread, setUnread] = useState(0)
  const [open, setOpen] = useState(false)
  const [pos, setPos] = useState<{ top: number; right: number; left?: number } | null>(null)
  const btnRef = useRef<HTMLButtonElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const seenRef = useRef<Set<string>>(new Set())
  const primedRef = useRef(false)

  const pushBrowser = useCallback((incoming: Notification[]) => {
    if (typeof window === 'undefined' || !('Notification' in window)) return

    const fresh = incoming.filter(n => !n.is_read && !seenRef.current.has(n.id))
    incoming.forEach(n => seenRef.current.add(n.id))

    // First payload only seeds the seen-set; never replay the backlog as OS toasts.
    if (!primedRef.current) {
      primedRef.current = true
      return
    }
    if (window.Notification.permission !== 'granted') return

    for (const n of fresh) {
      try {
        const native = new window.Notification(n.title, {
          body: n.message || undefined,
          tag: n.id,
        })
        if (n.link) {
          native.onclick = () => {
            window.focus()
            window.location.href = ap(n.link!)
            native.close()
          }
        }
      } catch {}
    }
  }, [])

  const apply = useCallback(
    (data: { items?: Notification[]; unreadCount?: number }) => {
      if (Array.isArray(data.items)) {
        pushBrowser(data.items)
        setItems(data.items)
      }
      if (typeof data.unreadCount === 'number') setUnread(data.unreadCount)
    },
    [pushBrowser]
  )

  const fetchOnce = useCallback(async () => {
    try {
      const res = await fetch(ap('/api/admin/notifications'))
      if (!res.ok) return
      apply(await res.json())
    } catch {}
  }, [apply])

  useEffect(() => {
    fetchOnce()

    if (typeof window !== 'undefined' && 'Notification' in window && window.Notification.permission === 'default') {
      window.Notification.requestPermission().catch(() => {})
    }

    let poll: ReturnType<typeof setInterval> | null = null
    const startPolling = () => {
      if (!poll) poll = setInterval(fetchOnce, 60000)
    }
    const stopPolling = () => {
      if (poll) {
        clearInterval(poll)
        poll = null
      }
    }

    const unsubscribe = subscribeAdminEvents(
      frame => {
        if (frame.kind === 'notifications') apply(frame)
      },
      status => {
        if (status === 'open') {
          stopPolling()
          fetchOnce()
        } else startPolling()
      }
    )

    return () => {
      unsubscribe()
      stopPolling()
    }
  }, [fetchOnce, apply])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node
      if (panelRef.current?.contains(t) || btnRef.current?.contains(t)) return
      setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  const toggle = () => {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect()
      // On narrow viewports pin the panel as a full-width sheet (left/right = 8) just below the
      // header so it never overflows off-screen or misaligns to the bell's corner. On wider
      // screens keep it anchored to the bell's right edge.
      const isMobile = window.innerWidth < 640
      setPos(
        isMobile
          ? { top: r.bottom + 8, right: 8, left: 8 }
          : { top: r.bottom + 8, right: Math.max(8, window.innerWidth - r.right) }
      )
    }
    setOpen(o => !o)
  }

  const markRead = useCallback(async (ids: string[]) => {
    if (!ids.length) return
    setItems(prev => prev.map(n => (ids.includes(n.id) ? { ...n, is_read: true } : n)))
    setUnread(prev => Math.max(0, prev - ids.length))
    try {
      await fetch(ap('/api/admin/notifications/read'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ids }),
      })
    } catch {}
  }, [])

  const markAll = useCallback(async () => {
    setItems(prev => prev.map(n => ({ ...n, is_read: true })))
    setUnread(0)
    try {
      await fetch(ap('/api/admin/notifications/read'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true }),
      })
    } catch {}
  }, [])

  const onRowClick = (n: Notification) => {
    if (!n.is_read) markRead([n.id])
    setOpen(false)
  }

  return (
    <>
      <button
        ref={btnRef}
        onClick={toggle}
        aria-label="Notifications"
        className="relative w-8 h-8 flex items-center justify-center rounded-full hover:bg-white/10 transition-colors"
      >
        <svg className="w-5 h-5 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2}
            d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.214 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9"
          />
        </svg>
        {unread > 0 && (
          <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 bg-red-500 text-white text-[10px] font-bold rounded-full flex items-center justify-center">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>

      {open &&
        pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <div
            ref={panelRef}
            style={{
              position: 'fixed',
              top: pos.top,
              right: pos.right,
              ...(pos.left != null ? { left: pos.left } : {}),
              zIndex: 10000,
              pointerEvents: 'auto',
            }}
            className="sm:w-[360px] w-auto max-w-[calc(100vw-16px)] bg-surface-elevated border border-border-default rounded-lg shadow-xl overflow-hidden"
          >
            <div className="flex items-center justify-between px-4 py-3 border-b border-border-default">
              <span className="text-sm font-bold text-foreground">Notifications</span>
              {unread > 0 && (
                <button
                  onClick={markAll}
                  className="text-xs font-medium text-blue-600 dark:text-blue-400 hover:underline"
                >
                  Mark all read
                </button>
              )}
            </div>

            <div className="max-h-[420px] overflow-y-auto">
              {items.length === 0 ? (
                <div className="px-4 py-10 text-center text-sm text-foreground-muted">You&apos;re all caught up.</div>
              ) : (
                items.map(n => {
                  const inner = (
                    <>
                      <span
                        className={`mt-1.5 w-2 h-2 rounded-full shrink-0 ${SEVERITY_DOT[n.severity] || SEVERITY_DOT.info}`}
                      />
                      <div className="min-w-0 flex-1">
                        <p
                          className={`text-sm truncate ${n.is_read ? 'text-foreground-muted' : 'font-semibold text-foreground'}`}
                        >
                          {n.title}
                        </p>
                        {n.message && <p className="text-xs text-foreground-muted truncate">{n.message}</p>}
                        <p className="text-[11px] text-foreground-muted mt-0.5">{relativeTime(n.created_at)}</p>
                      </div>
                      {!n.is_read && <span className="mt-1.5 w-2 h-2 rounded-full bg-blue-500 shrink-0" />}
                    </>
                  )
                  const cls = `flex items-start gap-3 px-4 py-3 border-b border-border-default last:border-b-0 hover:bg-surface-secondary transition-colors ${n.is_read ? '' : 'bg-blue-50/40 dark:bg-blue-900/10'}`
                  return n.link ? (
                    <a key={n.id} href={ap(n.link)} onClick={() => onRowClick(n)} className={cls}>
                      {inner}
                    </a>
                  ) : (
                    <button key={n.id} onClick={() => onRowClick(n)} className={`${cls} w-full text-left`}>
                      {inner}
                    </button>
                  )
                })
              )}
            </div>
          </div>,
          document.body
        )}
    </>
  )
}
