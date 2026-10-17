'use client'

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import AdminSelect, { type SelectOption } from '@/components/admin/AdminSelect'
import { EditorContent, useEditor, type Editor } from '@tiptap/react'
import {
  Bold,
  Braces,
  CodeXml,
  Italic,
  Link2,
  List,
  ListOrdered,
  Minus,
  MousePointerClick,
  Palette,
  PencilLine,
  Quote,
  Redo2,
  RemoveFormatting,
  Search,
  Strikethrough,
  TextAlignCenter,
  TextAlignEnd,
  TextAlignJustify,
  TextAlignStart,
  Underline,
  Undo2,
  Unlink,
} from 'lucide-react'
import { buildExtensions } from './extensions'
import { hasComplexMarkup, prepareInputHtml, serializeEmailHtml } from './html'
import {
  applyLink,
  clearFormatting,
  COLOR_SWATCHES,
  currentBlockType,
  FONT_FAMILIES,
  FONT_SIZES,
  getLinkState,
  applyButton,
  removeLink,
  setBlockType,
  type BlockType,
} from './actions'
import { groupVariables, useTemplateVariables, type ComposerVariable } from './variables'

export interface EmailComposerProps {
  value: string
  onChange: (html: string) => void
  placeholder?: string
  minHeight?: number
  className?: string
  /** Show the raw-HTML toggle (default true). */
  allowSource?: boolean
  /** Caller-specific tokens listed ahead of the shared variables (e.g. campaign tokens). */
  extraVariables?: ComposerVariable[]
  /** Default href for the CTA button insert. */
  ctaHref?: string
}

type Mode = 'visual' | 'source'
type PopoverKind = 'link' | 'vars' | 'color' | 'button'
type PopoverState = null | { kind: PopoverKind; left: number }

// Every toolbar control uses the admin `sm` tier (34px, see globals.css) so rows line up.
const BAR = 'border-b border-border-default bg-surface-secondary rounded-t-lg py-1.5'
const BTN =
  'inline-flex items-center justify-center gap-1 rounded-lg text-foreground hover:bg-surface hover:text-accent-600 dark:hover:text-accent-400 transition-colors disabled:opacity-40 disabled:pointer-events-none focus:outline-none focus-visible:ring-2 focus-visible:ring-accent-500'
const BTN_ON = 'bg-surface text-accent-500 ring-1 ring-inset ring-border-default'
const INPUT =
  'w-full px-2.5 py-1.5 border border-border-secondary rounded bg-surface text-foreground text-sm focus:outline-none focus:ring-2 focus:ring-accent-500'

const MOD = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘' : 'Ctrl+'

const BLOCK_OPTIONS: SelectOption[] = [
  { value: 'paragraph', label: 'Paragraph' },
  { value: 'h1', label: 'Heading 1' },
  { value: 'h2', label: 'Heading 2' },
  { value: 'h3', label: 'Heading 3' },
]

