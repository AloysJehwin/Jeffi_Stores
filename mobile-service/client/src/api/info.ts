import { api } from './client'

// Info pages: About categories, legal policies, and the support chat (same /api routes the web uses).

export interface OfferCategory {
  id: string
  name: string
  slug: string | null
  icon_name: string | null
  subcategories: Array<{ id: string; name: string; slug: string | null }>
}

export function getAboutCategories(): Promise<OfferCategory[]> {
  return api<{ categories: OfferCategory[] }>('/api/about', { token: null }).then(d => d.categories)
}

export interface PolicySummary {
  slug: string
  title: string
  description: string
  lastUpdated: string
}
export interface Policy extends PolicySummary {
  sections: Array<{ heading: string; body: string | string[] }>
}

export function listPolicies(): Promise<PolicySummary[]> {
  return api<{ policies: PolicySummary[] }>('/api/legal', { token: null }).then(d => d.policies)
}

export function getPolicy(slug: string): Promise<Policy> {
  return api<{ policy: Policy }>(`/api/legal/${encodeURIComponent(slug)}`, { token: null }).then(d => d.policy)
}

// ── Support chat (lib/shared/support-bot.ts payloads) ──

export interface BotAction { label: string; url?: string; query?: string }
export interface BotNavLink { label: string; url?: string; query?: string; icon?: 'orders' | 'account' | 'returns' | 'addresses' | 'invoices' | 'track' }
export interface BotChip { label: string; query: string }
export interface BotOrderCard {
  id: string
  order_number: string
  status: string
  payment_status: string
  total_amount: string
  tracking_number: string | null
  created_at: string
}
export type BotPayload =
  | { type: 'text'; text: string }
  | { type: 'text_actions'; text: string; actions: BotAction[] }
  | { type: 'order_list'; text: string; orders: BotOrderCard[]; context: 'view' | 'cancel' | 'return' | 'track' | 'payment' }
  | { type: 'order_detail'; order: BotOrderCard; actions: BotAction[] }
  | { type: 'nav'; text: string; links: BotNavLink[] }
  | { type: 'chips'; text: string; chips: BotChip[] }

export interface SupportSession { id: string; status: string; created_at: string; admin_name?: string | null }
export interface SupportMessage {
  id: string
  sender: 'user' | 'admin' | 'bot'
  message: string
  created_at?: string
  sender_name?: string | null
  is_closing?: boolean
}

export function getOpenSession(): Promise<{ session: SupportSession | null }> {
  return api('/api/support/sessions')
}

export function startSession(): Promise<{ session: SupportSession }> {
  return api('/api/support/sessions', { method: 'POST', body: '{}' })
}

export function closeSession(id: string): Promise<{ success: boolean }> {
  return api(`/api/support/sessions/${id}`, { method: 'PATCH', body: JSON.stringify({ status: 'closed' }) })
}

export function getSessionMessages(id: string): Promise<{ messages: SupportMessage[]; admin_name?: string | null }> {
  return api(`/api/support/sessions/${id}/messages`)
}

export function sendSessionMessage(id: string, message: string): Promise<{ message: SupportMessage }> {
  return api(`/api/support/sessions/${id}/messages`, { method: 'POST', body: JSON.stringify({ message }) })
}

export function askBot(msg: string): Promise<{ payload?: BotPayload }> {
  return api(`/api/support/bot?msg=${encodeURIComponent(msg)}`)
}
