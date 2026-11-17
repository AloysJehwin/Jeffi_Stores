'use client'

import { useEffect, useRef, useState } from 'react'
import { Wand2 } from 'lucide-react'
import type { Block, PageRef } from '@jeffi/site-blocks'
import { api } from '@/components/admin/kit/core'
import { useCanUseAi, useCanWrite } from '@/contexts/AdminScopesContext'
import { useToast } from '@/contexts/ToastContext'
import { INPUT_CLASS, LABEL_CLASS, Image as MediaImage } from '@/components/admin/homepage/editors/fields'
import type { CodeLiteral, LiteralEdit } from '@/lib/site/code/literals'
import CodeContentFields from './CodeContentFields'

// A code section in the inspector: its words, links and pictures as fields (written into the source, which saving the
// draft recompiles), and the AI changing it the AI Site Studio way. Both arrive as ordinary, undoable edits.

const IDEAS = ['Make the heading shorter', 'Put the picture on the left', 'Use a darker background']

export default function CodeSectionPanel({
  block,
  pageRef,
  pointed,
  onChange,
}: {
  block: Block
  pageRef: Pick<PageRef, 'audience' | 'surface' | 'page'>
  /** What the owner pointed at in the preview, for the AI. */
  pointed?: string | null
  onChange: (next: Block) => void
}) {
  const canWrite = useCanWrite('settings:write')
  const canAi = useCanUseAi('settings:write')
  const { showToast } = useToast()
  const source = typeof block.props.source === 'string' ? block.props.source : ''
  const [literals, setLiterals] = useState<CodeLiteral[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState('')
  const [asking, setAsking] = useState(false)
  // The source the listed fields belong to (set after our own edit, so it is not read twice).
  const known = useRef<string | null>(null)

  useEffect(() => {
    if (!canWrite || known.current === source) return
    let stop = false
    setLiterals(null)
    api<{ literals?: CodeLiteral[] }>('/api/admin/site-builder/code', { method: 'POST', json: { source, page: pageRef.page } }).then(r => {
      if (stop) return
      known.current = source
      setLiterals(r.ok ? (r.data.literals ?? []) : [])
    })
    return () => {
      stop = true
    }
  }, [source, pageRef.page, canWrite])

  async function commit(edit: LiteralEdit) {
    setBusy(true)
    const { ok, data } = await api<{ source?: string; literals?: CodeLiteral[]; error?: string }>('/api/admin/site-builder/code', {
      method: 'POST',
      json: { source, page: pageRef.page, edits: [edit] },
    })
    setBusy(false)
    if (!ok || !data.source) return showToast(data.error || 'Could not make that change', 'error')
    known.current = data.source
    setLiterals(data.literals ?? [])
    onChange({ ...block, props: { ...block.props, source: data.source } })
  }

  async function runAi() {
    if (ask.trim().length < 3) return
    setAsking(true)
    const { ok, data } = await api<{ source?: string; summary?: string; error?: string }>('/api/admin/site-builder/ai/code', {
      method: 'POST',
      json: { ref: { audience: pageRef.audience, page: pageRef.page }, block: { id: block.id, label: String(block.props.label ?? ''), source }, instruction: ask.trim(), hint: pointed ?? null },
    })
    setAsking(false)
    if (!ok || !data.source) return showToast(data.error || 'The AI could not make that change', 'error')
    onChange({ ...block, props: { ...block.props, source: data.source } })
    setAsk('')
    showToast(`${data.summary ?? 'Changed'}. Undo reverts it.`, 'success')
  }

  return (
    <div className="space-y-4">
      <div className="space-y-2">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-foreground-muted">Words, links and pictures</p>
        {canWrite ? (
          <CodeContentFields
            literals={literals}
            disabled={busy || asking}
            onCommit={commit}
            inputClass={INPUT_CLASS}
            labelClass={LABEL_CLASS}
            renderImage={({ literal, disabled, onCommit }) => <MediaImage label={literal.label} value={literal.value} size="wide" disabled={disabled} onCommit={url => onCommit(url)} />}
          />
        ) : (
          <p className="text-xs text-foreground-muted">You can see this section in the preview; changing it needs edit access to settings.</p>
        )}
      </div>
      {canAi && (
        <div className="rounded-lg border border-border-default p-3 space-y-2">
          <p className="text-xs font-medium text-foreground">Ask the AI to change this section</p>
          {pointed && <p className="text-xs text-foreground-muted truncate">Pointed at: “{pointed}”</p>}
          <textarea
            className={`${INPUT_CLASS} min-h-20`}
            placeholder="e.g. Put the picture on the left and make the heading shorter"
            value={ask}
            maxLength={1000}
            onChange={e => setAsk(e.target.value)}
          />
          <div className="flex flex-wrap gap-1.5">
            {IDEAS.map(i => (
              <button key={i} type="button" onClick={() => setAsk(i)} className="rounded-full border border-border-default px-2.5 py-1 text-[11px] text-foreground-secondary hover:border-accent-500">
                {i}
              </button>
            ))}
          </div>
          <button
            type="button"
            disabled={asking || busy || ask.trim().length < 3}
            onClick={runAi}
            className="inline-flex items-center gap-1.5 px-3 h-9 text-sm font-medium rounded-lg bg-accent-500 text-white disabled:opacity-50"
          >
            <Wand2 className="w-4 h-4" /> {asking ? 'Changing…' : 'Change this section'}
          </button>
          <p className="text-[11px] text-foreground-muted">Uses your AI credits. Undo brings the section back.</p>
        </div>
      )}
    </div>
  )
}
