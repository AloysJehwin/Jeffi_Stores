import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { getKyc, hasService } from '@/lib/tenant-registry'
import { categoryList, complianceStanding, todayIst } from '@controller/lib/catalog/compliance'
import { listComplianceDocuments } from '@controller/lib/catalog/compliance-docs'
import PageHeader from '../_components/PageHeader'
import { Card } from '../_components/Card'
import { Badge } from '../../onboard/ui'
import LicencesClient from './LicencesClient'

export const dynamic = 'force-dynamic'

const DESCRIPTION = 'What Indian law asks of the products you sell. We review each licence and email you before one expires.'

const STANDING = {
  action: { tone: 'red', label: 'Action needed' },
  review: { tone: 'peach', label: 'In review' },
  ok: { tone: 'sage', label: 'All approved' },
} as const

const iso = (v: string | Date | null) => (v ? new Date(v).toISOString() : null)

export default async function LicencesPage() {
  const { tenant } = await loadOwnerContext()
  if (!hasService(tenant, 'store')) {
    return (
      <>
        <PageHeader eyebrow="Account" title="Licences & certificates" description={DESCRIPTION} />
        <Card>
          <p className="text-sm text-foreground-secondary">Licences are kept for stores. Once you open one from Add a store, its licences show here.</p>
        </Card>
      </>
    )
  }
  const [docs, kyc] = await Promise.all([listComplianceDocuments(tenant.id).catch(() => []), getKyc(tenant.id).catch(() => null)])
  // Dates are compared in IST on the server, so the page and the reminders agree.
  const today = todayIst()
  const standing = complianceStanding(docs, today)
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Licences & certificates"
        description={DESCRIPTION}
        actions={standing && <Badge tone={STANDING[standing].tone}>{STANDING[standing].label}</Badge>}
      />
      <LicencesClient
        tenantId={tenant.id}
        today={today}
        selling={categoryList(kyc?.product_categories)}
        documents={docs.map(d => ({
          id: d.id,
          docType: d.doc_type,
          category: d.category,
          number: d.doc_number,
          expiresOn: d.expires_on,
          status: d.status,
          note: d.review_note,
          reviewedAt: iso(d.reviewed_at),
          sentAt: iso(d.created_at) ?? '',
        }))}
      />
    </>
  )
}
