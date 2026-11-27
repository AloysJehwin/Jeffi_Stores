'use client'

import { ClipboardPaste, Copy, Group, Scissors, Trash2 } from 'lucide-react'
import type { AlignKind, DistributeAxis } from '@/lib/site/code/arrange'
import { ALIGNS } from './FreePanel'

// The actions shared by several selected elements: group, copy, cut, duplicate, delete, and (free layers in one frame)
// align to the selection's bounds and distribute.

export interface MultiPanelProps {
  count: number
  canWrite: boolean
  /** All of them are free layers at the breakpoint being edited. */
  free: boolean
  onGroup: () => void
  onDuplicate: () => void
  onDelete: () => void
  onCopy: () => void
  onCut: () => void
  onPaste?: () => void
  onAlign: (kind: AlignKind) => void
  onDistribute: (axis: DistributeAxis) => void
}

export default function MultiPanel({ count, canWrite, free, onGroup, onDuplicate, onDelete, onCopy, onCut, onPaste, onAlign, onDistribute }: MultiPanelProps) {
  const btn = 'inline-flex items-center gap-1 rounded-md border border-border-default px-2 h-7 text-xs text-foreground-secondary hover:text-foreground disabled:opacity-40'
  return (
    <div className="space-y-3">
      <p className="text-sm font-semibold text-foreground">{count} elements selected</p>
      <p className="text-[11px] text-foreground-muted">Shift-click adds or removes one; Escape clears. Arrow keys move free layers, Alt + arrows resize them.</p>
      {canWrite && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className={btn} onClick={onGroup} title="Group (⌘G)">
            <Group className="h-3.5 w-3.5" /> Group
          </button>
          <button type="button" className={btn} onClick={onDuplicate} title="Duplicate (⌘D)">
            <Copy className="h-3.5 w-3.5" /> Duplicate
          </button>
          <button type="button" className={btn} onClick={onCopy} title="Copy (⌘C)">
            <Copy className="h-3.5 w-3.5" /> Copy
          </button>
          <button type="button" className={btn} onClick={onCut} title="Cut (⌘X)">
            <Scissors className="h-3.5 w-3.5" /> Cut
          </button>
          {onPaste && (
            <button type="button" className={btn} onClick={onPaste} title="Paste (⌘V)">
              <ClipboardPaste className="h-3.5 w-3.5" /> Paste
            </button>
          )}
          <button type="button" className={btn} onClick={onDelete} title="Delete">
            <Trash2 className="h-3.5 w-3.5" /> Delete
          </button>
        </div>
      )}
      {canWrite && free && (
        <div className="space-y-1.5">
          <p className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">Align</p>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Align to the selection">
            {ALIGNS.map(a => (
              <button key={a.kind} type="button" className={btn} onClick={() => onAlign(a.kind)} aria-label={`${a.label} (to the selection)`} title={a.label}>
                <a.Icon className="h-3.5 w-3.5" />
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Distribute">
            <button type="button" className={btn} disabled={count < 3} onClick={() => onDistribute('x')}>
              Distribute across
            </button>
            <button type="button" className={btn} disabled={count < 3} onClick={() => onDistribute('y')}>
              Distribute down
            </button>
          </div>
        </div>
      )}
    </div>
  )
}
