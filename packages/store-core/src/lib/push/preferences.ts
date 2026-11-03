import { query, queryMany, queryOne } from '@/lib/shared/db'

// Per-category notification choices (notification_preferences). A missing row means the default:
// transactional categories on; marketing categories follow users.marketing_opt_out, which also
// overrides an explicit marketing row.

export const NOTIFICATION_CATEGORIES = ['orders', 'account', 'offers', 'price_alerts'] as const
export type NotificationCategory = (typeof NOTIFICATION_CATEGORIES)[number]
export const NOTIFICATION_CHANNELS = ['push', 'email', 'sms', 'whatsapp'] as const
export type NotificationChannel = (typeof NOTIFICATION_CHANNELS)[number]

const MARKETING = new Set<NotificationCategory>(['offers', 'price_alerts'])
export const isMarketingCategory = (c: NotificationCategory) => MARKETING.has(c)

export interface CategoryPreference {
  category: NotificationCategory
  kind: 'transactional' | 'marketing'
  push: boolean
  email: boolean
  sms: boolean
  whatsapp: boolean
}

export type PreferenceUpdate = { category: NotificationCategory } & Partial<Record<NotificationChannel, boolean>>

type Row = Record<NotificationChannel, boolean> & { category: NotificationCategory }

function resolve(category: NotificationCategory, row: Row | undefined, optOut: boolean): CategoryPreference {
  const marketing = isMarketingCategory(category)
  const pick = (ch: NotificationChannel) => (marketing && optOut ? false : (row?.[ch] ?? (marketing ? !optOut : true)))
  return {
    category,
    kind: marketing ? 'marketing' : 'transactional',
    push: pick('push'),
    email: pick('email'),
    sms: pick('sms'),
    whatsapp: pick('whatsapp'),
  }
}

export async function getPreferences(userId: string): Promise<{ categories: CategoryPreference[]; marketingOptOut: boolean }> {
  const [user, rows] = await Promise.all([
    queryOne<{ marketing_opt_out: boolean | null }>(`SELECT marketing_opt_out FROM users WHERE id = $1`, [userId]),
    queryMany<Row>(`SELECT category, push, email, sms, whatsapp FROM notification_preferences WHERE user_id = $1`, [userId]),
  ])
  const optOut = !!user?.marketing_opt_out
  const byCat = new Map(rows.map(r => [r.category, r]))
  return { categories: NOTIFICATION_CATEGORIES.map(c => resolve(c, byCat.get(c), optOut)), marketingOptOut: optOut }
}

/** Upsert only the channels sent; a new row starts from the category default. */
export async function savePreferences(userId: string, updates: PreferenceUpdate[]): Promise<void> {
  const user = await queryOne<{ marketing_opt_out: boolean | null }>(`SELECT marketing_opt_out FROM users WHERE id = $1`, [userId])
  if (!user) return
  for (const u of updates) {
    const def = isMarketingCategory(u.category) ? !user.marketing_opt_out : true
    const v = NOTIFICATION_CHANNELS.map(ch => (typeof u[ch] === 'boolean' ? u[ch] : null))
    await query(
      `INSERT INTO notification_preferences (user_id, category, push, email, sms, whatsapp)
       VALUES ($1, $2, COALESCE($3::boolean, $7), COALESCE($4::boolean, $7), COALESCE($5::boolean, $7), COALESCE($6::boolean, $7))
       ON CONFLICT (user_id, category) DO UPDATE SET
         push = COALESCE($3::boolean, notification_preferences.push),
         email = COALESCE($4::boolean, notification_preferences.email),
         sms = COALESCE($5::boolean, notification_preferences.sms),
         whatsapp = COALESCE($6::boolean, notification_preferences.whatsapp),
         updated_at = now()`,
      [userId, u.category, ...v, def]
    )
  }
}

/** Should `category` reach this user by push? A missing user never does. */
export async function pushAllowed(userId: string, category: NotificationCategory): Promise<boolean> {
  const r = await queryOne<{ marketing_opt_out: boolean | null; push: boolean | null }>(
    `SELECT u.marketing_opt_out, p.push
     FROM users u LEFT JOIN notification_preferences p ON p.user_id = u.id AND p.category = $2
     WHERE u.id = $1`,
    [userId, category]
  )
  if (!r) return false
  if (isMarketingCategory(category)) return !r.marketing_opt_out && r.push !== false
  return r.push !== false
}

/**
 * A signed-out install that opted in to offers, now signed in: record that consent on the user,
 * unless they have already made an explicit offers choice.
 */
export async function carryOffersOptIn(userId: string): Promise<void> {
  await query(
    `INSERT INTO notification_preferences (user_id, category, push, email, sms, whatsapp)
     SELECT u.id, 'offers', true, NOT u.marketing_opt_out, NOT u.marketing_opt_out, NOT u.marketing_opt_out
     FROM users u WHERE u.id = $1
     ON CONFLICT (user_id, category) DO NOTHING`,
    [userId]
  )
}
