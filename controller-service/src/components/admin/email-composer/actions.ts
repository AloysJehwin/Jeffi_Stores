import type { Editor } from '@tiptap/core'
import { normalizeLinkUrl, type LinkCheck } from './html'

export const FONT_FAMILIES: Array<{ label: string; value: string }> = [
  { label: 'System sans', value: '-apple-system, BlinkMacSystemFont, Segoe UI, Roboto, Helvetica, Arial, sans-serif' },
  { label: 'Arial', value: 'Arial, Helvetica, sans-serif' },
  { label: 'Verdana', value: 'Verdana, Geneva, sans-serif' },
  { label: 'Trebuchet MS', value: "'Trebuchet MS', Helvetica, sans-serif" },
  { label: 'Georgia', value: 'Georgia, serif' },
  { label: 'Times New Roman', value: "'Times New Roman', Times, serif" },
  { label: 'Courier New', value: "'Courier New', Courier, monospace" },
]

export const FONT_SIZES = ['12px', '14px', '16px', '18px', '20px', '24px', '28px', '32px']

export const COLOR_SWATCHES = [
  '#111827',
  '#4b5563',
  '#9ca3af',
  '#1a3a4a',
  '#e07b3f',
  '#dc2626',
  '#d97706',
  '#16a34a',
  '#2563eb',
  '#7c3aed',
]

export type BlockType = 'paragraph' | 'h1' | 'h2' | 'h3'

export function currentBlockType(editor: Editor): BlockType {
  for (const level of [1, 2, 3] as const) if (editor.isActive('heading', { level })) return `h${level}`
  return 'paragraph'
}

export function setBlockType(editor: Editor, type: BlockType) {
  const chain = editor.chain().focus()
  if (type === 'paragraph') chain.setParagraph().run()
  else chain.setHeading({ level: Number(type.slice(1)) as 1 | 2 | 3 }).run()
}

export interface LinkState {
  inLink: boolean
  href: string
  hasSelection: boolean
  text: string
}

export function getLinkState(editor: Editor): LinkState {
  const inLink = editor.isActive('link')
  const { from, to, empty } = editor.state.selection
  let text = empty ? '' : editor.state.doc.textBetween(from, to, ' ')
  if (inLink && empty) {
    const $pos = editor.state.selection.$from
    const linkType = editor.schema.marks.link
    const parent = $pos.parent
    let start = $pos.parentOffset
    let end = $pos.parentOffset
    const marked = (i: number) => {
      const child = parent.childAfter(i)
      return !!child.node && linkType.isInSet(child.node.marks)
    }
    while (start > 0 && marked(start - 1)) start--
    while (end < parent.content.size && marked(end)) end++
    text = parent.textBetween(start, end, ' ')
  }
  return { inLink, href: (editor.getAttributes('link').href as string) || '', hasSelection: !empty, text }
}

/** Insert a new link, convert the selection into one, or edit the link under the cursor. */
export function applyLink(editor: Editor, input: { url: string; text?: string }): LinkCheck {
  const check = normalizeLinkUrl(input.url)
  if (!check.ok) return check
  const href = check.href
  const text = (input.text || '').trim()
  const state = getLinkState(editor)
  const linkMark = { type: 'link', attrs: { href } }

  if (state.inLink) {
    const chain = editor.chain().focus().extendMarkRange('link')
    if (text && text !== state.text) {
      const style = editor.getAttributes('link').style ?? null
      chain.insertContent({ type: 'text', text, marks: [{ type: 'link', attrs: { href, style } }] }).run()
    } else {
      chain.updateAttributes('link', { href }).run()
    }
    return check
  }
  if (state.hasSelection) {
    if (text && text !== state.text) {
      editor
        .chain()
        .focus()
        .insertContent({ type: 'text', text, marks: [linkMark] })
        .run()
    } else {
      editor.chain().focus().setLink({ href }).run()
    }
    return check
  }
  editor
    .chain()
    .focus()
    .insertContent([{ type: 'text', text: text || href, marks: [linkMark] }])
    .unsetMark('link')
    .insertContent(' ')
    .run()
  return check
}

export function removeLink(editor: Editor) {
  editor.chain().focus().extendMarkRange('link').unsetLink().run()
}

export const CTA_STYLE =
  'display:inline-block;background:#e07b3f;color:#ffffff;text-decoration:none;padding:12px 28px;border-radius:6px;font-weight:600;font-size:15px;'

export function insertCta(editor: Editor, href = 'https://{store_web}', label = 'Shop Now') {
  editor
    .chain()
    .focus()
    .insertContent(
      `<p style="text-align:center;margin:24px 0;"><a href="${href}" target="_blank" rel="noopener" style="${CTA_STYLE}">${label}</a></p><p></p>`
    )
    .run()
}

const escHtml = (v: string) => v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Button = a styled CTA link: same URL rules as a hyperlink ({variables}, mailto:, tel: allowed). */
export function applyButton(editor: Editor, input: { url: string; text?: string }): LinkCheck {
  const check = normalizeLinkUrl(input.url)
  if (!check.ok) return check
  insertCta(editor, escHtml(check.href), escHtml((input.text || '').trim() || 'Shop Now'))
  return check
}

export function clearFormatting(editor: Editor) {
  editor
    .chain()
    .focus()
    .unsetAllMarks()
    .clearNodes()
    .resetAttributes('paragraph', ['blockStyle', 'textAlign'])
    .resetAttributes('heading', ['blockStyle', 'textAlign'])
    .run()
}
