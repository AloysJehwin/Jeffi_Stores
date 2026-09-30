'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'

export default function PortalSignOutButton({
  endpoint,
  homeHref = '/',
  label = 'Sign out',
}: {
  endpoint: string
  homeHref?: string
  label?: string
}) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  async function signOut() {
    setBusy(true)
    try {
      await fetch(endpoint, { method: 'POST' })
    } finally {
      router.push(homeHref)
      router.refresh()
    }
  }
  return (
    <button
      type="button"
      onClick={signOut}
      disabled={busy}
      className="text-sm text-white/80 hover:text-white transition-colors disabled:opacity-50"
    >
      {busy ? 'Signing out…' : label}
    </button>
  )
}
