'use client'

import { useState } from 'react'
import type { Block, PageRef } from '@jeffi/site-blocks'
import { api } from '@/components/admin/kit/core'
import { useToast } from '@/contexts/ToastContext'
import { useCanWrite } from '@/contexts/AdminScopesContext'
import { INPUT_CLASS } from '@/components/admin/homepage/editors/fields'
import { cleanTree, updateNode, walkTree, type ComposedNode } from '@/lib/site/composed'

const DATA_LABEL: Record<string, (n: any) => string> = {
  products: n =>
    `Products: ${[n.query.category && `in ${n.query.category}`, n.query.brand && `by ${n.query.brand}`, n.query.search && `matching "${n.query.search}"`, n.query.onSale && 'on sale', n.query.slugs?.length && `${n.query.slugs.length} picked`].filter(Boolean).join(', ') || 'all'}, ${n.query.sort.replace('_', ' ')}, up to ${n.query.limit}`,
  categories: n => `Categories: ${n.query.slugs?.length ? n.query.slugs.join(', ') : n.query.parent ? `under ${n.query.parent}` : 'top level'}, up to ${n.query.limit}`,
  brands: n => `Brands: ${n.query.slugs?.length ? n.query.slugs.join(', ') : n.query.featured ? 'featured' : 'all'}, up to ${n.query.limit}`,
  review: n => `Reviews: ${n.query.minRating}★ and up${n.query.productSlug ? ` for ${n.query.productSlug}` : ''}, up to ${n.query.limit}`,
  offers: n => `Live offers, up to ${n.query.limit}`,
}

/**
 * A composed block in the inspector: its words, links and pictures to edit in place, what each data part shows (the
 * AI changes those), and "Save to my blocks" for reuse on other pages.
 */
export default function ComposedEditor({
  block,
  pageRef,
  onChange,
  onSaved,
}: {
  block: Block
  pageRef: Pick<PageRef, 'audience' | 'surface' | 'page'>
  onChange: (next: Block) => void
  onSaved?: () => void
}) {
  const canWrite = useCanWrite('settings:write')
  const { showToast } = useToast()
  const [saving, setSaving] = useState(false)
  // The raw tree while editing (a field cleared mid-typing must not vanish); it is cleaned when saved and rendered.
  const raw = block.props.tree
  const tree = raw && typeof raw === 'object' && (raw as ComposedNode).kind ? (raw as ComposedNode) : cleanTree(raw).tree
  if (!tree) return <p className="text-sm text-foreground-muted">This block is empty. Ask the AI on the AI tab to build it.</p>

  const set = (path: string, patch: Record<string, unknown>) =>
    onChange({ ...block, props: { ...block.props, tree: updateNode(tree, path, n => ({ ...n, ...patch }) as ComposedNode) } })

  const rows: { path: string; node: ComposedNode }[] = []
  walkTree(tree, (node, path) => rows.push({ path, node }))
  const field = (path: string, label: string, key: string, value: string, multiline = false) => (
    <label key={`${path}:${key}`} className="block space-y-1">
      <span className="text-xs text-foreground-muted">{label}</span>
      {multiline ? (
        <textarea className={`${INPUT_CLASS} min-h-20`} disabled={!canWrite} value={value} onChange={e => set(path, { [key]: e.target.value })} />
      ) : (
        <input className={INPUT_CLASS} disabled={!canWrite} value={value} onChange={e => set(path, { [key]: e.target.value })} />
      )}
    </label>
  )

  async function save() {
    setSaving(true)
    const id = crypto.randomUUID()
    const { ok, data } = await api<{ error?: string }>('/api/admin/site-builder/templates', {
      method: 'POST',
      json: {
        name: String(block.props.label || 'Custom block').slice(0, 120),
        kind: 'block',
        pages: [{ audience: pageRef.audience, surface: pageRef.surface, page: pageRef.page, doc: { blocks: { [id]: { ...block, id } }, order: [id] } }],
      },
    })
    setSaving(false)
    if (ok) onSaved?.()
    showToast(ok ? 'Saved to My blocks (Add → My blocks)' : data.error || 'Could not save the block', ok ? 'success' : 'error')
  }

  return (
    <div className="space-y-3">
      <div className="rounded-lg border border-border-default p-3 space-y-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Words, links and pictures</p>
        {rows.map(({ path, node: n }) => {
          switch (n.kind) {
            case 'heading':
              return field(path, `Heading ${n.level}`, 'text', n.text)
            case 'text':
              return field(path, 'Text', 'text', n.text, true)
            case 'button':
              return (
                <div key={path} className="grid grid-cols-2 gap-2">
                  {field(path, 'Button', 'label', n.label)}
                  {field(path, 'Link', 'href', n.href)}
                </div>
              )
            case 'badge':
              return field(path, 'Badge', 'text', n.text)
            case 'image':
              return field(path, 'Image URL', 'src', n.src)
            case 'countdown':
              return field(path, 'Countdown ends (date and time)', 'endsAt', n.endsAt)
            case 'marquee':
              return (
                <label key={path} className="block space-y-1">
                  <span className="text-xs text-foreground-muted">Scrolling text (one per line)</span>
                  <textarea className={`${INPUT_CLASS} min-h-20`} disabled={!canWrite} value={n.items.join('\n')} onChange={e => set(path, { items: e.target.value.split('\n').filter(Boolean).slice(0, 12) })} />
                </label>
              )
            default:
              return null
          }
        })}
      </div>
      {rows.some(r => DATA_LABEL[r.node.kind]) && (
        <div className="rounded-lg border border-border-default p-3 space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Live from your store</p>
          {rows
            .filter(r => DATA_LABEL[r.node.kind])
            .map(r => (
              <p key={r.path} className="text-xs text-foreground-secondary">
                {DATA_LABEL[r.node.kind](r.node)}
              </p>
            ))}
          <p className="text-[11px] text-foreground-muted">These update as your catalogue changes. To change what they show, ask the AI.</p>
        </div>
      )}
      {canWrite && (
        <button type="button" disabled={saving} onClick={save} className="inline-flex items-center gap-1.5 px-3 h-control text-sm font-medium rounded-lg border border-border-default text-foreground disabled:opacity-50">
          {saving ? 'Saving…' : 'Save to my blocks'}
        </button>
      )}
    </div>
  )
}
