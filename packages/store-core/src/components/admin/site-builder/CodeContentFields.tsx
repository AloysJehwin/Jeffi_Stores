'use client'

import { useEffect, useState, type ReactNode } from 'react'
import type { CodeLiteral, LiteralEdit } from '@/lib/site/code/literals'

// A code section's words, links and pictures as a form (lib/site/code/literals lists them from the source). Each field
// commits on blur or Enter; the caller writes the edit into the source and saves it. Shared by Site Builder's inspector
// and the onboarding studio, so it takes the host's input styling.

const internal = (v: string) => /^\/(?![/\\])\S*$/.test(v) || /^#[A-Za-z0-9_-]*$/.test(v)

function Field({
  literal,
  disabled,
  onCommit,
  inputClass,
  labelClass,
  renderImage,
}: {
  literal: CodeLiteral
  disabled: boolean
  onCommit: (edit: LiteralEdit) => void
  inputClass: string
  labelClass: string
  renderImage?: (p: { literal: CodeLiteral; disabled: boolean; onCommit: (url: string) => void }) => ReactNode
}) {
  const [draft, setDraft] = useState(literal.value)
  useEffect(() => setDraft(literal.value), [literal.id, literal.value])
  const bad = literal.kind === 'link' && draft.trim() !== '' && !internal(draft.trim())
  const commit = (to = draft) => {
    if (disabled || to === literal.value || (literal.kind === 'link' && !internal(to.trim()))) return
    if (literal.kind === 'text' && !to.trim()) return setDraft(literal.value)
    onCommit({ id: literal.id, from: literal.value, to })
  }
  const label = <span className={labelClass}>{literal.label}</span>
  if (literal.kind === 'image' && renderImage)
    return <div>{renderImage({ literal, disabled, onCommit: url => url && commit(url) })}</div>
  const long = literal.kind === 'text' && literal.value.length > 70
  return (
    <label className="block min-w-0">
      {label}
      {literal.kind === 'image' && draft && (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={draft} alt="" className="mb-1.5 h-16 w-24 rounded-md border border-border-default object-cover" />
      )}
      {long ? (
        <textarea className={`${inputClass} min-h-20`} disabled={disabled} value={draft} maxLength={1000} onChange={e => setDraft(e.target.value)} onBlur={() => commit()} />
      ) : (
        <input
          className={inputClass}
          disabled={disabled}
          value={draft}
          maxLength={literal.kind === 'image' ? 2000 : 1000}
          placeholder={literal.kind === 'link' ? '/products' : literal.kind === 'image' ? 'https://' : literal.kind === 'alt' ? 'What the picture shows' : undefined}
          onChange={e => setDraft(e.target.value)}
          onBlur={() => commit()}
          onKeyDown={e => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
            }
            if (e.key === 'Escape') setDraft(literal.value)
          }}
        />
      )}
      {bad && <span className="mt-1 block text-xs text-red-600">Use a page of your store: start with / (like /products) or #.</span>}
    </label>
  )
}

export default function CodeContentFields({
  literals,
  disabled = false,
  onCommit,
  inputClass,
  labelClass = 'mb-1 block text-xs font-medium text-foreground-secondary',
  renderImage,
}: {
  /** null while loading. */
  literals: CodeLiteral[] | null
  disabled?: boolean
  onCommit: (edit: LiteralEdit) => void
  inputClass: string
  labelClass?: string
  /** The host's picture picker (Site Builder's media library); a URL field otherwise. */
  renderImage?: (p: { literal: CodeLiteral; disabled: boolean; onCommit: (url: string) => void }) => ReactNode
}) {
  if (!literals) return <p className="text-xs text-foreground-muted">Reading the section…</p>
  if (!literals.length) return <p className="text-xs text-foreground-muted">This section has no words, links or pictures of its own: it shows your store’s data. Ask the AI to change it.</p>
  return (
    <div className="space-y-3">
      {literals.map(l => (
        <Field key={l.id} literal={l} disabled={disabled} onCommit={onCommit} inputClass={inputClass} labelClass={labelClass} renderImage={renderImage} />
      ))}
    </div>
  )
}
