'use client'

import { useState, type ReactNode } from 'react'
import { Copy, ImageIcon, Languages, Loader2, Plus, Scissors, Sparkles, Trash2 } from 'lucide-react'
import { LANGUAGES } from '@/lib/site/studio/languages'
import type { CodeNode } from '@jeffi/site-blocks'
import { findNode } from '@jeffi/site-blocks/design'
import { NEW_KINDS, insideData, litProp, nodeName, pathTo, textChildren, wordsOnly, type NewKind } from './nodes'

// The selected element: where it sits, and its written-out words. Typing is one undoable step per field until it
// loses focus (a gesture).

export interface InspectorProps {
  tree: CodeNode
  id: string
  canWrite: boolean
  onSelect: (id: string) => void
  /** Sets a node's text (the element's own id when it holds only words, else a text node's). */
  onText: (id: string, value: string) => void
  onDone: () => void
  /** A written-out attribute (a picture's address and description, a link's target). */
  onAttr: (id: string, name: string, value: string) => void
  onAdd: (kind: NewKind) => void
  onDuplicate: () => void
  onDelete: () => void
  renderImagePicker?: (p: { value: string; disabled: boolean; onPick: (url: string) => void }) => ReactNode
  /** Cheap AI actions on this element (values, not code), when the host has them. */
  ai?: {
    busy: boolean
    text: (fieldId: string, current: string, action: 'rewrite' | 'shorten' | 'translate', language?: string) => void
    picture: () => void
  }
  children?: ReactNode
}

const isPicture = (n: CodeNode) => (n.t === 'cmp' && n.name === 'Image') || (n.t === 'el' && n.tag === 'img')
const isLink = (n: CodeNode) => (n.t === 'cmp' && n.name === 'Link') || (n.t === 'el' && n.tag === 'a')

