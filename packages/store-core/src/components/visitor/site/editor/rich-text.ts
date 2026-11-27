import { Editor, Node as TNode } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import type { DesignOp } from '@jeffi/site-blocks/design'
import type { CodeNode } from '@jeffi/site-blocks'
import { safeHref } from '@/lib/site/code/allow'
import { commitOps, normalizeHref, toChildren, type DocJson } from './rich-convert'

// Inline rich text on the canvas (docs/plans/site-builder-canvas-editor-research.md, "Text"): a vanilla Tiptap editor
// mounted on the element itself, loaded on the first rich edit only (SiteEditorBridge imports this lazily). The element
// is the block, so the document is inline content only: text, line breaks, and bold / italic / underline / strike /
// link. A small toolbar floats above it (inline styles, `data-e-overlay`). The commit's JSON becomes CodeNode children
// (rich-convert.ts), painted back into the element; Tiptap's own markup and attributes never reach the tree.

const NOTE = 'Links go to https://…, a /page, #anchor, mailto: or tel:'

// The document is the element's content: no paragraph around it.
const Doc = TNode.create({ name: 'doc', topNode: true, content: 'inline*' })
const Txt = TNode.create({ name: 'text', group: 'inline' })

export interface RichSession {
  /** Ends the edit: `keep` reports the change (null when nothing changed), else the element is put back. */
  finish(keep: boolean): { ops: DesignOp[]; rich: boolean } | null
  /** Follows the element after a scroll or resize. */
  refresh(): void
}

const BTN = 'all:unset;box-sizing:border-box;min-width:28px;height:28px;padding:0 6px;display:inline-flex;align-items:center;justify-content:center;border-radius:6px;cursor:pointer;font:600 13px system-ui,sans-serif;color:#18181b'

function paint(el: HTMLElement, kids: CodeNode[]) {
  const doc = el.ownerDocument
  const build = (list: CodeNode[], into: Node) => {
    for (const c of list) {
      if (c.t === 'text') into.appendChild(doc.createTextNode(c.value))
      else if (c.t === 'el') {
        const x = doc.createElement(c.tag)
        const href = c.props.href
        if (c.tag === 'a' && href?.k === 'lit' && typeof href.v === 'string') x.setAttribute('href', href.v)
        build(c.children, x)
        into.appendChild(x)
      }
    }
  }
  el.textContent = ''
  build(kids, el)
}

