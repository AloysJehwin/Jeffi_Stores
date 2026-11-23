'use client'

import type { ReactNode } from 'react'
import type { CodeNode } from '@jeffi/site-blocks'
import { findNode } from '@jeffi/site-blocks/design'
import { insideData, nodeName, pathTo, textChildren, wordsOnly } from './nodes'

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
  children?: ReactNode
}

export default function Inspector({ tree, id, canWrite, onSelect, onText, onDone, children }: InspectorProps) {
  const node = findNode(tree, id)?.node
  if (!node) return <p className="text-sm text-foreground-muted">That element is gone. Pick another on the canvas.</p>
  const crumbs = pathTo(tree, id)
  const data = insideData(tree, id)
  const whole = wordsOnly(node)
  const fields = whole ? [{ id, value: node.children[0]?.t === 'text' ? node.children[0].value : '' }] : textChildren(node).map(t => ({ id: t.id!, value: t.value }))
  const field = 'w-full rounded-lg border border-border-default bg-surface px-2.5 py-2 text-sm text-foreground focus:border-accent-500 focus:outline-none disabled:opacity-60'

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
        </div>
      )}
      {children}
    </div>
  )
}
