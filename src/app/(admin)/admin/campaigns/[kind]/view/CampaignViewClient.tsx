'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { useHasScope } from '@/contexts/AdminScopesContext'
import { renderTemplate as renderVars, sampleVariableMap } from '@/lib/templates/variables-shared'
import { renderLayoutPreview, EMAIL_LAYOUT_OPTIONS } from '@/lib/templates/email-layouts'
import { renderBlocks, type EmailBlock } from '@/lib/templates/blocks'
import { campaignSupportsWhatsApp } from '@/lib/campaigns/whatsapp-kinds'
import { WhatsAppPreview } from '@/components/admin/campaigns/WhatsAppTemplateEditor'
import {
  type CampaignRow,
  getChannels,
  ChannelChip,
  CampaignStatsGrid,
} from '@/app/(admin)/admin/campaigns/_components/campaign-presentation'
import {
  EligibleRecipientsPanel,
  RecentSendsPanel,
  WhatsAppLogPanel,
  type RecentSend,
  type WhatsAppLog,
} from '@/app/(admin)/admin/campaigns/[kind]/_components/CampaignOpsPanels'

// Same sample values the editor preview uses, so the view mirrors what a recipient sees.
const SAMPLE_VARS: Record<string, string | number> = {
  firstName: 'Sample',
  productName: 'Sample Product',
  productImageUrl: 'https://placehold.co/280x280/e07b3f/ffffff?text=Product',
  itemsHtml: '',
  productCard: '',
  couponCode: 'SAVE10',
  discountPercent: 10,
  orderNumber: 'TEST-12345',
  ctaUrl: '#',
  productUrl: '#',
}

interface ViewCampaign extends CampaignRow {
  description: string | null
  subject_template: string
  body_template: string
  template_layout?: string | null
  template_mode?: string | null
  blocks?: EmailBlock[] | null
  sms_template?: string | null
  wa_template_sid?: string | null
  wa_variables?: Record<string, string> | null
  wa_header_image_url?: string | null
  parameters?: Record<string, unknown> | null
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border-default last:border-0">
      <span className="text-xs font-medium text-foreground-muted shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right break-words min-w-0">{value}</span>
    </div>
  )
}

export default function CampaignViewClient({ kind }: { kind: string }) {
  const canWrite = useHasScope('campaigns:write')
  const [c, setC] = useState<ViewCampaign | null>(null)
  const [recentSends, setRecentSends] = useState<RecentSend[]>([])
  const [sendsTotal, setSendsTotal] = useState(0)
  const [whatsappLogs, setWhatsappLogs] = useState<WhatsAppLog[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    ;(async () => {
      try {
        const res = await fetch(`/api/admin/campaigns/${kind}`, { credentials: 'include' })
        if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || `HTTP ${res.status}`)
        const data = await res.json()
        setC(data.campaign)
        setRecentSends(data.recentSends || [])
        setSendsTotal(data.total || 0)
        setWhatsappLogs(data.whatsappLogs || [])
      } catch (e: any) {
        setError(e?.message || 'Failed to load campaign')
      } finally {
        setLoading(false)
      }
    })()
  }, [kind])

  if (loading) return <div className="p-6 text-sm text-foreground-muted">Loading…</div>
  if (error || !c) return <div className="p-6 text-sm text-red-600">{error || 'Not found'}</div>

  const vars = { ...sampleVariableMap(), ...SAMPLE_VARS }
  const bodySource = c.template_mode === 'blocks' && c.blocks?.length ? renderBlocks(c.blocks) : c.body_template
  const previewSubject = renderVars(c.subject_template, vars)
  const previewDoc = renderVars(renderLayoutPreview(c.template_layout, renderVars(bodySource, vars)), vars)
  const smsPreview = c.sms_template ? renderVars(c.sms_template, vars) : ''
  const layoutLabel = EMAIL_LAYOUT_OPTIONS.find(l => l.key === c.template_layout)?.label ?? 'Classic'
  const waEnabled = campaignSupportsWhatsApp(kind) && !!c.parameters?.whatsappEnabled && !!c.wa_template_sid

  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 xl:grid-cols-2 gap-5">
        {/* Left: summary */}
        <div className="space-y-5">
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <div className="flex items-start justify-between gap-3 flex-wrap">
              <div>
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-xl font-bold text-foreground">{c.name}</h2>
                  <span
                    className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${c.enabled ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400'}`}
                  >
                    {c.enabled ? 'Active' : 'Paused'}
                  </span>
                  {getChannels(kind).map(ch => (
                    <ChannelChip key={ch} channel={ch} />
                  ))}
                </div>
                {c.description && <p className="text-sm text-foreground-secondary mt-1">{c.description}</p>}
              </div>
              {canWrite && (
                <Link
                  href={ap(`/admin/campaigns/${kind}/edit`)}
                  className="hidden md:inline-flex items-center gap-1.5 h-control-sm px-3 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-xs font-semibold"
                >
                  <Pencil className="w-3.5 h-3.5" /> Edit
                </Link>
              )}
            </div>

            <div className="mt-4">
              <Row label="Delay" value={`${c.delay_hours}h after trigger`} />
              <Row label="Discount" value={c.discount_percent ? `${c.discount_percent}%` : '—'} />
              <Row label="Email template" value={layoutLabel} />
              <Row label="Body mode" value={c.template_mode === 'blocks' ? 'Block builder' : 'Rich text'} />
              <Row label="Last run" value={c.last_run_at ? new Date(c.last_run_at).toLocaleString('en-IN') : 'never'} />
            </div>
          </div>

          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-3">Performance</h3>
            <CampaignStatsGrid c={c} />
          </div>

          {/* Operational panels — collapsed, stacked under the summary in the left column. */}
          <EligibleRecipientsPanel kind={kind} />
          <RecentSendsPanel kind={kind} initialSends={recentSends} initialTotal={sendsTotal} />
          <WhatsAppLogPanel kind={kind} logs={whatsappLogs} />
        </div>

        {/* Right: previews */}
        <div className="space-y-5">
          <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
            <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-3">Email</h3>
            <div className="border border-border-default rounded-lg overflow-hidden">
              <div className="px-4 py-2 bg-surface-secondary border-b border-border-default text-xs">
                <span className="text-foreground-muted">Subject:</span>{' '}
                <span className="font-semibold text-foreground">{previewSubject}</span>
              </div>
              <iframe
                title="Email preview"
                srcDoc={previewDoc}
                className="w-full rounded-b-lg border-0 bg-white"
                style={{ height: 520 }}
                sandbox=""
              />
            </div>
          </div>

          {smsPreview && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-3">SMS</h3>
              <div className="rounded-lg bg-surface-secondary p-3 text-sm text-foreground whitespace-pre-line">
                {smsPreview}
              </div>
            </div>
          )}

          {waEnabled && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-3">WhatsApp</h3>
              <WhatsAppPreview
                value={{
                  key: c.wa_template_sid ?? null,
                  variables: c.wa_variables ?? {},
                  headerImageUrl: c.wa_header_image_url ?? '',
                }}
                vars={vars}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
