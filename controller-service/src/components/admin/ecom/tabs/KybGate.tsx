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

/**
 * What the gate found missing, per service, with "Approve anyway" behind the confirm dialog. `labels` renames a
 * service for this workspace (a store application on one with no store); `cancelLabel` says what backing out leaves.
 */
export function KybBlocked({
  block,
  onForce,
  onCancel,
  forceLabel = 'Approve anyway',
  cancelLabel = 'Keep in review',
  labels = {},
}: {
  block: KybBlock
  onForce: () => Promise<void>
  onCancel: () => void
  forceLabel?: string
  cancelLabel?: string
  labels?: Partial<Record<string, string>>
}) {
  const services = Object.entries(block.missing)
  const name = (s: string) => labels[s] ?? SERVICE_LABEL[s as KybService] ?? s
  // Named from the services the gate checked, not the owner-facing message (which names only the first).
  const names = services.map(([s]) => name(s))
  const headline = names.length
    ? `The KYB isn’t complete for ${names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0]}.`
    : block.error || 'The business’s KYB isn’t complete.'
  // Full width under the row it blocks: what is missing on the left, the two choices stacked on the right.
  return (
    <div role="alert" className="w-full min-w-0 rounded-xl border border-amber-500/40 bg-amber-500/5 p-4 text-sm sm:p-5">
      <div className="flex flex-col gap-4 md:flex-row md:items-start md:justify-between md:gap-6">
        <div className="min-w-0 flex-1">
          <p className="font-medium text-foreground break-words">{headline}</p>
          {services.length > 0 && (
            <ul className={`mt-3 grid gap-3 ${services.length > 1 ? 'sm:grid-cols-2' : ''}`}>
              {services.map(([s, items]) => (
                <li key={s} className="min-w-0">
                  <span className="font-medium text-foreground">{name(s)}</span>
                  <ul className="mt-1 space-y-1 text-foreground-muted">
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
        </div>
        <div className="flex flex-wrap gap-2 md:w-52 md:shrink-0 md:flex-col md:items-stretch">
          <ActionButton
            size="lg"
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
          <ActionButton size="lg" action={{ label: cancelLabel, onClick: onCancel }} />
        </div>
      </div>
    </div>
  )
}
