'use client'

import { Check } from 'lucide-react'
import { ActionButton, StatusBadge, type StatusMap } from '@/components/admin/kit'
import { SERVICE_LABEL, type KybService } from '@controller/lib/kyb/requirements'

// KYB at the approval buttons: where a service stands, and the 409 an approval route answers while it isn't complete.

/** ready: the owner has done everything (documents may wait for review); verified: all of it is checked. */
export interface KybReadiness {
  ready: boolean
  verified: boolean
  todo: { label: string; problem?: string }[]
}

type Miss = { item: string; label: string; problem?: string }

export interface KybBlock {
  error: string
  missing: Record<string, Miss[]>
}

const READINESS: StatusMap = {
  verified: { label: 'KYB verified', tone: 'green' },
  ready: { label: 'KYB complete', tone: 'blue' },
  todo: { label: 'KYB incomplete', tone: 'amber' },
}

export function KybBadge({ readiness: r }: { readiness?: KybReadiness }) {
  if (!r) return null
  const state = r.verified ? 'verified' : r.ready ? 'ready' : 'todo'
  const title = r.todo.length
    ? `To do: ${r.todo.map(t => t.label).join(', ')}`
    : r.verified
      ? 'Everything is verified.'
      : 'Everything is in; some documents are waiting for review.'
  return <StatusBadge status={state} map={READINESS} label={state === 'todo' ? `KYB: ${r.todo.length} to do` : undefined} title={title} />
}

/** An approval route's 409 for a service whose KYB isn't complete, or null for any other answer. */
export function kybBlock(status: number | undefined, data: unknown): KybBlock | null {
  const d = data as { canForce?: unknown; error?: unknown; missing?: unknown } | null
  if (status !== 409 || d?.canForce !== true) return null
  const missing: Record<string, Miss[]> = {}
  if (d.missing && typeof d.missing === 'object')
    for (const [s, items] of Object.entries(d.missing as Record<string, unknown>)) if (Array.isArray(items) && items.length) missing[s] = items as Miss[]
  return { error: typeof d.error === 'string' ? d.error : '', missing }
}

/** What the gate found missing, with "Approve anyway" behind the confirm dialog. */
export function KybBlocked({
  block,
  onForce,
  onCancel,
  forceLabel = 'Approve anyway',
}: {
  block: KybBlock
  onForce: () => Promise<void>
  onCancel: () => void
  forceLabel?: string
}) {
  const services = Object.entries(block.missing)
  return (
    <div role="alert" className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs min-w-0">
      <p className="font-medium text-foreground break-words">{block.error || 'The business’s KYB isn’t complete.'}</p>
      {services.length > 0 && (
        <ul className="mt-2 space-y-1.5">
          {services.map(([s, items]) => (
            <li key={s} className="min-w-0">
              <span className="font-medium text-foreground">{SERVICE_LABEL[s as KybService] ?? s}</span>
              <ul className="mt-0.5 space-y-0.5 text-foreground-muted">
                {items.map(m => (
                  <li key={m.item} className="break-words">
                    {m.label}
                    {m.problem ? `: ${m.problem}` : ''}
                  </li>
                ))}
              </ul>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <ActionButton
          action={{
            label: forceLabel,
            icon: Check,
            danger: true,
            onClick: onForce,
            confirm: {
              title: `${forceLabel}?`,
              message: 'The KYB isn’t complete. Do this only for a business you have verified another way. What is missing stays on the owner’s Business verification page.',
              confirmLabel: forceLabel,
              variant: 'danger',
            },
          }}
        />
        <ActionButton action={{ label: 'Cancel', onClick: onCancel }} />
      </div>
    </div>
  )
}
