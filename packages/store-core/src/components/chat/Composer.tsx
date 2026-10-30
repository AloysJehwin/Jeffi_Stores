'use client'

import { forwardRef, useEffect, useImperativeHandle, useRef, useState, type ReactNode } from 'react'
import { FileText, HardDrive, Paperclip, SendHorizontal, X } from 'lucide-react'
import AutoGrowTextarea from '@/components/ui/AutoGrowTextarea'
import type { AttachmentKind } from '@/lib/support/types'
import { fileSize } from './format'

/** An uploaded file ready to go out with the next message. */
export interface ReadyAttachment {
  id: string
  kind: AttachmentKind
  mime: string
  name: string
  size: number
  width?: number | null
  height?: number | null
  /** Local preview for the optimistic bubble. */
  previewUrl?: string | null
}

interface Pending {
  key: string
  name: string
  size: number
  kind: AttachmentKind
  previewUrl: string | null
  progress: number
  ready?: ReadyAttachment
  error?: string
}

export interface ComposerHandle {
  addFiles: (files: File[]) => void
  focus: () => void
}

interface Props {
  text: string
  setText: (v: string) => void
  onSend: (text: string, attachments: ReadyAttachment[]) => void
  upload?: (file: File, onProgress: (pct: number) => void) => Promise<ReadyAttachment>
  onPickFromDrive?: () => Promise<ReadyAttachment[] | null>
  onTyping?: () => void
  disabled?: boolean
  /** Replaces the input when the chat can't take messages (closed, not joined…). */
  notice?: ReactNode
  placeholder?: string
  /** Extra buttons beside the input (quick replies, AI help). */
  accessory?: ReactNode
  /** Rendered over the input's right edge (an in-field AI button). */
  inField?: ReactNode
  maxFiles?: number
  accept?: string
}

export const kindOf = (mime: string, name = ''): AttachmentKind =>
  mime.startsWith('image/') ? 'image' : mime.startsWith('video/') ? 'video' : mime.startsWith('audio/') ? 'audio' : mime === 'application/pdf' || /\.pdf$/i.test(name) ? 'pdf' : /\.(docx?|xlsx?|pptx?|csv|txt)$/i.test(name) ? 'doc' : 'other'

const coarse = () => typeof window !== 'undefined' && window.matchMedia?.('(pointer: coarse)').matches

