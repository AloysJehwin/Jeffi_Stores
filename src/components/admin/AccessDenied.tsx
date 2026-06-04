'use client'

import { useEffect, useRef } from 'react'
import { usePathname } from 'next/navigation'

interface Props {
  scopeKey: string
  scopeLabel: string
}

export default function AccessDenied({ scopeKey, scopeLabel }: Props) {
  const pathname = usePathname()
  const sentRef = useRef(false)

  useEffect(() => {
    if (sentRef.current) return
    sentRef.current = true
    fetch('/api/admin/access-request', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ scopeKey, scopeLabel, pagePath: pathname }),
    }).catch(() => {})
  }, [scopeKey, scopeLabel, pathname])

  return (
    <div className="flex flex-col items-center justify-center min-h-[60vh] gap-6 px-4">
      <div className="flex flex-col items-center gap-3 text-center max-w-md">
        <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center">
          <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.8}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
          </svg>
        </div>
        <h2 className="text-xl font-semibold text-foreground">Access Restricted</h2>
        <p className="text-sm text-foreground-muted">
          You do not have the <span className="font-semibold text-foreground">{scopeLabel}</span> permission to view this page.
        </p>
        <p className="text-xs text-foreground-muted">
          An access request has been sent to the super admin. Contact them to have this scope added to your account.
        </p>
        <a
          href="/admin/dashboard"
          className="mt-2 px-4 py-2 bg-primary text-white rounded-lg text-sm font-medium hover:bg-primary/90 transition-colors"
        >
          Back to Dashboard
        </a>
      </div>
    </div>
  )
}
