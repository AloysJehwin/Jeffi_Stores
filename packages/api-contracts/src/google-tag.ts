// The flagship store's Google tag and a plain-HTML loader for pages rendered outside the Next app
// (document-service, the public API docs, raw route responses). The storefront's own bootstrap with
// Consent Mode lives in controller-service lib/analytics/google-tag.ts.

export const FLAGSHIP_GOOGLE_TAG_ID = 'GT-NM2C3M85'

const TAG_ID_RE = /^(GT|G|AW)-[A-Z0-9]{4,20}$/

/** Normalised tag id, or null when it isn't one. */
export function googleTagId(raw: unknown): string | null {
  const v = String(raw ?? '').trim().toUpperCase()
  return TAG_ID_RE.test(v) ? v : null
}

/**
 * Head markup loading gtag.js for one tag. These pages have no cookie banner, so ad storage stays
 * denied (measurement only, no ad cookies). `event` is sent after the page view.
 */
export function gtagHeadSnippet(tagId: string, opts: { contentGroup?: string; event?: { name: string; params?: Record<string, unknown> } } = {}): string {
  const id = googleTagId(tagId)
  if (!id) return ''
  const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')
  const config = opts.contentGroup ? `,${json({ content_group: opts.contentGroup })}` : ''
  const event = opts.event ? `gtag('event',${json(opts.event.name)},${json(opts.event.params ?? {})});` : ''
  return (
    `<script async src="https://www.googletagmanager.com/gtag/js?id=${id}"></script>` +
    `<script>window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}` +
    `gtag('consent','default',{ad_storage:'denied',ad_user_data:'denied',ad_personalization:'denied'});` +
    `gtag('js',new Date());gtag('config',${json(id)}${config});${event}</script>`
  )
}
