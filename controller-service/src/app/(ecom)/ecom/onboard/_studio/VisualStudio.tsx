'use client'

import { useMemo, useState } from 'react'
import type { CodeNode, PageDoc } from '@jeffi/site-blocks'
import SiteEditor from '@/components/site-editor/SiteEditor'
import type { SaveResult, SiteEditorHost } from '@/components/site-editor/host'
import { SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'
import ImageField from '../showcase/_builder/ImageField'
import { previewSrc, studioUrl, type SessionView, type StudioView } from './api'

// The Showcase studio's host for the visual editor (components/site-editor), while site_settings site_editor_enabled
// is on: the session's one page, for the session's own site. It loads and saves through /studio/design (which
// compiles every tree again), draws on the studio preview in editor mode, and uploads pictures the way the Details
// step does. Publishing stays the studio's own step.

type Allowance = StudioView['allowance']

/** What an AI change costs now: the day's free ones, then the correction price from the AI wallet. */
export const aiNoteOf = (a: Allowance) =>
  a.correctionsLeft > 0 ? `${a.correctionsLeft} free AI change${a.correctionsLeft === 1 ? '' : 's'} left today` : `₹${a.correctionPriceInr} from your AI wallet (no free changes left today)`

export default function VisualStudio({ session, allowance: initial, onClose }: { session: SessionView; allowance: Allowance; onClose: () => void }) {
  const site = session.site_id
  const [allowance, setAllowance] = useState(initial)
  const host = useMemo<SiteEditorHost>(() => {
    const url = (path = 'design') => studioUrl(path, site ? { site } : {})
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
      aiNote: aiNoteOf(allowance),
      // One AI correction: free within the day's allowance, else at the price shown here.
      async changeWithAi({ block, ids, instruction }) {
        const res = await fetch(url('design/ai'), {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ blockId: block, ids, instruction, ...(allowance.correctionsLeft > 0 ? {} : { priceInr: allowance.correctionPriceInr }) }),
        })
        const data = (await res.json().catch(() => ({}))) as { tree?: CodeNode; changed?: string[]; allowance?: Allowance; priceInr?: number; error?: string }
        if (data.allowance) setAllowance(data.allowance)
        else if (typeof data.priceInr === 'number') setAllowance(a => ({ ...a, correctionsLeft: 0, correctionPriceInr: data.priceInr! }))
        return res.ok && data.tree ? { ok: true as const, tree: data.tree, changed: data.changed ?? [] } : { ok: false as const, error: data.error || 'The AI could not make that change' }
      },
      renderImagePicker: ({ value, disabled, onPick }) =>
        disabled ? null : <ImageField value={value || null} onChange={u => u && onPick(u)} kind="work" label="Upload a picture" siteId={site} className="h-24 w-24" />,
      onClose,
    }
  }, [session.id, session.theme, site, onClose, allowance])

  return <SiteEditor host={host} />
}