export function mountRich(el: HTMLElement, wasText: boolean): RichSession {
  const doc = el.ownerDocument
  const win = doc.defaultView ?? window
  const html0 = el.innerHTML
  const attrs0 = [...el.attributes].map(a => [a.name, a.value] as const)
  const id = el.dataset.e ?? ''
  const tag = el.tagName.toLowerCase()

  const editor = new Editor({
    element: { mount: el },
    content: html0,
    extensions: [
      Doc,
      Txt,
      StarterKit.configure({
        document: false,
        text: false,
        paragraph: false,
        blockquote: false,
        bulletList: false,
        orderedList: false,
        listItem: false,
        listKeymap: false,
        code: false,
        codeBlock: false,
        heading: false,
        horizontalRule: false,
        dropcursor: false,
        gapcursor: false,
        trailingNode: false,
        link: { openOnClick: false, autolink: false, linkOnPaste: false, HTMLAttributes: { rel: null, target: null, class: null }, isAllowedUri: url => safeHref(url) !== null },
      }),
    ],
    editorProps: {
      // Pasted content goes in as plain text on one line, as in plain editing.
      handlePaste: (view, e) => {
        const text = (e.clipboardData?.getData('text/plain') ?? '').replace(/\s*\n\s*/g, ' ')
        if (text) view.dispatch(view.state.tr.insertText(text).scrollIntoView())
        return true
      },
      handleDrop: () => true,
    },
  })
  const initial = JSON.stringify(editor.getJSON())

  // ── Toolbar ──
  const bar = doc.createElement('div')
  bar.setAttribute('data-e-overlay', '')
  bar.setAttribute('role', 'toolbar')
  bar.setAttribute('aria-label', 'Text formatting')
  bar.style.cssText = 'position:fixed;z-index:2147483646;display:flex;flex-direction:column;gap:4px;padding:4px;background:#fff;border:1px solid #d4d4d8;border-radius:8px;box-shadow:0 4px 14px rgba(0,0,0,.18);font:12px system-ui,sans-serif;color:#18181b'
  const row = doc.createElement('div')
  row.style.cssText = 'display:flex;gap:2px;align-items:center'
  const linkRow = doc.createElement('div')
  linkRow.style.cssText = 'display:none;gap:4px;align-items:center'
  const note = doc.createElement('div')
  note.style.cssText = 'display:none;max-width:260px;padding:0 4px 2px;color:#b91c1c'
  note.setAttribute('role', 'status')
  bar.append(row, linkRow, note)

  const buttons: { b: HTMLButtonElement; active: () => boolean }[] = []
  const button = (label: string, title: string, face: string, run: () => void, active: () => boolean = () => false) => {
    const b = doc.createElement('button')
    b.type = 'button'
    b.setAttribute('aria-label', title)
    b.title = title
    b.style.cssText = BTN + (face ? `;${face}` : '')
    b.textContent = label
    // The editor keeps focus (and its selection) while a button is used.
    b.addEventListener('mousedown', e => e.preventDefault())
    b.addEventListener('click', run)
    row.appendChild(b)
    buttons.push({ b, active })
  }
  const chain = () => editor.chain().focus()
  button('B', 'Bold (Ctrl/Cmd+B)', '', () => chain().toggleBold().run(), () => editor.isActive('bold'))
  button('I', 'Italic (Ctrl/Cmd+I)', 'font-style:italic;font-weight:500', () => chain().toggleItalic().run(), () => editor.isActive('italic'))
  button('U', 'Underline (Ctrl/Cmd+U)', 'text-decoration:underline;font-weight:500', () => chain().toggleUnderline().run(), () => editor.isActive('underline'))
  button('S', 'Strikethrough', 'text-decoration:line-through;font-weight:500', () => chain().toggleStrike().run(), () => editor.isActive('strike'))

  const say = (msg: string) => {
    note.textContent = msg
    note.style.display = msg ? 'block' : 'none'
    place()
  }
  const input = doc.createElement('input')
  input.type = 'text'
  input.placeholder = 'https://… or /page'
  input.setAttribute('aria-label', 'Link address')
  input.style.cssText = 'box-sizing:border-box;width:200px;height:28px;padding:0 8px;border:1px solid #d4d4d8;border-radius:6px;font:13px system-ui,sans-serif;color:#18181b;background:#fff'
  const set = doc.createElement('button')
  set.type = 'button'
  set.textContent = 'Set'
  set.style.cssText = BTN + ';background:#18181b;color:#fff'
  const closeLink = () => {
    linkRow.style.display = 'none'
    say('')
    editor.commands.focus()
  }
  const apply = () => {
    const href = normalizeHref(input.value)
    if (!href) return say(NOTE)
    if (editor.state.selection.empty && !editor.isActive('link')) return say('Select the words to link first')
    chain().extendMarkRange('link').setLink({ href }).run()
    closeLink()
  }
  set.addEventListener('click', apply)
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') {
      e.preventDefault()
      apply()
    } else if (e.key === 'Escape') {
      e.preventDefault()
      closeLink()
    }
  })
  input.addEventListener('input', () => say(''))
  linkRow.append(input, set)

  button('Link', 'Link', 'font-weight:500', () => {
    linkRow.style.display = 'flex'
    input.value = (editor.getAttributes('link').href as string | undefined) ?? ''
    place()
    input.focus()
    input.select()
  }, () => editor.isActive('link'))
  button('Unlink', 'Remove link', 'font-weight:500', () => {
    chain().extendMarkRange('link').unsetLink().run()
    closeLink()
  })

  const sync = () => buttons.forEach(({ b, active }) => b.setAttribute('aria-pressed', String(active())))
  const place = () => {
    const r = el.getBoundingClientRect()
    const h = bar.offsetHeight || 40
    const w = bar.offsetWidth || 240
    const above = r.top - h - 8
    bar.style.top = `${Math.round(above >= 4 ? above : Math.min(r.bottom + 8, win.innerHeight - h - 4))}px`
    bar.style.left = `${Math.round(Math.max(4, Math.min(r.left, win.innerWidth - w - 4)))}px`
  }
  doc.body.appendChild(bar)
  sync()
  place()
  editor.on('transaction', () => {
    sync()
    place()
  })
  editor.commands.focus('all')

  return {
    refresh: place,
    finish(keep) {
      const json = editor.getJSON() as DocJson
      editor.destroy()
      bar.remove()
      // Tiptap's attributes and classes on the element go; its own come back.
      for (const a of [...el.attributes]) if (!attrs0.some(([n]) => n === a.name)) el.removeAttribute(a.name)
      for (const [n, v] of attrs0) if (el.getAttribute(n) !== v) el.setAttribute(n, v)
      if (!keep || JSON.stringify(json) === initial) {
        el.innerHTML = html0
        return null
      }
      paint(el, toChildren(json))
      return commitOps(id, tag, json, wasText)
    },
  }
}
