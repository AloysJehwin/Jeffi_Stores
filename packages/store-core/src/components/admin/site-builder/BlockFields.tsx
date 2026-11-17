'use client'

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react'
import type { Block, FieldMeta } from '@jeffi/site-blocks'
import { INPUT_CLASS, Image as MediaImage, LABEL_CLASS, Select } from '@/components/admin/homepage/editors/fields'
import { siteRegistry } from '@/lib/site/blocks'

// The settings form for a block that is not a homepage section, generated from its definition's field metadata
// (text, long text, link, image, yes/no, select, and lists of links or of items such as questions and answers).

type Link = { label: string; href: string }

function LinkList({ value, canWrite, onChange }: { value: Link[]; canWrite: boolean; onChange: (v: Link[]) => void }) {
  const set = (i: number, patch: Partial<Link>) => onChange(value.map((l, j) => (j === i ? { ...l, ...patch } : l)))
  const move = (i: number, d: number) => {
    const next = [...value]
    const [l] = next.splice(i, 1)
    next.splice(i + d, 0, l)
    onChange(next)
  }
  return (
    <div className="space-y-2">
      {value.map((l, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input className={INPUT_CLASS} disabled={!canWrite} placeholder="Label" value={l.label} onChange={e => set(i, { label: e.target.value })} />
          <input className={INPUT_CLASS} disabled={!canWrite} placeholder="/path or https://" value={l.href} onChange={e => set(i, { href: e.target.value })} />
          {canWrite && (
            <span className="flex shrink-0">
              <button type="button" className="p-1 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" className="p-1 disabled:opacity-30" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button type="button" className="p-1 text-red-600" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove link">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </span>
          )}
        </div>
      ))}
      {canWrite && (
        <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-accent-600" onClick={() => onChange([...value, { label: 'New link', href: '/' }])}>
          <Plus className="w-3.5 h-3.5" /> Add link
        </button>
      )}
    </div>
  )
}

type Item = Record<string, string>

/** A list of items with their own fields (questions and answers, say). */
function ItemList({ value, item, canWrite, onChange }: { value: Item[]; item: NonNullable<FieldMeta['item']>; canWrite: boolean; onChange: (v: Item[]) => void }) {
  const set = (i: number, key: string, v: string) => onChange(value.map((x, j) => (j === i ? { ...x, [key]: v } : x)))
  const move = (i: number, d: number) => {
    const next = [...value]
    const [x] = next.splice(i, 1)
    next.splice(i + d, 0, x)
    onChange(next)
  }
  return (
    <div className="space-y-2">
      {value.map((x, i) => (
        <div key={i} className="rounded-lg border border-border-default p-2 space-y-1.5">
          {item.map(f =>
            f.kind === 'richtext' ? (
              <textarea key={f.key} className={`${INPUT_CLASS} min-h-16`} disabled={!canWrite} placeholder={f.label} value={x[f.key] ?? ''} onChange={e => set(i, f.key, e.target.value)} />
            ) : (
              <input key={f.key} className={INPUT_CLASS} disabled={!canWrite} placeholder={f.label} value={x[f.key] ?? ''} onChange={e => set(i, f.key, e.target.value)} />
            )
          )}
          {canWrite && (
            <div className="flex gap-1">
              <button type="button" className="p-1 disabled:opacity-30" disabled={i === 0} onClick={() => move(i, -1)} aria-label="Move up">
                <ArrowUp className="w-3.5 h-3.5" />
              </button>
              <button type="button" className="p-1 disabled:opacity-30" disabled={i === value.length - 1} onClick={() => move(i, 1)} aria-label="Move down">
                <ArrowDown className="w-3.5 h-3.5" />
              </button>
              <button type="button" className="ml-auto p-1 text-red-600" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove">
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
      ))}
      {canWrite && (
        <button
          type="button"
          className="inline-flex items-center gap-1 text-xs font-medium text-accent-600"
          onClick={() => onChange([...value, Object.fromEntries(item.map(f => [f.key, f.key === item[0].key ? 'New item' : '']))])}
        >
          <Plus className="w-3.5 h-3.5" /> Add
        </button>
      )}
    </div>
  )
}

export default function BlockFields({ block, canWrite, onChange }: { block: Block; canWrite: boolean; onChange: (b: Block) => void }) {
  const def = siteRegistry.get(block.type)
  const fields = Object.entries(def?.fields ?? {}) as [string, FieldMeta][]
  const set = (key: string, value: unknown) => onChange({ ...block, props: { ...block.props, [key]: value } })
  return (
    <div className="space-y-3">
      {fields.map(([key, f]) => {
        const label = f.label ?? key
        const v = block.props[key]
        if (f.kind === 'list') return (
          <div key={key}>
            <span className={LABEL_CLASS}>{label}</span>
            {f.item ? (
              <ItemList value={Array.isArray(v) ? (v as Item[]) : []} item={f.item} canWrite={canWrite} onChange={next => set(key, next)} />
            ) : (
              <LinkList value={Array.isArray(v) ? (v as Link[]) : []} canWrite={canWrite} onChange={next => set(key, next)} />
            )}
          </div>
        )
        if (f.kind === 'image') return <MediaImage key={key} label={label} value={String(v ?? '')} size={f.size ?? 'wide'} disabled={!canWrite} onCommit={url => set(key, url || null)} />
        if (f.kind === 'boolean') return (
          <label key={key} className="flex items-center justify-between gap-3 text-sm">
            <span className="text-foreground">{label}</span>
            <input type="checkbox" disabled={!canWrite} checked={v !== false} onChange={e => set(key, e.target.checked)} />
          </label>
        )
        if (f.kind === 'richtext') return (
          <label key={key} className="block">
            <span className={LABEL_CLASS}>{label}</span>
            <textarea className={`${INPUT_CLASS} min-h-28`} disabled={!canWrite} value={String(v ?? '')} onChange={e => set(key, e.target.value)} />
          </label>
        )
        if (f.kind === 'select') return <Select key={key} label={label} value={String(v ?? '')} options={f.options ?? []} disabled={!canWrite} onChange={next => set(key, next)} />
        return (
          <label key={key} className="block">
            <span className={LABEL_CLASS}>{label}</span>
            <input
              className={INPUT_CLASS}
              disabled={!canWrite}
              value={String(v ?? '')}
              placeholder={f.kind === 'link' ? '/path or https://' : undefined}
              onChange={e => set(key, f.kind === 'link' && !e.target.value ? null : e.target.value)}
            />
          </label>
        )
      })}
    </div>
  )
}
