import type { TenantDetailData } from '@controller/lib/ecom/detail'
import { DetailHeader } from '@/components/admin/kit/actions'
import { badgeCls } from '@/components/admin/kit/tones'
import { archiveRetentionDays } from '@/lib/tenant-registry/archives'
import { TenantStatus, storeHost } from './cells'
import TenantActions from './TenantActions'
import PurgeCustomerButton from './PurgeCustomerButton'
import KpiStrip from './detail/KpiStrip'
import { apiServices, type DetailSection } from './detail/labels'

export { apiServices }

/**
 * Shared header for the four tenant detail pages (Store, Instance, Status, Billing): title, actions and
 * that page's own KPIs. Each page lives under its own list's path prefix because the sidebar marks a group
 * active with startsWith(href + '/').
 */
export default function TenantObjectHeader({ d, back, section }: { d: TenantDetailData; back: { href: string; label: string }; section: DetailSection }) {
  const { t, job } = d
  return (
    <div className="space-y-4 min-w-0">
      <DetailHeader
        back={back}
        title={t.display_name}
        status={
          <>
            <TenantStatus status={t.status} />
            {d.kycPending && <span className={badgeCls('amber')}>Review pending</span>}
          </>
        }
        subtitle={<span className="break-all">{d.isStore ? storeHost(t) : `API workspace · ${apiServices(t)} · no store`}</span>}
        identifiers={[
          { label: 'Slug', value: t.slug },
          { label: 'ID', value: t.id, copy: true },
        ]}
        actions={
          d.isStore || d.purgeable ? (
            <>
              {d.isStore && (
                <TenantActions
                  tenantId={t.id}
                  slug={t.slug}
                  status={t.status}
                  instanceState={t.instance_state}
                  jobStatus={job?.status ?? null}
                  jobStep={job?.step ?? null}
                  rolledBack={(job?.created_resources as Record<string, unknown> | null)?.rolledBack === true}
                  retentionDays={archiveRetentionDays()}
                />
              )}
              {d.purgeable && <PurgeCustomerButton tenantId={t.id} slug={t.slug} afterHref="/admin/ecom/customers?tab=list" />}
            </>
          ) : undefined
        }
      />
      <KpiStrip d={d} section={section} />
    </div>
  )
}
