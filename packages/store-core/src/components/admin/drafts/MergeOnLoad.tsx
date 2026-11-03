'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import type { MergeConflict } from '@/lib/admin/draft-merge'
import MergeDialog, { publishWithResolutions } from './MergeDialog'

/** After a Publish that hit overlapping edits (?merge=1): fetch the conflicts and open the dialog. */
export default function MergeOnLoad({ publishPath, doneHref, closeHref }: { publishPath: string; doneHref: string; closeHref: string }) {
  const router = useRouter()
  const [conflicts, setConflicts] = useState<MergeConflict[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const ran = useRef(false)
  useEffect(() => {
    if (ran.current) return
    ran.current = true
    void publishWithResolutions(publishPath).then(r => {
      if (r.ok) router.replace(doneHref)
      else if (r.conflicts?.length) setConflicts(r.conflicts)
      else setError(r.error)
    })
  }, [publishPath, doneHref, router])
  if (error) return <p className="mb-3 rounded-lg border border-red-300 bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-900/20">{error}</p>
  if (!conflicts) return null
  return <MergeDialog open conflicts={conflicts} publishPath={publishPath} onClose={() => router.replace(closeHref)} onDone={() => router.replace(doneHref)} />
}
