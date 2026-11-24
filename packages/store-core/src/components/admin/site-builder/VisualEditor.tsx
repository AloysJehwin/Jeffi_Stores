'use client'

import { useMemo, useRef } from 'react'
import { pageRefKey, type Block, type CodeNode, type PageDoc, type PageRef, type ThemeTokens } from '@jeffi/site-blocks'
import { api } from '@/components/admin/kit/core'
import SiteEditor from '@/components/site-editor/SiteEditor'
import type { SaveResult, SiteEditorHost } from '@/components/site-editor/host'
import { siteRegistry } from '@/lib/site/blocks'
import { Image as MediaImage, type SectionOptions } from '@/components/admin/homepage/editors/fields'
import BlockInspector from './BlockInspector'
import { useCanWrite } from '@/contexts/AdminScopesContext'

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
  theme: ThemeTokens | null
  /** The admin may use Site Builder's AI (billed to the store's AI wallet). */
  canAi?: boolean
  /** The forms editor's section options, for a classic block's fields (BlockInspector). */
  options?: SectionOptions
  onClose: () => void
  onPublish: () => Promise<void>
}

export default function VisualEditor({ draftId, pageRef, title, previewUrl, canWrite, theme, canAi = false, options, onClose, onPublish }: VisualEditorProps) {
  // The Site Builder's own write scope as well as the caller's say-so, like its other panels.
  const scoped = useCanWrite('settings:write')
  const writable = canWrite && scoped
  const web: PageRef = useMemo(() => ({ ...pageRef, surface: 'web' }), [pageRef])
  const key = pageRefKey(web)
  const phone = useRef<'same' | 'own' | 'none'>('none')

  const host = useMemo<SiteEditorHost>(
    () => ({
      title,
      previewUrl,
      canWrite: writable,
      theme,
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
      closeLabel: 'Classic editor',
      blockLabel: type => siteRegistry.get(type)?.label ?? type,
      blockLocked: type => !!siteRegistry.get(type)?.locked,
      // A classic block's fields: the forms editor's own inspector.
      ...(options ? { renderBlockFields: ({ block, canWrite: w, onChange }) => <BlockInspector key={block.id} block={block} pageRef={web} options={options} canWrite={w} onChange={onChange} /> } : {}),
      async convertBlock(block) {
        const { ok, data } = await api<{ block?: Block; error?: string }>('/api/admin/site-builder/convert', { method: 'POST', json: { page: web.page, block } })
        return ok && data.block ? { ok: true as const, block: data.block } : { ok: false as const, error: data.error || 'Could not convert this section' }
      },
      ...(canAi
        ? {
            aiNote: 'Billed to your AI wallet.',
            async changeWithAi({ label, tree, ids, instruction }) {
              const { ok, data } = await api<{ tree?: CodeNode; changed?: string[]; error?: string }>('/api/admin/site-builder/ai/selection', {
                method: 'POST',
                json: { ref: { audience: web.audience, page: web.page }, block: { label, tree }, ids, instruction, draftId },
              })
              return ok && data.tree ? { ok: true as const, tree: data.tree, changed: data.changed ?? [] } : { ok: false as const, error: data.error || 'The AI could not make that change' }
            },
            async elementAi(p) {
              const { ok, data } = await api<{ text?: string; url?: string; alt?: string | null; credit?: unknown; error?: string }>('/api/admin/site-builder/ai/element', {
                method: 'POST',
                json: p.kind === 'picture' ? { ...p, draftId } : p,
              })
              return ok ? { ok: true as const, ...data } : { ok: false as const, error: data.error || 'The AI could not do that' }
            },
          }
        : {}),
      // The forms editor's picker: the media library, uploads and AI pictures.
      renderImagePicker: ({ value, disabled, onPick }) => <MediaImage label="Picture" value={value} size="wide" disabled={disabled} onCommit={url => onPick(url)} />,
    }),
    [title, previewUrl, writable, theme, canAi, options, draftId, key, web, onClose, onPublish]
  )

  return <SiteEditor key={key} host={host} />
}
