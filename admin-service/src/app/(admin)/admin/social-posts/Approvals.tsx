'use client'

import { useState } from 'react'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite, useHasScope } from '@/contexts/AdminScopesContext'
import { Empty, Section, api, btnGhost, btnPrimary } from '@/components/admin/channels/ui'
import PostGroup from './PostGroup'
import { groupPosts, type Post } from './shared'

export default function Approvals({ posts, canApprove: canApproveProp, onChange }: { posts: Post[] | null; canApprove: boolean; onChange: () => void }) {
  const canWrite = useCanWrite('social')
  const hasApprove = useHasScope('social:approve')
  const canApprove = canApproveProp && hasApprove
  const { showToast } = useToast()
  const [busy, setBusy] = useState<string | null>(null)
  const waiting = groupPosts((posts ?? []).filter(p => p.approval_status === 'pending' && p.status !== 'cancelled'))

  async function decide(id: string, approve: boolean) {
    setBusy(`${approve}:${id}`)
    const r = await api(`/api/admin/social-posts/${id}/approve`, { method: 'POST', json: { approve } })
    setBusy(null)
    if (!r.ok) showToast(r.data.error || 'Failed', 'error')
    else showToast(approve ? 'Approved' : 'Rejected', 'success')
    onChange()
  }

  return (
    <Section title={`Waiting for approval${waiting.length ? ` (${waiting.length})` : ''}`}>
      {!posts ? (
        <p className="text-sm text-foreground-muted">Loading...</p>
      ) : !waiting.length ? (
        <Empty msg="Nothing is waiting for approval." />
      ) : (
        <div className="space-y-3">
          {!canApprove && <p className="text-xs text-foreground-muted">Someone with approval rights decides on these.{canWrite ? ' You can still edit them.' : ''}</p>}
          {waiting.map(g => (
            <div key={g[0].group_id ?? g[0].id} className="space-y-2">
              <PostGroup posts={g} onChange={onChange} />
              {canApprove && (
                <div className="flex gap-2 justify-end">
                  <button type="button" className={btnGhost} disabled={!!busy} onClick={() => decide(g[0].id, false)}>
                    {busy === `false:${g[0].id}` ? 'Rejecting...' : 'Reject'}
                  </button>
                  <button type="button" className={btnPrimary} disabled={!!busy} onClick={() => decide(g[0].id, true)}>
                    {busy === `true:${g[0].id}` ? 'Approving...' : g.length > 1 ? `Approve all ${g.length}` : 'Approve'}
                  </button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </Section>
  )
}
