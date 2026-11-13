'use client'

import { useState, type ReactNode } from 'react'
import { CheckCircle, Loader2, Sparkles, XCircle } from 'lucide-react'
import { RequireWrite } from '@/contexts/AdminScopesContext'
import { Card, Dialog, StatusBadge, useActionToast, type StatusMap } from '@/components/admin/kit'
import { LoadingLines } from '@/components/admin/kit/skeleton'
import { useEnrichment } from './hooks'
import { ProposedFills } from '@/components/admin/enrichment/ProposedFills'

const ENRICHMENT_STATUS: StatusMap = {
  proposed: { label: 'proposed', tone: 'amber' },
  approved: { label: 'approved', tone: 'green' },
  rejected: { label: 'rejected', tone: 'red' },
}

function Fact({ label, children, className = '', danger }: { label: ReactNode; children: ReactNode; className?: string; danger?: boolean }) {
  return (
    <div className={className}>
      <p className={`mb-1 text-[11px] uppercase tracking-wide ${danger ? 'text-red-600 dark:text-red-400' : 'text-foreground-muted'}`}>{label}</p>
      {children}
    </div>
  )
}

function Tags({ label, tags, accent, className }: { label: string; tags?: string[] | null; accent?: boolean; className?: string }) {
  if (!tags || tags.length === 0) return null
  return (
    <Fact
      className={className}
      label={
        <>
          {label} ({tags.length})
        </>
      }
    >
      <div className="flex flex-wrap gap-1">
        {tags.map(t => (
          <span key={t} className={`rounded px-1.5 py-0.5 text-[10px] ${accent ? 'bg-accent-500/5 text-accent-500' : 'bg-surface-secondary text-foreground-secondary'}`}>
            {t}
          </span>
        ))}
      </div>
    </Fact>
  )
}

/** The enrichment proposal for a product, with approve / reject while it is still proposed. */
export function AiEnrichmentDialog({ productId, onClose, onApproved }: { productId: string; onClose: () => void; onApproved: () => void }) {
  const [item, setItem] = useEnrichment(productId)
  const [busy, setBusy] = useState(false)
  const toast = useActionToast()

  async function decide(action: 'approve' | 'reject') {
    if (!item) return
    setBusy(true)
    try {
      const res = await fetch(`/api/admin/catalog-enrichment/${item.id}/${action}`, {
        method: 'POST',
        credentials: 'include',
      })
      if (!res.ok) {
        toast.error(`Failed to ${action} enrichment`)
        throw new Error('Failed')
      }
      toast.success(action === 'approve' ? 'Enrichment approved' : 'Enrichment rejected')
      if (action === 'approve') onApproved()
      else setItem((prev: any) => (prev ? { ...prev, status: 'rejected' } : prev))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onClose={onClose}
      zIndex="z-[400]"
      size="md"
      title={
        <span className="inline-flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-accent-500" />
          AI Enrichment
        </span>
      }
      footer={
        item?.status === 'proposed' ? (
          <RequireWrite scope="products:write">
            <div className="flex w-full gap-2">
              <button
                onClick={() => decide('approve')}
                disabled={busy}
                className="control-md flex-1 bg-accent-500 font-semibold text-white hover:bg-accent-600 disabled:opacity-50"
              >
                {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCircle className="h-3.5 w-3.5" />}
                Approve
              </button>
              <button
                onClick={() => decide('reject')}
                disabled={busy}
                className="control-md flex-1 border border-border-default font-semibold text-foreground hover:bg-surface-secondary disabled:opacity-50"
              >
                <XCircle className="h-3.5 w-3.5" />
                Reject
              </button>
            </div>
          </RequireWrite>
        ) : undefined
      }
    >
      {item === undefined && (
        <div className="py-6">
          <LoadingLines lines={6} />
        </div>
      )}

      {item === null && <div className="py-12 text-center text-sm text-foreground-muted">No enrichment found for this product.</div>}

      {item && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <StatusBadge status={item.status} map={ENRICHMENT_STATUS} label={item.status} />
            <span className="text-[10px] text-foreground-muted">
              {item.model} · {new Date(item.proposed_at).toLocaleDateString()}
            </span>
          </div>
          {item.ai_product_type && (
            <Fact label="Type">
              <span className="text-xs font-medium text-accent-500">{item.ai_product_type}</span>
            </Fact>
          )}
          {item.ai_description && (
            <Fact label="AI Description">
              <p className="text-xs leading-relaxed text-foreground">{item.ai_description}</p>
            </Fact>
          )}
          {item.source_desc && (
            <Fact label="Original Description">
              <p className="text-xs leading-relaxed text-foreground-muted">{item.source_desc}</p>
            </Fact>
          )}
          {item.ai_application && (
            <Fact label="Application">
              <p className="text-xs text-foreground">{item.ai_application}</p>
            </Fact>
          )}
          {item.ai_who_uses_it && (
            <Fact label="Who Uses It">
              <p className="text-xs text-foreground">{item.ai_who_uses_it}</p>
            </Fact>
          )}
          <Tags label="Use Cases" tags={item.ai_use_cases} accent />
          <Tags label="Keywords" tags={item.ai_keywords} />
          <Tags label="Features" tags={item.ai_features} />
          <Tags label="Search Tags" tags={item.ai_search_tags} />
          <ProposedFills item={item} />
          {item.error && (
            <Fact label="Embed Error" danger>
              <p className="text-xs text-red-600 dark:text-red-400">{item.error}</p>
            </Fact>
          )}
        </div>
      )}
    </Dialog>
  )
}

/** Approved enrichment already on the product; null when it has none. */
export function AiIntelligenceCard({ p }: { p: any }) {
  const hasAi =
    p.ai_description ||
    p.ai_product_type ||
    p.ai_use_cases?.length ||
    p.ai_keywords?.length ||
    p.ai_features?.length ||
    p.ai_search_tags?.length ||
    p.ai_who_uses_it ||
    p.ai_application
  if (!hasAi) return null
  return (
    <Card title="AI Intelligence">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        {p.ai_product_type && (
          <Fact label="Type">
            <span className="text-xs font-medium text-accent-500">{p.ai_product_type}</span>
          </Fact>
        )}
        {p.ai_description && (
          <Fact label="AI Description" className="sm:col-span-2">
            <p className="text-xs leading-relaxed text-foreground">{p.ai_description}</p>
          </Fact>
        )}
        {p.ai_application && (
          <Fact label="Application">
            <p className="text-xs text-foreground">{p.ai_application}</p>
          </Fact>
        )}
        {p.ai_who_uses_it && (
          <Fact label="Who Uses It">
            <p className="text-xs text-foreground">{p.ai_who_uses_it}</p>
          </Fact>
        )}
        <Tags label="Use Cases" tags={p.ai_use_cases} accent />
        <Tags label="Keywords" tags={p.ai_keywords} />
        <Tags label="Features" tags={p.ai_features} />
        <Tags label="Search Tags" tags={p.ai_search_tags} />
      </div>
    </Card>
  )
}
