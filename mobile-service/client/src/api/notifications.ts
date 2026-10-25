import { api } from './client'

// The controller's /api/user push routes (devices, inbox, preferences), via mobile-service.

export type NotificationCategory = 'orders' | 'account' | 'offers' | 'price_alerts'
export type NotificationChannel = 'push' | 'email' | 'sms' | 'whatsapp'

export const NOTIFICATION_CATEGORIES: NotificationCategory[] = ['orders', 'account', 'offers', 'price_alerts']
export const NOTIFICATION_CHANNELS: NotificationChannel[] = ['push', 'email', 'sms', 'whatsapp']

export interface PushDeviceInput {
  token: string
  platform: 'android' | 'ios'
  app_version?: string | null
  os_version?: string | null
  locale?: string | null
  timezone?: string | null
  /** The install's own offers consent; omit to leave it as is. */
  offers_opt_in?: boolean
}

export interface InboxItem {
  id: string
  type: string
  category: NotificationCategory | null
  title: string
  body: string | null
  link: string | null
  image_url: string | null
  is_read: boolean
  opened_at: string | null
  created_at: string
}

export interface InboxPage {
  items: InboxItem[]
  next_cursor: string | null
  unread_count: number
}

export interface CategoryPreference {
  category: NotificationCategory
  kind: 'transactional' | 'marketing'
  push: boolean
  email: boolean
  sms: boolean
  whatsapp: boolean
}

export interface NotificationPreferences {
  categories: CategoryPreference[]
  marketing_opt_out: boolean
}

export type PreferenceUpdate = { category: NotificationCategory } & Partial<Record<NotificationChannel, boolean>>

export function registerPushDevice(device: PushDeviceInput) {
  return api<{ ok: boolean; id: string | null; signed_in: boolean; offers_opt_in: boolean }>('/api/user/push-devices', {
    method: 'POST',
    body: JSON.stringify(device),
  })
}

/** Sign-out: detaches the user; the install stays registered as a guest. Needs no session. */
export function unregisterPushDevice(token: string) {
  return api<{ ok: boolean }>(`/api/user/push-devices/${encodeURIComponent(token)}`, { method: 'DELETE', token: null })
}

export function listNotifications(cursor?: string | null) {
  return api<InboxPage>(`/api/user/notifications${cursor ? `?cursor=${encodeURIComponent(cursor)}` : ''}`)
}

export function markNotificationsRead(body: { ids: string[] } | { all: true }) {
  return api<{ ok: boolean; unread_count: number }>('/api/user/notifications/read', { method: 'POST', body: JSON.stringify(body) })
}

export function markNotificationOpened(id: string) {
  return api<{ ok: boolean }>(`/api/user/notifications/${encodeURIComponent(id)}/opened`, { method: 'POST' })
}

export function getNotificationPreferences() {
  return api<NotificationPreferences>('/api/user/notification-preferences')
}

export function saveNotificationPreferences(categories: PreferenceUpdate[]) {
  return api<NotificationPreferences>('/api/user/notification-preferences', { method: 'PUT', body: JSON.stringify({ categories }) })
}
