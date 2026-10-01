'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import MobileListCard from '@/components/admin/mobile/MobileListCard'
import MobileDetailSheet from '@/components/admin/mobile/MobileDetailSheet'
import MobileActionSheet, { type MobileAction } from '@/components/admin/mobile/MobileActionSheet'

interface InstanceTenant {
  id: string
  display_name: string
  rds_endpoint: string | null
  ec2_target: string | null
  s3_bucket: string | null
  region: string | null
}

function Field({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 py-2 border-b border-border-default last:border-b-0">
      <span className="text-xs text-foreground-muted flex-shrink-0">{label}</span>
      <span className={`text-sm text-foreground text-right break-all ${mono ? 'font-mono text-xs' : ''}`}>{value}</span>
    </div>
  )
}

export default function EcomInstancesMobileList({ tenants }: { tenants: InstanceTenant[] }) {
  const router = useRouter()
  const [selected, setSelected] = useState<InstanceTenant | null>(null)
  const [actionsOpen, setActionsOpen] = useState(false)

  if (tenants.length === 0) {
    return (
      <div className="bg-surface-elevated rounded-lg border border-border-default p-8 text-center text-foreground-muted">
        No tenants match.
      </div>
    )
  }

  const actions = (t: InstanceTenant): MobileAction[] => [
    { key: 'detail', label: 'View instance detail', onSelect: () => router.push(`/admin/ecom/instances/${t.id}`) },
  ]

  return (
    <div className="space-y-3">
      {tenants.map(t => (
        <MobileListCard key={t.id} ariaLabel={`Open ${t.display_name}`} onTap={() => setSelected(t)}>
          <p className="font-medium text-foreground truncate">{t.display_name}</p>
          <p className="mt-1 font-mono text-xs text-foreground-muted truncate">
            {t.rds_endpoint || <span className="text-amber-500">not provisioned</span>}
          </p>
          <p className="mt-1 text-xs text-foreground-secondary">
            {t.ec2_target || 'pool'} · {t.region || '—'}
          </p>
        </MobileListCard>
      ))}

      <MobileDetailSheet
        open={!!selected}
        onClose={() => setSelected(null)}
        title={selected?.display_name}
        footer={
          <button
            type="button"
            onClick={() => setActionsOpen(true)}
            className="w-full bg-accent-500 hover:bg-accent-600 text-white text-sm font-semibold py-3 rounded-lg transition-colors"
          >
            Actions
          </button>
        }
      >
        {selected && (
          <div className="px-5 py-3">
            <Field
              label="RDS endpoint"
              mono
              value={selected.rds_endpoint || <span className="text-amber-500">not provisioned</span>}
            />
            <Field label="EC2 target" value={selected.ec2_target || 'pool'} />
            <Field label="S3 bucket" mono value={selected.s3_bucket || '—'} />
            <Field label="Region" value={selected.region || '—'} />
          </div>
        )}
      </MobileDetailSheet>

      <MobileActionSheet
        open={actionsOpen && !!selected}
        onClose={() => setActionsOpen(false)}
        title={selected?.display_name}
        actions={selected ? actions(selected) : []}
      />
    </div>
  )
}
