import { loadOwnerContext } from '@controller/lib/ecom/owner-context'
import { getKyc } from '@/lib/tenant-registry'
import { StatusPill } from '@controller/components/admin/ecom/EcomUI'
import PageHeader from '../_components/PageHeader'
import { Card, Row } from '../_components/Card'

export const dynamic = 'force-dynamic'

export default async function BusinessPage() {
  const { tenant } = await loadOwnerContext()
  const kyc = await getKyc(tenant.id).catch(() => null)
  const dash = (v: string | null | undefined) => v || '—'
  return (
    <>
      <PageHeader
        eyebrow="Account"
        title="Business details"
        description="What you submitted during onboarding. Contact support to change any of it."
        actions={kyc && <StatusPill status={kyc.status} />}
      />
      {!kyc ? (
        <Card>
          <p className="text-sm text-foreground-secondary">No business details on file for this store.</p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <Card title="Business">
            <div className="space-y-2.5">
              <Row label="Legal name" value={dash(kyc.business_name)} />
              <Row label="Type" value={<span className="capitalize">{dash(kyc.business_type)}</span>} />
              <Row label="Address" value={<span className="whitespace-pre-line">{dash(kyc.business_address)}</span>} />
              <Row label="Mobile" value={dash(kyc.mobile)} />
              <Row label="Categories" value={dash(kyc.product_categories)} />
            </div>
          </Card>
          <Card title="Tax">
            <div className="space-y-2.5">
              <Row label="GSTIN" mono value={dash(kyc.gst_number)} />
              <Row label="PAN" mono value={dash(kyc.pan)} />
              <Row label="GST certificate" value={kyc.gst_cert_s3_key ? 'Uploaded' : '—'} />
              <Row label="Legals accepted" value={kyc.legals_accepted_version ? `v${kyc.legals_accepted_version}` : '—'} />
            </div>
          </Card>
          {kyc.reviewer_note && (
            <Card title="Reviewer note" className="lg:col-span-2">
              <p className="text-sm text-foreground whitespace-pre-line">{kyc.reviewer_note}</p>
            </Card>
          )}
        </div>
      )}
    </>
  )
}
