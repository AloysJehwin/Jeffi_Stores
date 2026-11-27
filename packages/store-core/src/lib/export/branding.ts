import 'server-only'
import { queryMany, queryOne } from '@/lib/shared/db'
import { getStoreIdentity } from '@/lib/catalog/site-controls'
import { tenantLogoBuffer } from '@/lib/documents/store-logo'
import type { AdminJWTPayload } from '@/lib/auth/jwt'

// The store's letterhead for export headers: the current tenant's name, GSTIN, address and logo.

export interface StoreBrand {
  name: string
  legalName: string
  gstin: string
  address: string
  phone: string
  email: string
  logo: Buffer | null
}

export async function loadBrand(opts: { logo: boolean }): Promise<StoreBrand> {
  const [identity, rows, logo] = await Promise.all([
    getStoreIdentity().catch(() => null),
    queryMany<{ key: string; value: string | null }>("SELECT key, value FROM site_settings WHERE key LIKE 'business\\_%'", []).catch(() => []),
    opts.logo ? tenantLogoBuffer().then(b => (b ? pngOrJpeg(b) : null)) : Promise.resolve(null),
  ])
  const s: Record<string, string> = {}
  for (const r of rows) s[r.key] = (r.value ?? '').trim()
  const place = [s.business_city, s.business_state, s.business_pincode].filter(Boolean).join(', ')
  const street = s.business_address || ''
  const address = street && s.business_state && street.includes(s.business_state) ? street : [street, place].filter(Boolean).join(', ')
  return {
    name: s.business_trade_name || identity?.name || s.business_legal_name || '',
    legalName: s.business_legal_name || '',
    gstin: s.business_gstin || '',
    address,
    phone: s.business_phone || identity?.phone || '',
    email: s.business_email || identity?.email || '',
    logo,
  }
}

/** PDFKit and pptxgenjs draw PNG and JPEG only; anything else is converted, or dropped. */
async function pngOrJpeg(buf: Buffer): Promise<Buffer | null> {
  const png = buf[0] === 0x89 && buf[1] === 0x50
  const jpg = buf[0] === 0xff && buf[1] === 0xd8
  if (png || jpg) return buf
  try {
    const { asJpegOrPng } = await import('@/lib/shared/image-compat')
    return await asJpegOrPng(buf, 600)
  } catch {
    return null
  }
}

export async function adminDisplayName(admin: AdminJWTPayload): Promise<string> {
  const given = [admin.first_name, admin.last_name].filter(Boolean).join(' ').trim()
  if (given) return given
  try {
    const r = await queryOne<{ name: string | null }>(
      `SELECT NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS name
         FROM admins a LEFT JOIN users u ON u.id = a.user_id
        WHERE a.id = $1`,
      [admin.adminId]
    )
    if (r?.name) return r.name
  } catch {
    /* name is decoration */
  }
  return admin.email || 'Admin'
}
