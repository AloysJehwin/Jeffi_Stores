'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { Pencil } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { useHasScope } from '@/contexts/AdminScopesContext'
import { useMessagingChannels } from '@/hooks/useStoreFlags'
import { renderTemplate as renderVars, sampleVariableMap } from '@/lib/templates/variables-shared'
import { renderLayoutPreview, EMAIL_LAYOUT_OPTIONS } from '@/lib/templates/email-layouts'
import { renderBlocks, type EmailBlock } from '@/lib/templates/blocks'
import { campaignSupportsWhatsApp } from '@/lib/campaigns/whatsapp-kinds'
import { WhatsAppPreview } from '@/components/admin/campaigns/WhatsAppTemplateEditor'
import { PushPreview } from '@/components/admin/campaigns/PushEditor'
import { campaignSupportsPush, scenarioPushCopy } from '@/lib/campaigns/push-kinds'
import { CampaignDetailSkeleton, CampaignPageSkeleton } from '@/components/admin/campaigns/CampaignSkeletons'
import { ViewDraftLink } from '@/components/admin/kit/draft-lock'
import {
  type CampaignRow,
  getChannels,
  ChannelChip,
  CampaignStatsGrid,
  CampaignPushStats,
} from '@controller/app/(admin)/admin/campaigns/_components/campaign-presentation'
import {
  EligibleRecipientsPanel,
  RecentSendsPanel,
  WhatsAppLogPanel,
  type RecentSend,
  type WhatsAppLog,
} from '@controller/app/(admin)/admin/campaigns/[kind]/_components/CampaignOpsPanels'
import { startCampaignDraft } from './actions'
import { ChangeLog } from '@/components/admin/change-log'

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
  sms_template_slug?: string | null
  wa_template_sid?: string | null
  wa_template_slug?: string | null
  wa_variables?: Record<string, string> | null
  wa_header_image_url?: string | null
  parameters?: Record<string, unknown> | null
  scenario_kind?: string | null
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 py-2 border-b border-border-default last:border-0">
      <span className="text-xs font-medium text-foreground-muted shrink-0">{label}</span>
      <span className="text-sm text-foreground text-right break-words min-w-0">{value}</span>
    </div>
  )
}

