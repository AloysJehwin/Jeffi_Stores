import { Extension, InputRule, Node, type Extensions } from '@tiptap/core'
import StarterKit from '@tiptap/starter-kit'
import Link from '@tiptap/extension-link'
import TextAlign from '@tiptap/extension-text-align'
import { Color, FontFamily, FontSize, TextStyle } from '@tiptap/extension-text-style'
import { Placeholder } from '@tiptap/extensions'
import { isSafeHref, stripStyleProps, VAR_KEY } from './html'

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    variable: {
      insertVariable: (key: string) => ReturnType
    }
  }
}

/**
 * Atomic inline variable: a non-editable chip in the editor, emitted as the bare token `{key}` (no
 * wrapper, no styles) so nothing styled is ever mailed and typed text can never merge into it.
 */
export const VariableNode = Node.create({
  name: 'variable',
  group: 'inline',
  inline: true,
  atom: true,
  selectable: true,
  draggable: false,

  addAttributes() {
    return {
      key: {
        default: '',
        parseHTML: el => el.getAttribute('data-variable') || '',
        renderHTML: () => ({}),
      },
    }
  },

  parseHTML() {
    return [{ tag: 'span[data-variable]' }]
  },

  // serializeEmailHtml() reduces this to the bare `{key}`; the marker keeps copy/paste round-trips as chips.
  renderHTML({ node }) {
    return ['span', { 'data-variable': node.attrs.key }, `{${node.attrs.key}}`]
  },

  renderText({ node }) {
    return `{${node.attrs.key}}`
  },

  addNodeView() {
    return ({ node }) => {
      const dom = document.createElement('span')
      dom.className = 'ec-var'
      dom.contentEditable = 'false'
      dom.setAttribute('data-variable-chip', node.attrs.key)
      dom.setAttribute('title', `Replaced per recipient: {${node.attrs.key}}`)
      dom.textContent = `{${node.attrs.key}}`
      return { dom }
    }
  },

  addCommands() {
    return {
      insertVariable:
        key =>
        ({ commands }) =>
          commands.insertContent([
            { type: this.name, attrs: { key } },
            { type: 'text', text: ' ' },
          ]),
    }
  },

  addInputRules() {
    // Typing `{key}` or `{{key}}` converts to a chip (single form only when not part of `{{`).
    const find = new RegExp(`(?:\\{\\{\\s*(${VAR_KEY})\\s*\\}\\}|(?<!\\{)\\{(${VAR_KEY})\\})$`)
    return [
      new InputRule({
        find,
        handler: ({ state, range, match }) => {
          const key = match[1] || match[2]
          state.tr.replaceWith(range.from, range.to, this.type.create({ key }))
        },
      }),
    ]
  },
})

/** Keeps the author's inline block styles (margins, backgrounds, borders) — TextAlign owns text-align. */
export const PreservedBlockStyle = Extension.create({
  name: 'preservedBlockStyle',
  addGlobalAttributes() {
    return [
      {
        types: ['paragraph', 'heading', 'blockquote', 'bulletList', 'orderedList', 'listItem'],
        attributes: {
          blockStyle: {
            default: null,
            parseHTML: el => stripStyleProps(el.getAttribute('style'), ['text-align']),
            renderHTML: attrs => (attrs.blockStyle ? { style: attrs.blockStyle } : {}),
          },
        },
      },
    ]
  },
})

/** Links: safe schemes only, target=_blank rel=noopener, and inline styles kept (CTA buttons). */
export const EmailLink = Link.extend({
  addAttributes() {
    return {
      ...this.parent?.(),
      style: {
        default: null,
        parseHTML: el => el.getAttribute('style'),
        renderHTML: attrs => (attrs.style ? { style: attrs.style } : {}),
      },
    }
  },
}).configure({
  openOnClick: false,
  autolink: true,
  linkOnPaste: true,
  defaultProtocol: 'https',
  protocols: ['mailto', 'tel'],
  HTMLAttributes: { target: '_blank', rel: 'noopener', class: null },
  isAllowedUri: url => isSafeHref(url),
  shouldAutoLink: url => isSafeHref(/^[a-z]+:/i.test(url) ? url : `https://${url}`),
})

export function buildExtensions(placeholder: string): Extensions {
  return [
    StarterKit.configure({
      heading: { levels: [1, 2, 3] },
      code: false,
      codeBlock: false,
      link: false,
      trailingNode: false,
    }),
    EmailLink,
    TextAlign.configure({ types: ['heading', 'paragraph'], alignments: ['left', 'center', 'right', 'justify'] }),
    TextStyle,
    FontFamily,
    FontSize,
    Color,
    Placeholder.configure({ placeholder }),
    PreservedBlockStyle,
    VariableNode,
  ]
}