export default function Inspector({ tree, id, canWrite, onSelect, onText, onDone, onAttr, onAdd, onDuplicate, onDelete, renderImagePicker, ai, children }: InspectorProps) {
  const node = findNode(tree, id)?.node
  if (!node) return <p className="text-sm text-foreground-muted">That element is gone. Pick another on the canvas.</p>
  const crumbs = pathTo(tree, id)
  const data = insideData(tree, id)
  const whole = wordsOnly(node)
  const fields = whole ? [{ id, value: node.children[0]?.t === 'text' ? node.children[0].value : '' }] : textChildren(node).map(t => ({ id: t.id!, value: t.value }))
  const field = 'w-full rounded-lg border border-border-default bg-surface px-2.5 py-2 text-sm text-foreground focus:border-accent-500 focus:outline-none disabled:opacity-60'
  const root = id === tree.id
  const locked = 'locked' in node && !!node.locked
  const btn = 'inline-flex items-center gap-1 rounded-md border border-border-default px-2 h-7 text-xs text-foreground-secondary hover:text-foreground disabled:opacity-40'

  return (
    <div className="space-y-4">
      <nav aria-label="Where it sits" className="flex flex-wrap items-center gap-1 text-[11px] text-foreground-muted">
        {crumbs.map((c, i) => (
          <span key={c.id} className="inline-flex items-center gap-1">
            {i > 0 && <span aria-hidden>›</span>}
            <button type="button" onClick={() => c.id && onSelect(c.id)} className={`rounded px-1 py-0.5 hover:bg-surface-secondary ${c.id === id ? 'font-semibold text-foreground' : ''}`}>
              {nodeName(c)}
            </button>
          </span>
        ))}
      </nav>
      <div>
        <p className="text-sm font-semibold text-foreground">{nodeName(node)}</p>
        {data && <p className="mt-1 text-xs text-foreground-muted">Drawn for each item of your store data: a change here applies to every item.</p>}
        {node.t !== 'text' && 'locked' in node && node.locked && <p className="mt-1 text-xs text-foreground-muted">The page needs this part to work, so it can be moved but not removed.</p>}
        {'ro' in node && node.ro && <p className="mt-1 text-xs text-foreground-muted">Its style is worked out from data, so change it with AI or in code.</p>}
      </div>
      {fields.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Text</p>
          {fields.map(f => (
            <textarea
              key={f.id}
              aria-label="Text"
              rows={Math.min(6, Math.max(1, Math.ceil(f.value.length / 34)))}
              className={field}
              disabled={!canWrite}
              value={f.value}
              onChange={e => onText(f.id, e.target.value.replace(/\s*\n\s*/g, ' '))}
              onBlur={onDone}
            />
          ))}
          {whole && <p className="text-[11px] text-foreground-muted">Or double-click the words on the canvas to type in place.</p>}
          {ai && canWrite && fields.length === 1 && fields[0].value.trim() && (
            <div className="flex flex-wrap items-center gap-1.5">
              {ai.busy && <Loader2 className="h-3.5 w-3.5 animate-spin text-foreground-muted" aria-label="Working" />}
              <button type="button" className={btn} disabled={ai.busy} onClick={() => ai.text(fields[0].id, fields[0].value, 'rewrite')}>
                <Sparkles className="h-3.5 w-3.5" /> Rewrite
              </button>
              <button type="button" className={btn} disabled={ai.busy} onClick={() => ai.text(fields[0].id, fields[0].value, 'shorten')}>
                <Scissors className="h-3.5 w-3.5" /> Shorten
              </button>
              <label className="inline-flex items-center gap-1 text-xs text-foreground-secondary">
                <Languages className="h-3.5 w-3.5" />
                <select
                  aria-label="Translate into"
                  className="h-7 rounded-md border border-border-default bg-surface px-1 text-xs"
                  disabled={ai.busy}
                  value=""
                  onChange={e => e.target.value && ai.text(fields[0].id, fields[0].value, 'translate', e.target.value)}
                >
                  <option value="">Translate…</option>
                  {LANGUAGES.map(l => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          )}
        </div>
      )}
      {isPicture(node) && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Picture</p>
          {litProp(node, 'src') === null ? (
            <p className="text-xs text-foreground-muted">This picture comes from your store data.</p>
          ) : renderImagePicker ? (
            renderImagePicker({ value: litProp(node, 'src') ?? '', disabled: !canWrite, onPick: url => onAttr(id, 'src', url) })
          ) : (
            <AttrField label="Picture address" value={litProp(node, 'src') ?? ''} placeholder="https://" disabled={!canWrite} onCommit={v => onAttr(id, 'src', v)} />
          )}
          {ai && canWrite && litProp(node, 'src') !== null && (
            <button type="button" className={btn} disabled={ai.busy} onClick={ai.picture}>
              {ai.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />} Find a picture for this spot
            </button>
          )}
          {litProp(node, 'alt') !== null && <AttrField label="Description (read aloud)" value={litProp(node, 'alt') ?? ''} disabled={!canWrite} onCommit={v => onAttr(id, 'alt', v)} />}
        </div>
      )}
      {isLink(node) && litProp(node, 'href') !== null && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Link</p>
          <AttrField label="Goes to" value={litProp(node, 'href') ?? ''} placeholder="/products" disabled={!canWrite} onCommit={v => onAttr(id, 'href', v)} />
        </div>
      )}
      {canWrite && (
        <div className="space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Element</p>
          <div className="flex flex-wrap gap-1.5">
            <button type="button" className={btn} disabled={root || locked} onClick={onDuplicate} title={locked ? 'A page has this part once' : undefined}>
              <Copy className="h-3.5 w-3.5" /> Duplicate
            </button>
            <button type="button" className={btn} disabled={root || locked} onClick={onDelete} title={locked ? 'The page needs this part' : undefined}>
              <Trash2 className="h-3.5 w-3.5" /> Delete
            </button>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="inline-flex items-center gap-1 text-xs text-foreground-muted">
              <Plus className="h-3.5 w-3.5" /> Add {root ? 'inside' : 'after'}:
            </span>
            {NEW_KINDS.map(k => (
              <button key={k.kind} type="button" className={btn} onClick={() => onAdd(k.kind)}>
                {k.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {children}
    </div>
  )
}

/** A text attribute, written in when it loses focus or on Enter. */
function AttrField({ label, value, placeholder, disabled, onCommit }: { label: string; value: string; placeholder?: string; disabled: boolean; onCommit: (v: string) => void }) {
  const [draft, setDraft] = useState(value)
  const commit = () => draft.trim() !== value && onCommit(draft.trim())
  return (
    <label className="block space-y-1">
      <span className="text-xs text-foreground-secondary">{label}</span>
      <input
        className="w-full rounded-lg border border-border-default bg-surface px-2.5 h-8 text-sm text-foreground focus:border-accent-500 focus:outline-none disabled:opacity-60"
        value={draft}
        placeholder={placeholder}
        disabled={disabled}
        onChange={e => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={e => e.key === 'Enter' && commit()}
      />
    </label>
  )
}
