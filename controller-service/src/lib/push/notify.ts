import { queryOne } from '@/lib/shared/db'
import { getFeatureFlags } from '@/lib/catalog/site-controls'
import { activeTokens, disableTokens } from '@/lib/push/devices'
import { isMarketingCategory, pushAllowed, type NotificationCategory } from '@/lib/push/preferences'
import { pushReady, sendToTokens } from '@/lib/push/send'

export interface PushNotice {
  category: NotificationCategory
  title: string
  body: string
  /** Storefront path, e.g. /account/orders/<id>; the app maps it to a screen. */
  link: string
  /** Absolute https URL (FCM rejects relative ones). */
  image?: string
  source: 'transactional' | 'campaign' | 'scenario'
  /** Order id, campaign id or scenario kind. */
  sourceRef?: string
  /** notifications.type; defaults to the category. */
  type?: string
  collapseKey?: string
}

async function categoryEnabled(category: NotificationCategory): Promise<boolean> {
  try {
    const f = await getFeatureFlags()
    return f.pushEnabled && (!isMarketingCategory(category) || f.marketingPushEnabled)
  } catch {
    return true
  }
}

/**
 * Always writes the inbox row, then pushes to the user's live devices if Site Controls and the
 * user's preference for the category allow it. Dead tokens are disabled. Never throws.
 */
export async function notifyPush(userId: string | null | undefined, n: PushNotice): Promise<void> {
  if (!userId) return
  let notificationId: string | undefined
  try {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO notifications (user_id, type, title, message, link, category, image_url, source, source_ref)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id`,
      [
        userId,
        (n.type ?? n.category).slice(0, 50),
        n.title.slice(0, 255),
        n.body,
        n.link.slice(0, 500),
        n.category,
        n.image?.slice(0, 500) ?? null,
        n.source,
        n.sourceRef?.slice(0, 120) ?? null,
      ]
    )
    notificationId = row?.id
  } catch (e) {
    console.warn('[push] inbox write failed:', e instanceof Error ? e.message : e)
  }
  try {
    if (!pushReady()) return
    if (!(await categoryEnabled(n.category))) return
    if (!(await pushAllowed(userId, n.category))) return
    const tokens = await activeTokens(userId)
    if (!tokens.length) return
    const image = n.image && /^https:\/\//i.test(n.image) ? n.image : undefined
    const results = await sendToTokens(tokens, {
      title: n.title,
      body: n.body,
      link: n.link,
      image,
      category: n.category,
      collapseKey: n.collapseKey,
      data: notificationId ? { notification_id: notificationId } : undefined,
      reference: n.sourceRef,
    })
    const dead = results.filter(r => r.invalidToken).map(r => r.token)
    if (dead.length) await disableTokens(dead, 'fcm_invalid')
  } catch (e) {
    console.warn('[push] send failed:', e instanceof Error ? e.message : e)
  }
}
