'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { ExternalLink } from 'lucide-react'
import AdminSelect, { type SelectOption } from '@/components/admin/AdminSelect'
import { ap } from '@/lib/shared/admin-path'
import { useAdminHost } from '@/contexts/AdminHostContext'
import { recommendScore } from '@/lib/campaigns/template-hints'
import { missingRequired } from '@/lib/campaigns/kind-variables'

export type PickerChannel = 'email' | 'sms' | 'whatsapp'

type ListItem = { id: string; slug: string; name: string; category: string | null; channel: PickerChannel; approval_status?: string | null; source?: 'tenant' | 'platform' }

export type PickedTemplate = {
  id: string; slug: string; name: string; channel: PickerChannel
  subject: string | null; body: string; blocks: any; blocks_format: string | null
  variables: string[]; approval_status: string | null; media_type: string | null
}

const API = '/api/admin/messaging-templates'
const CHANNEL_NOUN: Record<PickerChannel, string> = { email: 'email', sms: 'SMS', whatsapp: 'WhatsApp' }
const strip = (s: string) => s.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim()

/** Picks a template from the messaging-templates library (linked by slug). */
export default function LibraryTemplatePicker({
  channel, value, onChange, kind, allowNone = true, noneLabel, supplied, onLoaded,
}: {
  channel: PickerChannel
  value: string | null
  onChange: (slug: string | null) => void
  /** Campaign kind — drives the Recommended group. */
  kind?: string | null
  allowNone?: boolean
  noneLabel?: string
  /** Variable names the caller can fill (or a predicate); others are flagged as "will be blank". */
  supplied?: Iterable<string> | ((name: string) => boolean)
  onLoaded?: (t: PickedTemplate | null) => void
}) {
  const host = useAdminHost()
  const [items, setItems] = useState<ListItem[] | null>(null)
  const [picked, setPicked] = useState<PickedTemplate | null>(null)

  useEffect(() => {
    let live = true
    fetch(`${API}?channel=${channel}`).then(r => (r.ok ? r.json() : { items: [] })).then(d => live && setItems(d.items ?? []))
      .catch(() => live && setItems([]))
    return () => { live = false }
  }, [channel])

  useEffect(() => {
    let live = true
    if (!value) { setPicked(null); onLoaded?.(null); return }
    fetch(`${API}/${channel}/${encodeURIComponent(value)}`).then(r => (r.ok ? r.json() : null)).then(a => {
      if (!live) return
      const v = a?.current_version ?? {}
      const t: PickedTemplate | null = a ? {
        id: a.id, slug: a.slug, name: a.name, channel: a.channel, subject: v.subject ?? null, body: v.body ?? '',
        blocks: v.blocks ?? null, blocks_format: v.blocks_format ?? null, variables: v.variables ?? [],
        approval_status: a.approval_status ?? null, media_type: a.media_type ?? null,
      } : null
      setPicked(t); onLoaded?.(t)
    }).catch(() => live && setPicked(null))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [channel, value])

  const options = useMemo<SelectOption[]>(() => {
    const list = items ?? []
    const blocked = (i: ListItem) =>
      channel === 'whatsapp' && i.approval_status !== 'approved'
        ? (i.approval_status === 'pending' || i.approval_status === 'received' ? 'Waiting for Meta approval' : 'Not approved by Meta yet')
        : undefined
    const opt = (i: ListItem, group: string): SelectOption => {
      const reason = blocked(i)
      return { value: i.slug, label: `${i.name}${i.source === 'tenant' ? ' · customised' : ''}`, group, disabled: !!reason, hint: reason ?? i.slug }
    }
    const scored = list.map(i => ({ i, s: recommendScore(kind, channel, i.slug) }))
    const rec = scored.filter(x => x.s > 0).sort((a, b) => b.s - a.s || a.i.name.localeCompare(b.i.name)).map(x => opt(x.i, 'Recommended'))
    const rest = scored.filter(x => x.s === 0)
      .sort((a, b) => (a.i.category ?? '').localeCompare(b.i.category ?? '') || a.i.name.localeCompare(b.i.name))
      .map(x => opt(x.i, (x.i.category ?? 'other').replace(/^\w/, c => c.toUpperCase())))
    return [
      ...(allowNone ? [{ value: '', label: noneLabel ?? `No ${CHANNEL_NOUN[channel]} template` }] : []),
      ...rec, ...rest,
    ]
  }, [items, kind, channel, allowNone, noneLabel])

  const unfilled = useMemo(() => {
    if (!picked || !supplied) return []
    const ok = typeof supplied === 'function' ? supplied : (n: string) => new Set(supplied).has(n)
    return picked.variables.filter(v => !/^\d+$/.test(v) && !ok(v))
  }, [picked, supplied])

  const lacking = picked && channel !== 'whatsapp' ? missingRequired(kind, channel, `${picked.subject ?? ''}\n${picked.body}`) : []

  if (items === null) return <div className="h-10 rounded-lg bg-surface-secondary animate-pulse" />

  return (
    <div className="space-y-2">
      <AdminSelect value={value ?? ''} options={options} onChange={v => onChange(v || null)} sm />
      {picked && (
        <div className="rounded-lg border border-border-default bg-surface-secondary/40 p-3 text-xs space-y-1.5">
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium text-foreground truncate">{picked.name}</span>
            <Link
              href={`${ap('/admin/marketing/messaging-templates', host)}?channel=${channel}&slug=${encodeURIComponent(picked.slug)}`}
              target="_blank"
              className="inline-flex items-center gap-1 text-accent-600 hover:text-accent-700 shrink-0"
            >
              Edit in Templates <ExternalLink className="w-3 h-3" />
            </Link>
          </div>
          {picked.subject && <p className="text-foreground-secondary"><span className="text-foreground-muted">Subject:</span> {picked.subject}</p>}
          <p className="text-foreground-secondary line-clamp-3">{strip(picked.body).slice(0, 320) || '—'}</p>
          {lacking.length > 0 && (
            <p className="text-red-600 dark:text-red-400">
              This template doesn&apos;t use {lacking.map(v => `{${v}}`).join(', ')}, which this campaign needs — add {lacking.length === 1 ? 'it' : 'them'} in the editor below or pick another template.
            </p>
          )}
          {unfilled.length > 0 && (
            <p className="text-yellow-700 dark:text-yellow-300">
              This campaign doesn&apos;t provide {unfilled.map(v => `{{${v}}}`).join(', ')} — {unfilled.length === 1 ? 'it' : 'they'} will be left blank.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
