'use client'

import { useState, type ReactNode } from 'react'
import { ChevronRight } from 'lucide-react'
import type { TemplateFillButton, TemplateScenarioFill } from '@/lib/ai/template-scenario.schema'
import type { EditorFieldSnapshot } from '@/lib/ai/scenario-fill-apply'

type Channel = 'whatsapp' | 'sms' | 'email'

interface Props {
  channel: Channel
  current: EditorFieldSnapshot
  proposed: TemplateScenarioFill
}

interface Row {
  key: string
  label: string
  before: string
  after: string
  mono?: boolean
}

function formatButtons(bs: TemplateFillButton[] | undefined): string {
  if (!bs || bs.length === 0) return ''
  return bs.map(b => `${b.type.padEnd(12)} ${b.label}${b.value ? ' → ' + b.value : ''}`).join('\n')
}

function rowsFor(channel: Channel, current: EditorFieldSnapshot, proposed: TemplateScenarioFill): Row[] {
  const rows: Row[] = [
    { key: 'name', label: 'Name', before: current.name || '', after: proposed.name || '' },
  ]
  if (channel === 'email') {
    rows.push({ key: 'subject', label: 'Subject', before: current.subject || '', after: proposed.subject || '' })
    rows.push({ key: 'preview', label: 'Preview', before: current.preview || '', after: proposed.preview || '' })
  }
  rows.push({ key: 'body', label: 'Body', before: current.body || '', after: proposed.body || '' })
  rows.push({
    key: 'placeholders',
    label: 'Placeholders',
    before: (current.placeholders || []).join('\n'),
    after: (proposed.placeholders || []).join('\n'),
    mono: true,
  })
  if (channel !== 'sms') {
    rows.push({
      key: 'buttons',
      label: 'Buttons',
      before: formatButtons(current.buttons),
      after: formatButtons(proposed.buttons),
      mono: true,
    })
  }
  if (channel !== 'sms' && (current.image_url || proposed.image_url)) {
    rows.push({
      key: 'image',
      label: 'Header image',
      before: current.image_url || '',
      after: proposed.image_url || '',
      mono: true,
    })
  }
  return rows
}

/** Side-by-side current vs proposed per field. Changed rows open by default; unchanged rows collapse. */
export default function ScenarioFillDiff({ channel, current, proposed }: Props) {
  const rows = rowsFor(channel, current, proposed)
  return (
    <div className="space-y-2">
      {rows.map(row => (
        <DiffRow key={row.key} row={row} />
      ))}
    </div>
  )
}

function DiffRow({ row }: { row: Row }) {
  const changed = row.before !== row.after
  const [open, setOpen] = useState(changed)
  const cellBase = row.mono ? 'font-mono text-[11px] leading-snug' : 'text-xs leading-snug'
  return (
    <div className="rounded-lg border border-border-default bg-surface">
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-medium text-foreground-secondary hover:bg-surface-secondary"
      >
        <span className="flex items-center gap-1.5">
          <ChevronRight className={`h-3.5 w-3.5 shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
          {row.label}
        </span>
        <span
          className={`text-[10px] uppercase tracking-wide ${changed ? 'text-amber-600 dark:text-amber-400' : 'text-foreground-muted'}`}
        >
          {changed ? 'changed' : 'unchanged'}
        </span>
      </button>
      {open && (
        <div className="grid gap-2 border-t border-border-default p-3 sm:grid-cols-2">
          <DiffCell label="Current" value={row.before} tone={changed ? 'before' : 'muted'} cls={cellBase} />
          <DiffCell label="Proposed" value={row.after} tone={changed ? 'after' : 'muted'} cls={cellBase} />
        </div>
      )}
    </div>
  )
}

function DiffCell({ label, value, tone, cls }: { label: string; value: string; tone: 'before' | 'after' | 'muted'; cls: string }) {
  const paint =
    tone === 'before'
      ? 'bg-rose-500/5 text-rose-700 dark:text-rose-400'
      : tone === 'after'
        ? 'bg-emerald-500/5 text-emerald-700 dark:text-emerald-400'
        : 'bg-surface-secondary text-foreground-secondary'
  const content: ReactNode = value ? value : <em className="not-italic text-foreground-muted">empty</em>
  return (
    <div>
      <div className="mb-1 text-[10px] uppercase tracking-wide text-foreground-muted">{label}</div>
      <pre className={`whitespace-pre-wrap break-words rounded-md px-2 py-1.5 ${paint} ${cls}`}>{content}</pre>
    </div>
  )
}
