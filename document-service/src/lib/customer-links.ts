import { queryOne, currentTenant, ROOT_DOMAIN } from '@jeffi/tenancy'
import { businessBaseUrlAsync, storeBaseUrlAsync } from './brand'

export type DocumentApp = 'invoice' | 'quotation' | 'purchaseorder'

async function isApprovedBusiness(userId: string): Promise<boolean> {
  const row = await queryOne(`SELECT TRUE AS approved FROM business_profiles WHERE user_id = $1 AND approval_status = 'approved'`, [userId]).catch(() => null)
  return !!row?.approved
}

export async function customerBaseUrl(userId?: string | null): Promise<string> {
  if (userId && (await isApprovedBusiness(userId))) return businessBaseUrlAsync()
  return storeBaseUrlAsync()
}

export async function orderUrl(orderId: string, userId?: string | null): Promise<string> {
  return `${await customerBaseUrl(userId)}/account/orders/${encodeURIComponent(orderId)}`
}

export async function orderUrlById(orderId: string): Promise<string> {
  const o = await queryOne<{ user_id: string | null }>(`SELECT user_id::text FROM orders WHERE id = $1`, [orderId]).catch(() => null)
  return orderUrl(orderId, o?.user_id ?? null)
}

export async function documentUrl(app: DocumentApp, token: string): Promise<string> {
  const slug = currentTenant()?.slug
  const host = slug ? `${app}-${slug}.${ROOT_DOMAIN}` : `${app}.${ROOT_DOMAIN}`
  const proto = host.endsWith('.localhost') ? 'http' : 'https'
  const port = process.env.DEV_PUBLIC_PORT ? `:${process.env.DEV_PUBLIC_PORT}` : ''
  return `${proto}://${host}${port}/${encodeURIComponent(token)}`
}

export async function invoiceUrlForOrder(orderId: string): Promise<string | undefined> {
  const o = await queryOne<{ view_token: string | null; invoice_number: string | null }>(`SELECT view_token, invoice_number FROM orders WHERE id = $1`, [orderId]).catch(() => null)
  if (!o?.view_token || !o.invoice_number) return undefined
  return documentUrl('invoice', o.view_token)
}