/** The message box pinned under a chat: grows with the text, takes files by button, paste or drop. */
const Composer = forwardRef<ComposerHandle, Props>(function Composer(
  { text, setText, onSend, upload, onPickFromDrive, onTyping, disabled, notice, placeholder = 'Type a message', accessory, inField, maxFiles = 10, accept },
  ref
) {
  const [pending, setPending] = useState<Pending[]>([])
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLTextAreaElement>(null)
  const picker = useRef<HTMLInputElement>(null)

  const addFiles = (files: File[]) => {
    if (!upload || disabled) return
    const room = Math.max(0, maxFiles - pending.length)
    for (const file of files.slice(0, room)) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`
      const kind = kindOf(file.type, file.name)
      const previewUrl = kind === 'image' || kind === 'video' ? URL.createObjectURL(file) : null
      setPending(p => [...p, { key, name: file.name, size: file.size, kind, previewUrl, progress: 0 }])
      upload(file, pct => setPending(p => p.map(x => (x.key === key ? { ...x, progress: pct } : x))))
        .then(ready => setPending(p => p.map(x => (x.key === key ? { ...x, progress: 100, ready: { ...ready, previewUrl } } : x))))
        .catch(err => setPending(p => p.map(x => (x.key === key ? { ...x, error: err instanceof Error ? err.message : 'Upload failed' } : x))))
    }
  }

  useImperativeHandle(ref, () => ({ addFiles, focus: () => input.current?.focus() }))

  const uploading = pending.some(p => !p.ready && !p.error)
  const ready = pending.filter(p => p.ready).map(p => p.ready!)
  const canSend = !disabled && !uploading && (!!text.trim() || ready.length > 0)

  const send = () => {
    if (!canSend) return
    onSend(text.trim(), ready)
    setText('')
    // Object URLs stay alive for the optimistic bubble; release them a little later.
    const urls = pending.map(p => p.previewUrl).filter(Boolean) as string[]
    setTimeout(() => urls.forEach(u => URL.revokeObjectURL(u)), 120_000)
    setPending([])
    input.current?.focus()
  }

  useEffect(() => {
    if (!disabled) input.current?.focus({ preventScroll: true })
  }, [disabled])

  const pickDrive = async () => {
    if (!onPickFromDrive) return
    const picks = await onPickFromDrive()
    if (!picks?.length) return
    setPending(p => [
      ...p,
      ...picks.slice(0, Math.max(0, maxFiles - p.length)).map(r => ({ key: `d-${r.id}`, name: r.name, size: r.size, kind: r.kind, previewUrl: r.previewUrl ?? null, progress: 100, ready: r })),
    ])
  }

  if (notice) {
    return <div className="shrink-0 border-t border-border-default bg-surface px-4 py-3 text-center text-xs text-foreground-muted pb-[max(0.75rem,env(safe-area-inset-bottom))]">{notice}</div>
  }

  return (
    <div
      className={`shrink-0 border-t border-border-default bg-surface px-2.5 sm:px-3 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] ${drag ? 'ring-2 ring-primary-400 ring-inset' : ''}`}
      onDragOver={e => {
        if (!upload || !e.dataTransfer?.types.includes('Files')) return
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={e => {
        if (!upload) return
        e.preventDefault()
        setDrag(false)
        addFiles(Array.from(e.dataTransfer.files))
      }}
    >
      {pending.length > 0 && (
        <div className="flex gap-2 overflow-x-auto pb-2">
          {pending.map(p => (
            <div key={p.key} className="relative shrink-0 w-[72px]">
              <div className="w-[72px] h-[72px] rounded-lg border border-border-default bg-surface-secondary overflow-hidden flex items-center justify-center">
                {p.previewUrl && p.kind === 'image' ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={p.previewUrl} alt="" className="w-full h-full object-cover" />
                ) : (
                  <FileText className="w-6 h-6 text-foreground-muted" />
                )}
                {!p.ready && !p.error && (
                  <div className="absolute inset-x-1 bottom-1 h-1 rounded bg-black/20 overflow-hidden">
                    <div className="h-full bg-primary-500 transition-[width]" style={{ width: `${p.progress}%` }} />
                  </div>
                )}
                {p.error && <div className="absolute inset-0 bg-red-500/80 text-white text-[10px] p-1 flex items-center text-center leading-tight">{p.error}</div>}
              </div>
              <p className="text-[10px] text-foreground-muted truncate mt-0.5" title={p.name}>
                {p.name} · {fileSize(p.size)}
              </p>
              <button
                type="button"
                aria-label={`Remove ${p.name}`}
                onClick={() => setPending(x => x.filter(y => y.key !== p.key))}
                className="absolute -top-1.5 -right-1.5 w-5 h-5 rounded-full bg-foreground text-surface flex items-center justify-center shadow"
              >
                <X className="w-3 h-3" />
              </button>
            </div>
          ))}
        </div>
      )}
      <div className="flex items-end gap-1.5">
        {upload && (
          <>
            <input
              ref={picker}
              type="file"
              multiple
              accept={accept}
              className="hidden"
              onChange={e => {
                addFiles(Array.from(e.target.files ?? []))
                e.target.value = ''
              }}
            />
            <button
              type="button"
              disabled={disabled}
              onClick={() => picker.current?.click()}
              title="Attach files"
              aria-label="Attach files"
              className="shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
            >
              <Paperclip className="w-5 h-5" />
            </button>
          </>
        )}
        {onPickFromDrive && (
          <button
            type="button"
            disabled={disabled}
            onClick={pickDrive}
            title="Attach from Drive"
            aria-label="Attach from Drive"
            className="shrink-0 h-10 w-10 rounded-full flex items-center justify-center text-foreground-secondary hover:bg-surface-secondary disabled:opacity-50"
          >
            <HardDrive className="w-5 h-5" />
          </button>
        )}
        {accessory}
        <div className="relative flex-1 min-w-0">
          <AutoGrowTextarea
            ref={input}
            value={text}
            maxRows={7}
            disabled={disabled}
            placeholder={placeholder}
            onChange={e => {
              setText(e.target.value)
              onTyping?.()
            }}
            onKeyDown={e => {
              if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing && !coarse()) {
                e.preventDefault()
                send()
              }
            }}
            onPaste={e => {
              const files = Array.from(e.clipboardData?.files ?? [])
              if (files.length && upload) {
                e.preventDefault()
                addFiles(files)
              }
            }}
            className={`block w-full rounded-2xl border border-border-default bg-surface-elevated px-3.5 py-2.5 text-sm leading-5 text-foreground placeholder:text-foreground-muted focus:outline-none focus:ring-2 focus:ring-primary-400 disabled:opacity-60 ${inField ? 'pr-10' : ''}`}
          />
          {inField}
        </div>
        <button
          type="button"
          onClick={send}
          disabled={!canSend}
          aria-label="Send"
          className="shrink-0 h-10 w-10 rounded-full bg-primary-500 hover:bg-primary-600 text-white flex items-center justify-center disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <SendHorizontal className="w-[18px] h-[18px]" />
        </button>
      </div>
    </div>
  )
})

export default Composer
