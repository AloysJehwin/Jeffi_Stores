'use client'

import { useMemo, useRef } from 'react'
import { pageRefKey, type PageDoc, type PageRef } from '@jeffi/site-blocks'
import { api } from '@/components/admin/kit/core'
import SiteEditor from '@/components/site-editor/SiteEditor'
import type { SaveResult, SiteEditorHost } from '@/components/site-editor/host'
import { siteRegistry } from '@/lib/site/blocks'

// The admin Site Builder's host for the visual editor (components/site-editor), behind site_settings
// site_editor_enabled. One responsive document per page: it edits the desktop web layout, and saves the phone layout
// too while that is the same document.

export interface VisualEditorProps {
  draftId: string
  /** The page; its desktop web layout is what is edited. */
  pageRef: PageRef
  title: string
  previewUrl: string | null
  canWrite: boolean
  onClose: () => void
  onPublish: () => Promise<void>
}

export default function VisualEditor({ draftId, pageRef, title, previewUrl, canWrite, onClose, onPublish }: VisualEditorProps) {
  const web: PageRef = useMemo(() => ({ ...pageRef, surface: 'web' }), [pageRef])
  const key = pageRefKey(web)
  const phone = useRef<'same' | 'own' | 'none'>('none')

  const host = useMemo<SiteEditorHost>(
    () => ({
      title,
      previewUrl,
      canWrite,
      async load() {
        const { ok, data } = await api<{ doc: PageDoc; phone: 'same' | 'own' | 'none' }>(`/api/admin/site-builder/drafts/${draftId}/editor?key=${encodeURIComponent(key)}`)
        if (!ok) return null
        phone.current = data.phone
        return data.doc
      },
      async save(doc): Promise<SaveResult> {
        const put = (ref: PageRef) => api<{ doc?: PageDoc; error?: string }>(`/api/admin/site-builder/drafts/${draftId}`, { method: 'PUT', json: { page: { ref, doc } } })
        const r = await put(web)
        if (!r.ok || !r.data.doc) return { ok: false, error: r.data.error || 'Could not save the draft' }
        if (phone.current === 'same') {
          const p = await put({ ...web, surface: 'web_mobile' })
          if (!p.ok) return { ok: false, error: p.data.error || 'Could not save the phone layout' }
        }
        return { ok: true, doc: r.data.doc }
      },
      publish: onPublish,
      onClose,
      blockLabel: type => siteRegistry.get(type)?.label ?? type,
    }),
    [title, previewUrl, canWrite, draftId, key, web, onClose, onPublish]
  )

  return <SiteEditor key={key} host={host} />
}
