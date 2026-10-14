import type { Campaign } from '@/lib/shared/marketing'
import { getLibraryTemplate } from '@/lib/messaging/library'

// A campaign linked to the templates library sends the library's current content (the tenant's copy,
// else the standard). Swaps it into the legacy fields so every downstream renderer, coupon check and
// validator works unchanged. Falls back to the stored inline content if the library is unreachable.
const RESOLVED = Symbol('libraryContent')

export async function withLibraryContent<C extends Campaign | null>(c: C): Promise<C> {
  if (!c || (c as any)[RESOLVED] || !c.email_template_slug) return c
  const t = await getLibraryTemplate('email', c.email_template_slug)
  if (!t) return c
  const blocks = t.blocks_format === 'email-blocks' && Array.isArray(t.blocks?.blocks) ? t.blocks.blocks : null
  return Object.assign({ ...c }, {
    subject_template: t.subject ?? c.subject_template,
    body_template: t.body,
    template_mode: blocks ? 'blocks' : 'richtext',
    blocks: blocks ?? null,
    [RESOLVED]: true,
  })
}
