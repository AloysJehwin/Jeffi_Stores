// Client-safe: push copy limits and checks, shared by the Mailer composer, the scenario editor and
// the send paths. No server imports.

export const PUSH_TITLE_MAX = 65
export const PUSH_BODY_MAX = 240

/** The push block of email_campaigns.channels. */
export interface PushChannel {
  title: string
  body: string
  image_url?: string
  /** Storefront path the app opens on tap. */
  link?: string
}

// A storefront path: one leading slash, no scheme, no whitespace.
const PATH = /^\/(?!\/)[^\s<>"'`\\]*$/

export const validPushLink = (link: string | null | undefined) => !link || PATH.test(link.trim())

/** What stops this push from going out, or null when it is ready. */
export function pushCopyProblem(p: Partial<PushChannel> | null | undefined): string | null {
  if (!p) return 'Push is not set up'
  const title = (p.title ?? '').trim()
  const body = (p.body ?? '').trim()
  if (!title) return 'Add a push title'
  if (title.length > PUSH_TITLE_MAX) return `Push title is over ${PUSH_TITLE_MAX} characters`
  if (!body) return 'Add the push text'
  if (body.length > PUSH_BODY_MAX) return `Push text is over ${PUSH_BODY_MAX} characters`
  if (!validPushLink(p.link)) return 'The push link must be a store path such as /products/…'
  if (p.image_url && !/^https:\/\//i.test(p.image_url.trim())) return 'The push image must be an https:// link'
  return null
}
