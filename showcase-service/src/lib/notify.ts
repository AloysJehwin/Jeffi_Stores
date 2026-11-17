import { getOwnerById } from '@/lib/tenant-registry/owners'
import { controlPlanePool } from '@/lib/tenant-registry/shared'
import { sendShowcaseEmail } from '@/lib/shared/ecom-emails'
import { showcaseHost } from '@/lib/showcase/host'
import type { ShowcaseLead, ShowcaseSiteRow } from '@/lib/showcase/store'

const ROOT = process.env.PLATFORM_ROOT_DOMAIN || 'jeffistores.in'
const esc = (s: string) => s.replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&#39;' })[c]!)
const oneLine = (s: string) => s.replace(/[\r\n\t]+/g, ' ').trim()

/** Tell the site's owner about a new enquiry. What the visitor typed is escaped; the leads inbox has the rest. */
export async function emailLeadToOwner(site: ShowcaseSiteRow, lead: ShowcaseLead): Promise<void> {
  const owner = await getOwnerById(site.ownerId)
  if (!owner?.email) return
  const business = site.business.name?.trim() || 'your business'
  // The console opens on the workspace the site belongs to.
  const slug = site.tenantId
    ? ((await controlPlanePool().query(`SELECT slug FROM tenants WHERE id = $1`, [site.tenantId]).catch(() => null))?.rows[0]?.slug as string | undefined)
    : undefined
  const rows = [
    { label: 'Name', value: esc(lead.name) },
    ...(lead.phone ? [{ label: 'Phone', value: `<a href="tel:${esc(lead.phone.replace(/[^\d+]/g, ''))}">${esc(lead.phone)}</a>` }] : []),
    ...(lead.email ? [{ label: 'Email', value: `<a href="mailto:${esc(lead.email)}">${esc(lead.email)}</a>` }] : []),
    ...(lead.message ? [{ label: 'Message', value: esc(lead.message).replace(/\r?\n/g, '<br>') }] : []),
  ]
  await sendShowcaseEmail(
    { email: owner.email, name: owner.name },
    {
      subject: `New enquiry from ${oneLine(lead.name).slice(0, 80)}`,
      title: 'You have a new enquiry',
      lines: [`Someone contacted ${esc(business)} through your site <strong>${showcaseHost(site.slug)}</strong>.`],
      rows,
      cta: { href: `https://ecom.${ROOT}/dashboard/showcase/leads${slug ? `?tenant=${encodeURIComponent(slug)}` : ''}`, label: 'Open your leads' },
    }
  )
}
