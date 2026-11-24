// Prints a CSV of every SMS template in the seed catalog, ready to review before anything is registered on the
// Airtel DLT portal: slug, category, header, DLT body ({{var}} and {var} become {#var#}), length, encoding, segments.
//
//   node scripts/dlt-template-sheet.mjs > docs/DLT_SMS_TEMPLATES.csv     (Node 22.18+ / 24, strips the TS types)
//
// Length is the DLT body as printed: each {#var#} counts 7 characters and, in GSM-7, its braces cost 2 septets each.
// That is a conservative estimate; the real text is shorter or longer by what each variable is filled with.
// Segments: GSM-7 is 160 for one, 153 each when joined; UCS-2 (anything outside GSM-7, such as a rupee sign or a
// dash) is 70 for one, 67 each when joined.

import { pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

export const HEADER = 'JEFFIS'

const GSM_BASIC = new Set(
  '@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞ\u001bÆæßÉ !"#¤%&\'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà'.split('')
)
const GSM_EXT = new Set('^{}\\[~]|€'.split(''))

/** {{var}} (catalog) and {var} (campaign catalog) become {#var#}; {#if x}…{/if} blocks keep their text (the longest form). */
export function toDltBody(body) {
  return body
    .replace(/\{#if [^}]*\}/g, '')
    .replace(/\{\/if\}/g, '')
    .replace(/\{\{\s*[\w.]+\s*\}\}/g, '{#var#}')
    .replace(/\{(?!#var#\})\s*[\w.]+\s*\}/g, '{#var#}')
}

export function encodingOf(text) {
  for (const ch of text) if (!GSM_BASIC.has(ch) && !GSM_EXT.has(ch)) return 'UCS-2'
  return 'GSM-7'
}

export function lengthOf(text, encoding) {
  if (encoding === 'UCS-2') return [...text].reduce((n, ch) => n + (ch.codePointAt(0) > 0xffff ? 2 : 1), 0)
  return [...text].reduce((n, ch) => n + (GSM_EXT.has(ch) ? 2 : 1), 0)
}

export function segmentsOf(len, encoding) {
  const [one, many] = encoding === 'UCS-2' ? [70, 67] : [160, 153]
  return len <= one ? 1 : Math.ceil(len / many)
}

const SERVICE_EXPLICIT = new Set(['cart/abandoned', 'restock', 'campaign/restock', 'campaign/back_in_stock_wishlist', 'campaign/viewed_product', 'campaign/viewed_category', 'campaign/wishlist_reminder', 'campaign/replenishment', 'campaign/subscription_renewal', 'campaign/cart_price_drop', 'campaign/review_photo_followup'])
const SERVICE_IMPLICIT_PREFIX = ['order/', 'delivery/', 'campaign/post_purchase', 'campaign/review_', 'campaign/abandoned_', 'campaign/high_value_cart']

/** DLT category: OTPs are Transactional; order and delivery updates Service-Implicit; opted-in nudges Service-Explicit; offers Promotional. */
export function categoryOf(slug) {
  if (slug.startsWith('otp/')) return 'Transactional'
  if (SERVICE_EXPLICIT.has(slug)) return 'Service-Explicit'
  if (SERVICE_IMPLICIT_PREFIX.some(p => slug.startsWith(p))) return 'Service-Implicit'
  return 'Promotional'
}

const csvCell = v => (/[",\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v))

export const COLUMNS = ['slug', 'category', 'header', 'dlt_body', 'length', 'encoding', 'segments']

export function rowsFor(catalog) {
  return catalog
    .filter(t => t.channel === 'sms')
    .map(t => {
      const body = toDltBody(t.body)
      const encoding = encodingOf(body)
      const length = lengthOf(body, encoding)
      return { slug: t.slug, category: categoryOf(t.slug), header: HEADER, dlt_body: body, length, encoding, segments: segmentsOf(length, encoding) }
    })
}

export function toCsv(rows) {
  return [COLUMNS.join(','), ...rows.map(r => COLUMNS.map(c => csvCell(r[c])).join(','))].join('\n') + '\n'
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const here = dirname(fileURLToPath(import.meta.url))
  const { CATALOG } = await import(pathToFileURL(resolve(here, '../messaging-service/seed/catalog.ts')).href)
  process.stdout.write(toCsv(rowsFor(CATALOG)))
}