export default function EmailComposer({
  value,
  onChange,
  placeholder = 'Write your email…',
  minHeight = 320,
  className = '',
  allowSource = true,
  extraVariables,
  ctaHref,
}: EmailComposerProps) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange
  const lastEmitted = useRef(value)
  const [mode, setMode] = useState<Mode>(() => (allowSource && hasComplexMarkup(value) ? 'source' : 'visual'))
  const [confirmVisual, setConfirmVisual] = useState(false)
  const [popover, setPopover] = useState<PopoverState>(null)
  const openLinkRef = useRef<() => void>(() => {})

  const extensions = useMemo(() => buildExtensions(placeholder), [placeholder])
  const editor = useEditor({
    immediatelyRender: false,
    shouldRerenderOnTransaction: true,
    extensions,
    content: prepareInputHtml(value),
    editorProps: {
      attributes: {
        class: 'ec-content focus:outline-none',
        role: 'textbox',
        'aria-multiline': 'true',
        'aria-label': 'Email body',
      },
      transformPastedHTML: html => prepareInputHtml(html),
      handleKeyDown: (_view, e) => {
        if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
          e.preventDefault()
          openLinkRef.current()
          return true
        }
        return false
      },
    },
    onUpdate: ({ editor: ed }) => {
      const html = ed.isEmpty ? '' : serializeEmailHtml(ed.getHTML())
      lastEmitted.current = html
      onChangeRef.current(html)
    },
  })

  useEffect(() => {
    if (value === lastEmitted.current) return
    lastEmitted.current = value
    if (mode === 'source') return
    if (allowSource && hasComplexMarkup(value)) {
      setMode('source')
      return
    }
    editor?.commands.setContent(prepareInputHtml(value), { emitUpdate: false })
  }, [value, editor, mode, allowSource])

  openLinkRef.current = () => setPopover({ kind: 'link', left: 0 })

  function toVisual(force = false) {
    if (!force && hasComplexMarkup(value)) {
      setConfirmVisual(true)
      return
    }
    setConfirmVisual(false)
    editor?.commands.setContent(prepareInputHtml(value), { emitUpdate: false })
    setMode('visual')
  }

  return (
    <div className={`ec-root border border-border-secondary rounded-lg bg-surface-elevated ${className}`}>
      {mode === 'visual' && editor ? (
        <Toolbar
          editor={editor}
          popover={popover}
          setPopover={setPopover}
          extraVariables={extraVariables}
          ctaHref={ctaHref}
          onSource={allowSource ? () => setMode('source') : undefined}
        />
      ) : mode === 'source' ? (
        <div className={`${BAR} flex items-center gap-2 px-2.5`}>
          <span className="text-xs font-semibold uppercase tracking-wide text-foreground-muted">HTML source</span>
          <button
            type="button"
            onClick={() => toVisual()}
            className={`${BTN} control-sm ml-auto px-3 text-xs font-semibold`}
          >
            <PencilLine className="w-4 h-4" />
            Visual editor
          </button>
        </div>
      ) : (
        <div className={BAR} style={{ height: 47 }} />
      )}

      {mode === 'source' && confirmVisual && (
        <div className="flex flex-wrap items-center gap-2 px-3 py-2 text-xs bg-amber-500/5 text-amber-700 dark:text-amber-400 border-b border-amber-500/40">
          <span className="flex-1">
            This HTML has layout markup (tables, divs or images) the visual editor will simplify or drop.
          </span>
          <button type="button" onClick={() => setConfirmVisual(false)} className="underline">
            Keep HTML
          </button>
          <button type="button" onClick={() => toVisual(true)} className="font-semibold underline">
            Switch anyway
          </button>
        </div>
      )}

      {mode === 'source' ? (
        <textarea
          aria-label="Email HTML source"
          value={value}
          onChange={e => {
            lastEmitted.current = e.target.value
            onChange(e.target.value)
          }}
          spellCheck={false}
          className="block w-full px-3 py-3 font-mono text-xs bg-surface text-foreground rounded-b-lg focus:outline-none resize-y"
          style={{ minHeight }}
        />
      ) : (
        <div className="ec-canvas rounded-b-lg" style={{ minHeight }}>
          <EditorContent editor={editor} />
        </div>
      )}
      <style>{EDITOR_CSS}</style>
    </div>
  )
}

function ToolBtn({
  label,
  shortcut,
  active,
  disabled,
  onClick,
  className = 'control-icon',
  children,
}: {
  label: string
  shortcut?: string
  active?: boolean
  disabled?: boolean
  onClick: (e: React.MouseEvent<HTMLButtonElement>) => void
  className?: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={shortcut ? `${label} (${shortcut})` : label}
      aria-pressed={active === undefined ? undefined : active}
      aria-keyshortcuts={shortcut ? shortcut.replace('⌘', 'Meta+').replace('Ctrl+', 'Control+') : undefined}
      disabled={disabled}
      onMouseDown={e => e.preventDefault()}
      onClick={onClick}
      className={`${BTN} control-sm ${className} ${active ? BTN_ON : ''}`}
    >
      {children}
    </button>
  )
}

