import 'server-only'
import { queryOne } from '@/lib/shared/db'
import { businessBaseUrlAsync, resolveCurrentTenant, storeBaseUrlAsync } from '@/lib/catalog/brand'
import { documentHostForSlug, type DocumentApp } from '@/lib/tenancy/forms-host'

// Every link put in a message to a customer (email, SMS, WhatsApp) comes from here, so it lands on
// the exact page (the order, the product) on the right host: the current tenant's store, or its
// business portal for an approved business customer. Paths carry no /business prefix; the
// business base already accounts for it.

async function isApprovedBusiness(userId: string): Promise<boolean> {
  const row = await queryOne<{ approved: boolean }>(
    `SELECT TRUE AS approved FROM business_profiles WHERE user_id = $1 AND approval_status = 'approved'`,
    [userId]
  ).catch(() => null)
  return !!row?.approved
}

/** Base URL for pages this customer opens: the business portal for approved business customers. */
export async function customerBaseUrl(userId?: string | null): Promise<string> {
  if (userId && (await isApprovedBusiness(userId))) return businessBaseUrlAsync()
  return storeBaseUrlAsync()
}

/**
 * Base for API routes (unsubscribe, open/click tracking, AMP actions). Always the storefront host:
 * a business base can end in /business, where no API route lives and auth would intercept.
 */
export function apiBaseUrl(): Promise<string> {
  return storeBaseUrlAsync()
}

export async function orderUrl(orderId: string, userId?: string | null): Promise<string> {
  return `${await customerBaseUrl(userId)}/account/orders/${encodeURIComponent(orderId)}`
}

/** Order page for an order known only by its number (SMS/WhatsApp senders get just the number). */
export async function orderUrlByNumber(orderNumber: string): Promise<string | null> {
  const order = await queryOne<{ id: string; user_id: string | null }>(
    `SELECT id::text, user_id::text FROM orders WHERE order_number = $1`,
    [orderNumber]
  ).catch(() => null)
  return order ? orderUrl(order.id, order.user_id) : null
}

export async function productUrl(slug: string, userId?: string | null): Promise<string> {
  return `${await customerBaseUrl(userId)}/products/${encodeURIComponent(slug)}`
}

/** Public page for an invoice / quotation / purchase order, on the current tenant's document host. */
export async function documentUrl(app: DocumentApp, token: string): Promise<string> {
  const tenant = await resolveCurrentTenant()
  return `https://${documentHostForSlug(app, tenant?.slug ?? null)}/${encodeURIComponent(token)}`
}
