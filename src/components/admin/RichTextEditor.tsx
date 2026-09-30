'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { TEMPLATE_VARS } from '@/lib/shared/template-vars'

interface Props {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
  className?: string
}

const TOOLBAR_BTN =
  'inline-flex items-center justify-center w-7 h-7 rounded text-foreground hover:bg-surface-secondary hover:text-accent-600 dark:hover:text-accent-400 transition-colors text-xs font-semibold'

function ToolTip({ preview, children }: { preview: ReactNode; children: ReactNode }) {
  const [visible, setVisible] = useState(false)
  return (
    <div className="relative" onMouseEnter={() => setVisible(true)} onMouseLeave={() => setVisible(false)}>
      {children}
      {visible && (
        <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 z-50 pointer-events-none">
          <div className="bg-surface-elevated border border-border-default rounded-lg shadow-xl px-3 py-2 text-xs text-foreground whitespace-nowrap min-w-[110px] text-center">
            {preview}
            <div className="absolute top-full left-1/2 -translate-x-1/2 w-0 h-0 border-l-4 border-r-4 border-t-4 border-l-transparent border-r-transparent border-t-border-default" />
          </div>
        </div>
      )}
    </div>
  )
}

export default function RichTextEditor({
  value,
  onChange,
  placeholder = 'Write your email…',
  minHeight = 320,
  className = '',
}: Props) {
  const editorRef = useRef<HTMLDivElement>(null)
  const lastValueRef = useRef<string>('')
  const [showVars, setShowVars] = useState(false)
  const [linkUrl, setLinkUrl] = useState('')
  const [linkText, setLinkText] = useState('')
  const [showLinkModal, setShowLinkModal] = useState(false)
  const savedRange = useRef<Range | null>(null)

  useEffect(() => {
    if (!editorRef.current) return
    if (value !== lastValueRef.current) {
      editorRef.current.innerHTML = value || ''
      lastValueRef.current = value || ''
    }
  }, [value])

  function emit() {
    if (!editorRef.current) return
    const html = editorRef.current.innerHTML
    lastValueRef.current = html
    onChange(html)
  }

  function exec(command: string, val?: string) {
    editorRef.current?.focus()
    document.execCommand(command, false, val)
    emit()
  }

  function saveSelection() {
    const sel = window.getSelection()
    if (sel && sel.rangeCount > 0) {
      savedRange.current = sel.getRangeAt(0).cloneRange()
    }
  }

  function restoreSelection() {
    if (!savedRange.current) return
    const sel = window.getSelection()
    if (!sel) return
    sel.removeAllRanges()
    sel.addRange(savedRange.current)
  }

  function insertHtmlAtCursor(html: string) {
    editorRef.current?.focus()
    restoreSelection()
    document.execCommand('insertHTML', false, html)
    emit()
  }

  function insertVar(key: string) {
    const token = `{${key}}`
    insertHtmlAtCursor(
      `<span style="font-family:ui-monospace,monospace;font-size:13px;border:1px solid #a78bfa;border-radius:3px;padding:1px 4px;color:inherit;">${token}</span>&nbsp;`
    )
    setShowVars(false)
  }

  function openLink() {
    saveSelection()
    const sel = window.getSelection()
    setLinkText(sel && !sel.isCollapsed ? sel.toString() : '')
    setLinkUrl('https://')
    setShowLinkModal(true)
  }

  function applyLink() {
    if (!linkUrl || linkUrl === 'https://') {
      setShowLinkModal(false)
      return
    }
    editorRef.current?.focus()
    restoreSelection()
    const sel = window.getSelection()
    const hasSelection = sel && !sel.isCollapsed
    const displayText = linkText.trim() || linkUrl
    if (hasSelection) {
      document.execCommand('createLink', false, linkUrl)
      const node = sel?.focusNode?.parentElement
      if (node && node.tagName === 'A') {
        node.setAttribute('style', 'color:#e07b3f;text-decoration:underline;')
        node.setAttribute('target', '_blank')
        node.setAttribute('rel', 'noopener')
        if (linkText.trim()) node.textContent = linkText.trim()
      }
    } else {
      document.execCommand(
        'insertHTML',
        false,
        `<a href="${linkUrl}" target="_blank" rel="noopener" style="color:#e07b3f;text-decoration:underline;">${displayText}</a>`
      )
    }
    emit()
    setShowLinkModal(false)
  }

  function insertCta() {
    const html = `<p style="text-align:center;margin:24px 0;"><a href="https://jeffistores.in" target="_blank" rel="noopener" style="display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;">Shop Now</a></p>`
    insertHtmlAtCursor(html)
  }

  const customerVars = TEMPLATE_VARS.filter(v => v.group === 'customer')
  const storeVars = TEMPLATE_VARS.filter(v => v.group === 'store')
  const dateVars = TEMPLATE_VARS.filter(v => v.group === 'date')

  return (
    <div className={`border border-border-secondary rounded-lg bg-surface ${className}`}>
      <div className="flex flex-wrap items-center gap-0.5 p-1.5 border-b border-border-default bg-surface-secondary rounded-t-lg">
        <ToolTip preview={<span className="font-bold text-sm">Bold text</span>}>
          <button
            type="button"
            title="Bold"
            className={`${TOOLBAR_BTN} font-bold text-base`}
            onMouseDown={e => {
              e.preventDefault()
              exec('bold')
            }}
          >
            B
          </button>
        </ToolTip>
        <ToolTip preview={<span className="italic text-sm">Italic text</span>}>
          <button
            type="button"
            title="Italic"
            className={`${TOOLBAR_BTN} italic text-base`}
            onMouseDown={e => {
              e.preventDefault()
              exec('italic')
            }}
          >
            I
          </button>
        </ToolTip>
        <ToolTip preview={<span className="underline text-sm">Underline text</span>}>
          <button
            type="button"
            title="Underline"
            className={`${TOOLBAR_BTN} underline text-base`}
            onMouseDown={e => {
              e.preventDefault()
              exec('underline')
            }}
          >
            U
          </button>
        </ToolTip>
        <span className="w-px h-5 bg-border-default mx-1" />
        <ToolTip preview={<span className="font-bold text-base">Heading</span>}>
          <button
            type="button"
            title="Heading"
            className={`${TOOLBAR_BTN} text-base`}
            onMouseDown={e => {
              e.preventDefault()
              exec('formatBlock', 'H2')
            }}
          >
            H
          </button>
        </ToolTip>
        <ToolTip preview={<span className="text-sm">Paragraph</span>}>
          <button
            type="button"
            title="Paragraph"
            className={`${TOOLBAR_BTN} text-base`}
            onMouseDown={e => {
              e.preventDefault()
              exec('formatBlock', 'P')
            }}
          >
            P
          </button>
        </ToolTip>
        <span className="w-px h-5 bg-border-default mx-1" />
        <ToolTip
          preview={
            <ul className="list-disc pl-4 text-left text-xs space-y-0.5">
              <li>Item one</li>
              <li>Item two</li>
            </ul>
          }
        >
          <button
            type="button"
            title="Bulleted list"
            className={TOOLBAR_BTN}
            onMouseDown={e => {
              e.preventDefault()
              exec('insertUnorderedList')
            }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M4 6h.01M4 12h.01M4 18h.01M8 6h12M8 12h12M8 18h12"
              />
            </svg>
          </button>
        </ToolTip>
        <ToolTip
          preview={
            <ol className="list-decimal pl-4 text-left text-xs space-y-0.5">
              <li>First</li>
              <li>Second</li>
            </ol>
          }
        >
          <button
            type="button"
            title="Numbered list"
            className={TOOLBAR_BTN}
            onMouseDown={e => {
              e.preventDefault()
              exec('insertOrderedList')
            }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M7 6h10M7 12h10M7 18h10M3 6h.01M3 12h.01M3 18h.01"
              />
            </svg>
          </button>
        </ToolTip>
        <span className="w-px h-5 bg-border-default mx-1" />
        <ToolTip
          preview={
            <span className="text-sm underline" style={{ color: '#e07b3f' }}>
              Link text
            </span>
          }
        >
          <button
            type="button"
            title="Insert link"
            className={TOOLBAR_BTN}
            onMouseDown={e => {
              e.preventDefault()
              openLink()
            }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
              />
            </svg>
          </button>
        </ToolTip>
        <ToolTip
          preview={
            <span className="inline-block bg-accent-500 text-white text-[11px] font-semibold px-3 py-1 rounded-md">
              Shop Now
            </span>
          }
        >
          <button
            type="button"
            title="Insert CTA button"
            className={`${TOOLBAR_BTN} px-2 w-auto text-[11px] font-bold uppercase`}
            onMouseDown={e => {
              e.preventDefault()
              insertCta()
            }}
          >
            CTA
          </button>
        </ToolTip>
        <span className="w-px h-5 bg-border-default mx-1" />
        <ToolTip
          preview={
            <span className="text-xs text-foreground-muted">
              Clears all
              <br />
              formatting
            </span>
          }
        >
          <button
            type="button"
            title="Clear formatting"
            className={TOOLBAR_BTN}
            onMouseDown={e => {
              e.preventDefault()
              exec('removeFormat')
            }}
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 7h14M9 7v12m6-12v12M5 19h14" />
            </svg>
          </button>
        </ToolTip>
        <span className="w-px h-5 bg-border-default mx-1" />
        <div className="relative">
          <button
            type="button"
            onMouseDown={e => {
              e.preventDefault()
              saveSelection()
              setShowVars(v => !v)
            }}
            className="inline-flex items-center gap-1 px-2 py-1 rounded text-xs font-semibold text-violet-600 dark:text-violet-400 hover:bg-violet-50 dark:hover:bg-violet-900/30 transition-colors"
            title="Insert customer/store variable"
          >
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.2}>
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M10 8h4M8 12h8M9 16h6M3 12a9 9 0 1118 0 9 9 0 01-18 0z"
              />
            </svg>
            Insert variable
          </button>
          {showVars && (
            <>
              <button
                type="button"
                className="fixed inset-0 z-10"
                onClick={() => setShowVars(false)}
                aria-label="Close"
              />
              <div className="absolute z-20 left-0 mt-1 w-72 max-h-80 overflow-y-auto bg-surface-elevated border border-border-default rounded-lg shadow-xl p-2">
                <VarGroup title="Customer" vars={customerVars} onPick={insertVar} />
                <VarGroup title="Store" vars={storeVars} onPick={insertVar} />
                <VarGroup title="Date" vars={dateVars} onPick={insertVar} />
                <p className="text-[10px] text-foreground-muted px-2 pt-2 border-t border-border-default mt-1">
                  These tokens are replaced per recipient at send time.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
      <div
        ref={editorRef}
        contentEditable
        suppressContentEditableWarning
        onInput={emit}
        onBlur={emit}
        data-placeholder={placeholder}
        className="px-3 py-3 text-sm text-foreground focus:outline-none rich-text-editor-content"
        style={{ minHeight }}
      />
      <style jsx>{`
        .rich-text-editor-content:empty:before {
          content: attr(data-placeholder);
          color: var(--foreground-muted, #9ca3af);
          pointer-events: none;
        }
        .rich-text-editor-content :global(h1),
        .rich-text-editor-content :global(h2),
        .rich-text-editor-content :global(h3) {
          font-weight: 700;
          margin: 12px 0 6px;
          color: var(--foreground, currentColor);
        }
        .rich-text-editor-content :global(h2) {
          font-size: 18px;
        }
        .rich-text-editor-content :global(h3) {
          font-size: 16px;
        }
        .rich-text-editor-content :global(p) {
          margin: 6px 0;
          line-height: 1.55;
        }
        .rich-text-editor-content :global(ul) {
          list-style-type: disc !important;
          margin: 8px 0 !important;
          padding-left: 28px !important;
        }
        .rich-text-editor-content :global(ol) {
          list-style-type: decimal !important;
          margin: 8px 0 !important;
          padding-left: 28px !important;
        }
        .rich-text-editor-content :global(li) {
          margin: 2px 0;
          line-height: 1.55;
          display: list-item !important;
        }
        .rich-text-editor-content :global(a) {
          color: var(--accent-500, #e07b3f);
          text-decoration: underline;
        }
        .rich-text-editor-content :global(strong),
        .rich-text-editor-content :global(b) {
          font-weight: 700;
        }
        .rich-text-editor-content :global(em),
        .rich-text-editor-content :global(i) {
          font-style: italic;
        }
        .rich-text-editor-content :global(blockquote) {
          margin: 8px 0;
          padding-left: 12px;
          border-left: 3px solid var(--accent-500, #e07b3f);
          color: var(--foreground-secondary, #6b7280);
        }
      `}</style>

      {showLinkModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-4">
          <div className="bg-surface-elevated rounded-lg shadow-xl p-5 w-full max-w-sm">
            <h3 className="text-sm font-semibold text-foreground mb-3">Insert link</h3>
            <div className="space-y-3 mb-4">
              <div>
                <label className="block text-xs text-foreground-muted mb-1">Display text</label>
                <input
                  type="text"
                  value={linkText}
                  onChange={e => setLinkText(e.target.value)}
                  className="w-full px-3 py-2 border border-border-secondary rounded bg-surface text-foreground text-sm"
                  placeholder="e.g. Track your order"
                />
              </div>
              <div>
                <label className="block text-xs text-foreground-muted mb-1">URL</label>
                <input
                  autoFocus
                  type="url"
                  value={linkUrl}
                  onChange={e => setLinkUrl(e.target.value)}
                  onKeyDown={e => {
                    if (e.key === 'Enter') applyLink()
                  }}
                  className="w-full px-3 py-2 border border-border-secondary rounded bg-surface text-foreground text-sm"
                  placeholder="https://example.com"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setShowLinkModal(false)}
                className="px-3 py-1.5 text-xs text-foreground-muted hover:text-foreground"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={applyLink}
                className="px-3 py-1.5 text-xs bg-accent-500 hover:bg-accent-600 text-white rounded font-medium"
              >
                Insert
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function VarGroup({
  title,
  vars,
  onPick,
}: {
  title: string
  vars: typeof TEMPLATE_VARS
  onPick: (key: string) => void
}) {
  return (
    <div className="mb-2 last:mb-0">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted px-2 py-1">{title}</p>
      <div className="space-y-0.5">
        {vars.map(v => (
          <button
            key={v.key}
            type="button"
            onClick={() => onPick(v.key)}
            className="w-full text-left px-2 py-1.5 rounded hover:bg-surface-secondary transition-colors group"
          >
            <div className="flex items-center justify-between gap-2">
              <code className="text-xs text-violet-600 dark:text-violet-400 font-mono">{`{${v.key}}`}</code>
              <span className="text-[10px] text-foreground-muted shrink-0">{v.label}</span>
            </div>
            <p className="text-[11px] text-foreground-muted mt-0.5 group-hover:text-foreground-secondary truncate">
              {v.description}
            </p>
          </button>
        ))}
      </div>
    </div>
  )
}