// Each group draws its divider as a left border; the row is shifted 1px left inside an
// overflow-hidden frame, so a group that wraps to the start of a row shows no stray divider.
function Group({ label, children, className = '' }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div
      role="group"
      aria-label={label}
      className={`flex items-center gap-0.5 px-1.5 border-l border-border-default ${className}`}
    >
      {children}
    </div>
  )
}

function Toolbar({
  editor,
  popover,
  setPopover,
  extraVariables,
  ctaHref,
  onSource,
}: {
  editor: Editor
  popover: PopoverState
  setPopover: (p: PopoverState) => void
  extraVariables?: ComposerVariable[]
  ctaHref?: string
  onSource?: () => void
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const chain = () => editor.chain().focus()
  const ts = editor.getAttributes('textStyle') as { fontFamily?: string; fontSize?: string; color?: string }
  const inLink = editor.isActive('link')
  const toggle = (kind: PopoverKind, e: React.MouseEvent<HTMLElement>) => {
    if (popover?.kind === kind) return setPopover(null)
    const root = rootRef.current?.getBoundingClientRect()
    const btn = e.currentTarget.getBoundingClientRect()
    setPopover({ kind, left: root ? btn.left - root.left : 0 })
  }

  const fontOptions: SelectOption[] = [
    { value: '', label: 'Default font' },
    ...FONT_FAMILIES.map(f => ({ value: f.value, label: f.label })),
    ...(ts.fontFamily && !FONT_FAMILIES.some(f => f.value === ts.fontFamily)
      ? [{ value: ts.fontFamily, label: ts.fontFamily.split(',')[0].replace(/['"]/g, '') }]
      : []),
  ]
  const sizeOptions: SelectOption[] = [
    { value: '', label: 'Size' },
    ...FONT_SIZES.map(s => ({ value: s, label: String(parseInt(s, 10)) })),
    ...(ts.fontSize && !FONT_SIZES.includes(ts.fontSize) ? [{ value: ts.fontSize, label: ts.fontSize }] : []),
  ]

  return (
    <div ref={rootRef} className={`relative ${BAR}`}>
      <div className="overflow-hidden">
        <div role="toolbar" aria-label="Formatting" className="flex flex-wrap items-center gap-y-1.5 -ml-px">
          <Group label="History">
            <ToolBtn
              label="Undo"
              shortcut={`${MOD}Z`}
              disabled={!editor.can().undo()}
              onClick={() => chain().undo().run()}
            >
              <Undo2 className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn
              label="Redo"
              shortcut={`${MOD}Shift+Z`}
              disabled={!editor.can().redo()}
              onClick={() => chain().redo().run()}
            >
              <Redo2 className="w-4 h-4" />
            </ToolBtn>
          </Group>
          <Group label="Text style" className="gap-1.5">
            <AdminSelect
              sm
              className="w-32"
              value={currentBlockType(editor)}
              options={BLOCK_OPTIONS}
              onChange={v => setBlockType(editor, v as BlockType)}
            />
            <AdminSelect
              sm
              className="w-36"
              value={ts.fontFamily || ''}
              options={fontOptions}
              onChange={v => (v ? chain().setFontFamily(v).run() : chain().unsetFontFamily().run())}
            />
            <AdminSelect
              sm
              className="w-20"
              value={ts.fontSize || ''}
              options={sizeOptions}
              onChange={v => (v ? chain().setFontSize(v).run() : chain().unsetFontSize().run())}
            />
          </Group>
          <Group label="Character formatting">
            <ToolBtn
              label="Bold"
              shortcut={`${MOD}B`}
              active={editor.isActive('bold')}
              onClick={() => chain().toggleBold().run()}
            >
              <Bold className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn
              label="Italic"
              shortcut={`${MOD}I`}
              active={editor.isActive('italic')}
              onClick={() => chain().toggleItalic().run()}
            >
              <Italic className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn
              label="Underline"
              shortcut={`${MOD}U`}
              active={editor.isActive('underline')}
              onClick={() => chain().toggleUnderline().run()}
            >
              <Underline className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn
              label="Strikethrough"
              shortcut={`${MOD}Shift+S`}
              active={editor.isActive('strike')}
              onClick={() => chain().toggleStrike().run()}
            >
              <Strikethrough className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn label="Text colour" active={popover?.kind === 'color'} onClick={e => toggle('color', e)}>
              <Palette className="w-4 h-4" style={ts.color ? { color: ts.color } : undefined} />
            </ToolBtn>
          </Group>
          <Group label="Alignment">
            {(
              [
                ['left', 'Align left', 'Shift+L', TextAlignStart],
                ['center', 'Align centre', 'Shift+E', TextAlignCenter],
                ['right', 'Align right', 'Shift+R', TextAlignEnd],
                ['justify', 'Justify', 'Shift+J', TextAlignJustify],
              ] as const
            ).map(([align, label, keys, Icon]) => (
              <ToolBtn
                key={align}
                label={label}
                shortcut={`${MOD}${keys}`}
                active={editor.isActive({ textAlign: align })}
                onClick={() => chain().setTextAlign(align).run()}
              >
                <Icon className="w-4 h-4" />
              </ToolBtn>
            ))}
          </Group>
          <Group label="Blocks">
            <ToolBtn
              label="Bulleted list"
              shortcut={`${MOD}Shift+8`}
              active={editor.isActive('bulletList')}
              onClick={() => chain().toggleBulletList().run()}
            >
              <List className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn
              label="Numbered list"
              shortcut={`${MOD}Shift+7`}
              active={editor.isActive('orderedList')}
              onClick={() => chain().toggleOrderedList().run()}
            >
              <ListOrdered className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn
              label="Quote"
              shortcut={`${MOD}Shift+B`}
              active={editor.isActive('blockquote')}
              onClick={() => chain().toggleBlockquote().run()}
            >
              <Quote className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn label="Divider" onClick={() => chain().setHorizontalRule().run()}>
              <Minus className="w-4 h-4" />
            </ToolBtn>
          </Group>
          <Group label="Insert">
            <ToolBtn
              label={inLink ? 'Edit link' : 'Link'}
              shortcut={`${MOD}K`}
              active={inLink || popover?.kind === 'link'}
              onClick={e => toggle('link', e)}
            >
              <Link2 className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn label="Remove link" disabled={!inLink} onClick={() => removeLink(editor)}>
              <Unlink className="w-4 h-4" />
            </ToolBtn>
            <ToolBtn
              label="Insert button"
              className="px-2.5 text-xs font-semibold"
              active={popover?.kind === 'button'}
              onClick={e => toggle('button', e)}
            >
              <MousePointerClick className="w-4 h-4" />
              Button
            </ToolBtn>
            <ToolBtn label="Clear formatting" onClick={() => clearFormatting(editor)}>
              <RemoveFormatting className="w-4 h-4" />
            </ToolBtn>
          </Group>
          <div role="group" aria-label="Variables and source" className="flex items-center gap-0.5 px-1.5 ml-auto">
            <button
              type="button"
              aria-haspopup="dialog"
              aria-expanded={popover?.kind === 'vars'}
              onMouseDown={e => e.preventDefault()}
              onClick={e => toggle('vars', e)}
              className={`${BTN} control-sm px-2.5 text-xs font-semibold !text-violet-600 dark:!text-violet-400 hover:!bg-violet-500/5 dark:hover:!bg-violet-900/30 ${popover?.kind === 'vars' ? BTN_ON : ''}`}
            >
              <Braces className="w-4 h-4" />
              Insert variable
            </button>
            {onSource && (
              <ToolBtn label="Edit HTML source" onClick={onSource}>
                <CodeXml className="w-4 h-4" />
              </ToolBtn>
            )}
          </div>
        </div>
      </div>

      {popover?.kind === 'color' && (
        <Pop left={popover.left} onClose={() => setPopover(null)} className="w-52">
          <div className="grid grid-cols-5 gap-1.5">
            {COLOR_SWATCHES.map(c => (
              <button
                key={c}
                type="button"
                aria-label={`Colour ${c}`}
                onClick={() => {
                  chain().setColor(c).run()
                  setPopover(null)
                }}
                className={`w-8 h-8 rounded border ${ts.color === c ? 'ring-2 ring-accent-500' : 'border-border-default'}`}
                style={{ background: c }}
              />
            ))}
          </div>
          <div className="flex items-center gap-2 mt-2">
            <label className="flex items-center gap-1.5 text-xs text-foreground-muted">
              Custom
              <input
                type="color"
                aria-label="Custom colour"
                value={ts.color && /^#[0-9a-f]{6}$/i.test(ts.color) ? ts.color : '#111827'}
                onChange={e => chain().setColor(e.target.value).run()}
                className="w-8 h-8 p-0 border-0 bg-transparent"
              />
            </label>
            <button
              type="button"
              onClick={() => {
                chain().unsetColor().run()
                setPopover(null)
              }}
              className="ml-auto text-xs text-foreground-muted hover:text-foreground"
            >
              Reset
            </button>
          </div>
        </Pop>
      )}
      {popover?.kind === 'link' && <LinkDialog editor={editor} left={popover.left} onClose={() => setPopover(null)} />}
      {popover?.kind === 'button' && (
        <ButtonDialog editor={editor} left={popover.left} defaultUrl={ctaHref} onClose={() => setPopover(null)} />
      )}
      {popover?.kind === 'vars' && (
        <VariablePicker
          left={popover.left}
          extra={extraVariables}
          onClose={() => setPopover(null)}
          onPick={key => {
            chain().insertVariable(key).run()
            setPopover(null)
          }}
        />
      )}
    </div>
  )
}

/** Popover under the toolbar, anchored at `left` and clamped inside the composer's width. */
function Pop({
  left = 8,
  onClose,
  className = '',
  children,
}: {
  left?: number
  onClose: () => void
  className?: string
  children: ReactNode
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [x, setX] = useState(left)
  useLayoutEffect(() => {
    const el = ref.current
    const parent = el?.offsetParent as HTMLElement | null
    if (!el || !parent) return
    setX(Math.max(8, Math.min(left, parent.clientWidth - el.offsetWidth - 8)))
  }, [left])
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <button type="button" tabIndex={-1} aria-hidden className="fixed inset-0 z-10 cursor-default" onClick={onClose} />
      <div
        ref={ref}
        role="dialog"
        style={{ left: x }}
        className={`absolute z-20 top-full mt-1 max-w-[calc(100%-16px)] bg-surface-elevated border border-border-default rounded-lg shadow-xl p-2 ${className}`}
      >
        {children}
      </div>
    </>
  )
}

function ButtonDialog({
  editor,
  left,
  defaultUrl,
  onClose,
}: {
  editor: Editor
  left: number
  defaultUrl?: string
  onClose: () => void
}) {
  const [text, setText] = useState('Shop Now')
  const [url, setUrl] = useState(defaultUrl || 'https://')
  const [error, setError] = useState('')
  return (
    <Pop left={left} onClose={onClose} className="w-80 !p-3">
      <form
        onSubmit={e => {
          e.preventDefault()
          const res = applyButton(editor, { url, text })
          if (!res.ok) return setError(res.error)
          onClose()
        }}
        aria-label="Insert button"
      >
        <h3 className="text-xs font-semibold text-foreground mb-2">Insert button</h3>
        <label className="block text-[11px] text-foreground-muted mb-1" htmlFor="ec-btn-text">
          Button text
        </label>
        <input
          id="ec-btn-text"
          autoFocus
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          className={`${INPUT} mb-2`}
        />
        <label className="block text-[11px] text-foreground-muted mb-1" htmlFor="ec-btn-url">
          Link
        </label>
        <input
          id="ec-btn-url"
          type="text"
          inputMode="url"
          value={url}
          onChange={e => {
            setUrl(e.target.value)
            setError('')
          }}
          placeholder="https://example.com, mailto:, tel: or {variable}"
          aria-invalid={!!error}
          className={INPUT}
        />
        {error && (
          <p role="alert" className="text-[11px] text-red-600 dark:text-red-400 mt-1">
            {error}
          </p>
        )}
        <p className="text-[10px] text-foreground-muted mt-1">
          To change it later, click the button text and use Link.
        </p>
        <div className="flex items-center justify-end gap-2 mt-3">
          <button
            type="button"
            onClick={onClose}
            className="px-2.5 py-1 text-xs text-foreground-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1 text-xs bg-accent-500 hover:bg-accent-600 text-white rounded font-medium"
          >
            Insert
          </button>
        </div>
      </form>
    </Pop>
  )
}

function LinkDialog({ editor, left, onClose }: { editor: Editor; left: number; onClose: () => void }) {
  const initial = useMemo(() => getLinkState(editor), [editor])
  const [url, setUrl] = useState(initial.href || 'https://')
  const [text, setText] = useState(initial.text)
  const [error, setError] = useState('')
  const title = initial.inLink ? 'Edit link' : initial.hasSelection ? 'Link selected text' : 'Insert link'

  function submit() {
    const res = applyLink(editor, { url, text })
    if (!res.ok) {
      setError(res.error)
      return
    }
    onClose()
  }

  return (
    <Pop left={left} onClose={onClose} className="w-80 !p-3">
      <form
        onSubmit={e => {
          e.preventDefault()
          submit()
        }}
        aria-label={title}
      >
        <h3 className="text-xs font-semibold text-foreground mb-2">{title}</h3>
        <label className="block text-[11px] text-foreground-muted mb-1" htmlFor="ec-link-text">
          Text
        </label>
        <input
          id="ec-link-text"
          type="text"
          value={text}
          onChange={e => setText(e.target.value)}
          placeholder={initial.hasSelection || initial.inLink ? '' : 'e.g. Track your order'}
          className={`${INPUT} mb-2`}
        />
        <label className="block text-[11px] text-foreground-muted mb-1" htmlFor="ec-link-url">
          URL
        </label>
        <input
          id="ec-link-url"
          autoFocus
          type="text"
          inputMode="url"
          value={url}
          onChange={e => {
            setUrl(e.target.value)
            setError('')
          }}
          placeholder="https://example.com, mailto:, tel: or {variable}"
          aria-invalid={!!error}
          aria-describedby={error ? 'ec-link-err' : undefined}
          className={INPUT}
        />
        {error && (
          <p id="ec-link-err" role="alert" className="text-[11px] text-red-600 dark:text-red-400 mt-1">
            {error}
          </p>
        )}
        <p className="text-[10px] text-foreground-muted mt-1">Opens in a new tab.</p>
        <div className="flex items-center gap-2 mt-3">
          {initial.inLink && (
            <button
              type="button"
              onClick={() => {
                removeLink(editor)
                onClose()
              }}
              className="text-xs text-red-600 dark:text-red-400 hover:underline"
            >
              Remove link
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="ml-auto px-2.5 py-1 text-xs text-foreground-muted hover:text-foreground"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1 text-xs bg-accent-500 hover:bg-accent-600 text-white rounded font-medium"
          >
            {initial.inLink ? 'Update' : 'Apply'}
          </button>
        </div>
      </form>
    </Pop>
  )
}

function VariablePicker({
  left,
  extra,
  onPick,
  onClose,
}: {
  left: number
  extra?: ComposerVariable[]
  onPick: (key: string) => void
  onClose: () => void
}) {
  const vars = useTemplateVariables(extra)
  const [q, setQ] = useState('')
  const sections = groupVariables(vars, q)
  return (
    <Pop left={left} onClose={onClose} className="w-80 max-h-96 overflow-y-auto">
      <div className="relative mb-2">
        <Search className="w-3.5 h-3.5 absolute left-2 top-1/2 -translate-y-1/2 text-foreground-muted" />
        <input
          autoFocus
          type="search"
          aria-label="Search variables"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search variables"
          className={`${INPUT} pl-7 text-xs`}
        />
      </div>
      {sections.length === 0 && <p className="text-xs text-foreground-muted px-2 py-3">No matching variables.</p>}
      {sections.map(s => (
        <div key={s.title} className="mb-2 last:mb-0">
          <p className="text-[10px] font-semibold uppercase tracking-wide text-foreground-muted px-2 py-1">{s.title}</p>
          {s.vars.map(v => (
            <button
              key={v.key}
              type="button"
              onMouseDown={e => e.preventDefault()}
              onClick={() => onPick(v.key)}
              className="w-full text-left px-2 py-1.5 rounded hover:bg-surface-secondary focus:bg-surface-secondary focus:outline-none transition-colors"
            >
              <div className="flex items-center justify-between gap-2">
                <code className="text-xs text-violet-600 dark:text-violet-400 font-mono">{`{${v.key}}`}</code>
                <span className="text-[10px] text-foreground-muted shrink-0">{v.label}</span>
              </div>
              <p className="text-[11px] text-foreground-muted mt-0.5 truncate">
                {v.description}
                {v.sample && <span className="text-foreground-secondary"> · e.g. {v.sample}</span>}
              </p>
            </button>
          ))}
        </div>
      ))}
      <p className="text-[10px] text-foreground-muted px-2 pt-2 border-t border-border-default mt-1">
        Replaced per recipient at send time. Manage variables in Site Controls.
      </p>
    </Pop>
  )
}

// The canvas is always "paper" white so authors see what the recipient sees in either admin theme.
const EDITOR_CSS = `
.ec-root .ec-canvas { background:#ffffff; color:#1f2937; }
.ec-root .ec-content { padding:12px 14px; min-height:inherit; font-size:14px; line-height:1.55; }
.ec-root .ec-canvas > div { min-height:inherit; }
.ec-root .ec-content p { margin:6px 0; }
.ec-root .ec-content h1 { font-size:26px; font-weight:700; margin:14px 0 8px; }
.ec-root .ec-content h2 { font-size:20px; font-weight:700; margin:12px 0 6px; }
.ec-root .ec-content h3 { font-size:17px; font-weight:700; margin:10px 0 6px; }
.ec-root .ec-content ul { list-style:disc; padding-left:28px; margin:8px 0; }
.ec-root .ec-content ol { list-style:decimal; padding-left:28px; margin:8px 0; }
.ec-root .ec-content li > p { margin:2px 0; }
.ec-root .ec-content a { color:#e07b3f; text-decoration:underline; cursor:text; }
.ec-root .ec-content blockquote { margin:8px 0; padding-left:12px; border-left:3px solid #e07b3f; color:#4b5563; }
.ec-root .ec-content hr { border:0; border-top:1px solid #e5e7eb; margin:16px 0; }
.ec-root .ec-content p.is-editor-empty:first-child::before { content:attr(data-placeholder); color:#9ca3af; float:left; height:0; pointer-events:none; }
.ec-root .ec-var { display:inline-block; padding:0 5px; margin:0 1px; border-radius:4px; border:1px solid #c4b5fd; background:#f5f3ff; color:#6d28d9; font:500 12px/1.6 ui-monospace,SFMono-Regular,Menlo,monospace; white-space:nowrap; user-select:all; vertical-align:baseline; }
.ec-root .ec-var.ProseMirror-selectednode { outline:2px solid #7c3aed; outline-offset:1px; }
`