export default function CampaignViewClient({
  kind,
  hasDraftInitial = false,
  heldDraft,
}: {
  kind: string
  hasDraftInitial?: boolean
  /** Another admin holds the draft: open it read-only instead of starting one. */
  heldDraft?: { ownerName: string; href: string } | null
}) {
  const canWrite = useHasScope('campaigns:write')
  const msg = useMessagingChannels()
  const [c, setC] = useState<ViewCampaign | null>(null)
  const [recentSends, setRecentSends] = useState<RecentSend[]>([])
  const [sendsTotal, setSendsTotal] = useState(0)
  const [whatsappLogs, setWhatsappLogs] = useState<WhatsAppLog[]>([])
  const [smsLibraryBody, setSmsLibraryBody] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  // Server-side seed; refreshed from the API payload once it lands.
  const [hasDraft, setHasDraft] = useState(hasDraftInitial)

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
        // Keep the badge/Edit variant in step with the live draft state even after the user
        // publishes-and-returns within the same mount.
        const df = data.campaign?.draft_fields
        setHasDraft(!!df && typeof df === 'object' && Object.keys(df).length > 0)
      } catch (e: any) {
        setError(e?.message || 'Failed to load campaign')
      } finally {
        setLoading(false)
      }
    })()
  }, [kind])

  // SMS body can come from a linked library template (slug) instead of an inline template.
  useEffect(() => {
    const slug = c?.sms_template_slug
    if (!slug) {
      setSmsLibraryBody(null)
      return
    }
    fetch(`/api/admin/messaging-templates/sms/${encodeURIComponent(slug)}`, { credentials: 'include' })
      .then(r => (r.ok ? r.json() : null))
      .then(a => setSmsLibraryBody(a?.current_version?.body ?? null))
      .catch(() => {})
  }, [c?.sms_template_slug])

  if (loading)
    return (
      <CampaignPageSkeleton>
        <CampaignDetailSkeleton />
      </CampaignPageSkeleton>
    )
  if (error || !c) return <div className="p-6 text-sm text-red-600">{error || 'Not found'}</div>

  const vars = { ...sampleVariableMap(), ...SAMPLE_VARS }
  const bodySource = c.template_mode === 'blocks' && c.blocks?.length ? renderBlocks(c.blocks) : c.body_template
  const previewSubject = renderVars(c.subject_template, vars)
  const previewDoc = renderVars(renderLayoutPreview(c.template_layout, renderVars(bodySource, vars)), vars)
  // SMS preview: linked library template wins, else the inline template.
  const smsSource = c.sms_template?.trim() || smsLibraryBody || ''
  const smsEnabled = msg.sms && (!!c.parameters?.smsEnabled || !!c.sms_template?.trim())
  const smsPreview = smsEnabled && smsSource ? renderVars(smsSource, vars) : ''
  const layoutLabel = EMAIL_LAYOUT_OPTIONS.find(l => l.key === c.template_layout)?.label ?? 'Classic'
  const waEnabled =
    msg.whatsapp && campaignSupportsWhatsApp(kind) && !!c.parameters?.whatsappEnabled && !!c.wa_template_slug
  const pushKind = campaignSupportsPush(kind) ? kind : (c.scenario_kind ?? '')
  const pushEnabled = campaignSupportsPush(pushKind) && c.parameters?.pushEnabled === true
  const pushCopy = scenarioPushCopy(pushKind, c.parameters)
  const pushHistory = ['push_sent', 'push_waiting', 'push_skipped', 'push_failed'].some(k => Number((c as any)[k] ?? 0) > 0)

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
                    className={`px-2 py-0.5 text-[10px] font-semibold rounded-full ${c.enabled ? 'bg-green-500/10 text-green-700 dark:text-green-400' : 'bg-surface-secondary text-foreground-muted '}`}
                  >
                    {c.enabled ? 'Active' : 'Paused'}
                  </span>
                  {getChannels(kind, c.parameters, c.scenario_kind, msg).map(ch => (
                    <ChannelChip key={ch} channel={ch} />
                  ))}
                  {hasDraft && (
                    <span className="px-2 py-0.5 text-[10px] font-semibold rounded-full bg-amber-500/10 text-amber-700 dark:text-amber-400">
                      Draft pending
                    </span>
                  )}
                </div>
                {c.description && <p className="text-sm text-foreground-secondary mt-1">{c.description}</p>}
              </div>
              {heldDraft ? (
                <span className="hidden md:inline-flex">
                  <ViewDraftLink held={heldDraft} compact />
                </span>
              ) : canWrite &&
                (hasDraft ? (
                  <Link
                    href={ap(`/admin/campaigns/${kind}/edit`)}
                    className="hidden md:inline-flex items-center gap-1.5 h-control-sm px-3 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-xs font-semibold"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit Draft
                  </Link>
                ) : (
                  <form action={startCampaignDraft.bind(null, kind)} className="hidden md:block">
                    <button
                      type="submit"
                      className="inline-flex items-center gap-1.5 h-control-sm px-3 rounded-lg bg-accent-500 hover:bg-accent-600 text-white text-xs font-semibold"
                    >
                      <Pencil className="w-3.5 h-3.5" /> Edit
                    </button>
                  </form>
                ))}
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
            {(pushEnabled || pushHistory) && (
              <div className="mt-4 pt-4 border-t border-border-default">
                <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted mb-2">App push</p>
                <CampaignPushStats c={c} />
              </div>
            )}
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
                className="w-full rounded-b-lg border-0 bg-surface-elevated"
                style={{ height: 520 }}
                sandbox=""
              />
            </div>
          </div>

          {smsPreview && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-3">SMS</h3>
              <div className="rounded-lg bg-surface-secondary p-3 text-sm text-foreground whitespace-pre-line break-words">
                {smsPreview}
              </div>
            </div>
          )}

          {waEnabled && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-3">WhatsApp</h3>
              <WhatsAppPreview
                value={{ slug: c.wa_template_slug ?? null, variables: c.wa_variables ?? {} }}
                vars={vars}
              />
            </div>
          )}

          {pushEnabled && (
            <div className="bg-surface-elevated rounded-xl border border-border-default p-5">
              <h3 className="text-sm font-semibold text-foreground-muted uppercase tracking-widest mb-3">App push</h3>
              <PushPreview
                title={pushCopy.title}
                body={pushCopy.body}
                image={pushKind === 'birthday' ? null : String(SAMPLE_VARS.productImageUrl)}
                vars={{ ...vars, items: 'Sample Product and 1 more', headline: 'Sample Product is now ₹799' }}
              />
            </div>
          )}
        </div>
      </div>

      <ChangeLog kind="campaign" id={kind} version={c.updated_at} />
    </div>
  )
}
