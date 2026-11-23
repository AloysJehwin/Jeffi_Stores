'use client'

import { useMemo } from 'react'
import type { PageDoc } from '@jeffi/site-blocks'
import SiteEditor from '@/components/site-editor/SiteEditor'
import type { SaveResult, SiteEditorHost } from '@/components/site-editor/host'
import { SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'
import ImageField from '../showcase/_builder/ImageField'
import { previewSrc, studioUrl, type SessionView } from './api'

// The Showcase studio's host for the visual editor (components/site-editor), while site_settings site_editor_enabled
// is on: the session's one page, for the session's own site. It loads and saves through /studio/design (which
// compiles every tree again), draws on the studio preview in editor mode, and uploads pictures the way the Details
// step does. Publishing stays the studio's own step.

export default function VisualStudio({ session, onClose }: { session: SessionView; onClose: () => void }) {
  const site = session.site_id
  const host = useMemo<SiteEditorHost>(() => {
    const url = (params: Record<string, string> = {}) => studioUrl('design', { ...params, ...(site ? { site } : {}) })
    return {
      title: 'Your page',
      previewUrl: previewSrc(session.id, SHOWCASE_PAGE_KEY, 'desktop', 0, { editor: '1' }),
      canWrite: true,
      theme: session.theme,
      async load() {
        const res = await fetch(url(), { cache: 'no-store' })
        if (!res.ok) return null
        return ((await res.json()) as { doc: PageDoc }).doc
      },
      async save(doc): Promise<SaveResult> {
        const res = await fetch(url(), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ doc }) })
        const data = (await res.json().catch(() => ({}))) as { doc?: PageDoc; error?: string }
        return res.ok && data.doc ? { ok: true, doc: data.doc } : { ok: false, error: data.error || 'Your page could not be saved' }
      },
      renderImagePicker: ({ value, disabled, onPick }) =>
        disabled ? null : <ImageField value={value || null} onChange={u => u && onPick(u)} kind="work" label="Upload a picture" siteId={site} className="h-24 w-24" />,
      onClose,
    }
  }, [session.id, session.theme, site, onClose])

  return <SiteEditor host={host} />
}
