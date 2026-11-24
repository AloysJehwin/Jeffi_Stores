import { getOwnerById } from '@/lib/tenant-registry/owners'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { sendShowcaseLeadEmail } from '@/lib/shared/ecom-emails'
import { showcaseHost } from '@/lib/showcase/host'
import { phoneLinks } from '@/lib/showcase/phone'
import type { ShowcaseLead, ShowcaseSiteRow } from '@/lib/showcase/store'

const ROOT = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'
const esc = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!)
const oneLine = (s: string) => s.replace(/\s+/g, ' ').trim()
const when = (iso: string) =>
  new Date(iso).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: 'Asia/Kolkata' })

/** The enquiry email: who wrote, how to answer them and which site. Everything the visitor typed is escaped. */
export function leadEmail(site: ShowcaseSiteRow, lead: ShowcaseLead, tenantSlug?: string) {
  const host = showcaseHost(site.slug)
  const business = oneLine(site.business.name ?? '') || host
  const name = oneLine(lead.name) || 'A visitor'
  const { tel, whatsapp: wa } = lead.phone ? phoneLinks(lead.phone) : { tel: '', whatsapp: '' }
  const link = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`
  const reach = [tel && 'call', wa && 'WhatsApp'].filter(Boolean).join(' or ')
  const answer = lead.email
    ? `Reply to this email to answer ${esc(name)}${reach ? `, or ${reach} them` : ''}.`
    : reach
      ? `${esc(name)} left no email: ${reach} them on ${esc(lead.phone!)}.`
      : ''
  const message = lead.message ? oneLine(lead.message) : ''
  return {
    subject: `New enquiry from ${name.slice(0, 80)} · ${business.slice(0, 60)}`,
    preheader: message ? `${name}: ${message.slice(0, 140)}` : `${name} contacted ${business} through ${host}.`,
    title: 'You have a new enquiry',
    lines: [`${esc(name)} contacted ${esc(business)} through your site <strong>${esc(host)}</strong>.`, ...(answer ? [answer] : [])],
    rows: [
      { label: 'Name', value: esc(name) },
      ...(lead.phone ? [{ label: 'Phone', value: [tel ? link(tel, lead.phone) : esc(lead.phone), wa && link(wa, 'WhatsApp')].filter(Boolean).join(' &middot; ') }] : []),
      ...(lead.email ? [{ label: 'Email', value: link(`mailto:${lead.email}`, lead.email) }] : []),
      ...(lead.message ? [{ label: 'Message', value: esc(lead.message).replace(/\r?\n/g, '<br>') }] : []),
      { label: 'Received', value: esc(when(lead.createdAt)) },
    ],
    cta: { href: `https://ecom.${ROOT}/dashboard/showcase/${site.id}/leads${tenantSlug ? `?tenant=${encodeURIComponent(tenantSlug)}` : ''}`, label: 'Open your enquiries' },
    replyTo: lead.email || null,
  }
}

/** Tell the site's owner about a new enquiry; replying to the email answers the visitor. */
export async function emailLeadToOwner(site: ShowcaseSiteRow, lead: ShowcaseLead): Promise<void> {
  const owner = await getOwnerById(site.ownerId)
  if (!owner?.email) return
  // The console opens on the workspace the site belongs to.
  const slug = site.tenantId
    ? ((await controlPlanePool().query(`SELECT slug FROM tenants WHERE id = $1`, [site.tenantId]).catch(() => null))?.rows[0]?.slug as string | undefined)
    : undefined
  await sendShowcaseLeadEmail({ email: owner.email, name: owner.name }, leadEmail(site, lead, slug))
}
