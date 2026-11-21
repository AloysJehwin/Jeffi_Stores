'use client'

import { useEffect, useState } from 'react'
import { useRouter } from 'next/navigation'
import { LoaderCircle, RefreshCw } from 'lucide-react'
import { ActionButton, useActionToast } from '@/components/admin/kit'

/**
 * Runs the automatic check again on every document on file except approved ones. While any is being checked, the tab
 * refreshes every few seconds, for two minutes at most.
 */
export default function KybRecheckButton({ tenantId, checking }: { tenantId: string; checking: number }) {
  const router = useRouter()
  const toast = useActionToast()
  const [polls, setPolls] = useState(0)

  useEffect(() => {
    if (!checking || polls >= 24) return
    const t = setTimeout(() => {
      setPolls(n => n + 1)
      router.refresh()
    }, 5000)
    return () => clearTimeout(t)
  }, [checking, polls, router])

  async function recheck() {
    const res = await fetch(`/api/admin/ecom/kyc/${tenantId}/kyb/recheck`, { method: 'POST' }).catch(() => null)
    const data = await res?.json().catch(() => ({}))
    if (!res?.ok) return toast.error(data?.error || 'Failed')
    if (!data?.count) return toast.info('Nothing to check: approved documents aren’t checked again.')
    toast.success(`Checking ${data.count} document${data.count === 1 ? '' : 's'} again. The results show here in a minute or two.`)
    setPolls(0)
    router.refresh()
  }

  return (
    <div className="flex flex-wrap items-center gap-3">
      {checking > 0 && (
        <span className="inline-flex items-center gap-1.5 text-xs text-foreground-muted">
          <LoaderCircle aria-hidden className="h-3.5 w-3.5 animate-spin" />
          Checking {checking} document{checking === 1 ? '' : 's'}
        </span>
      )}
      <ActionButton action={{ label: 'Run checks again', icon: RefreshCw, onClick: recheck }} />
    </div>
  )
}
