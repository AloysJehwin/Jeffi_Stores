'use client'

import Link from 'next/link'
import { Fragment, ReactNode } from 'react'
import { CheckCircle2 } from 'lucide-react'
import { ap } from '@/lib/shared/admin-path'
import { fmtQty } from './agent/format'
import type { QuotationConfirmItem } from './agent/QuotationResolver'

const ENTITY_ROUTES: Record<string, (id: string) => string> = {
  product: id => `/admin/products/${id}`,
  order: id => `/admin/orders/${id}/view`,
  customer: id => `/admin/customers/${id}/view`,
  campaign: kind => `/admin/campaigns/${kind}`,
}

const ENTITY_RE = /\[\[(product|order|customer|campaign):([^|\]]+)\|([^\]]+)\]\]/g
// Bold, italic and inline code, in one pass so their markers never nest wrongly.
const EMPH_RE = /`([^`\n]+)`|\*\*([^*]+)\*\*|(?<![\w*])\*([^*\s][^*\n]*?)\*(?![\w*])|(?<![\w_])_([^_\s][^_\n]*?)_(?![\w_])/g
const IMAGE_MD_RE = /!\[([^\]]*)\]\(([^)\s]+)\)/g
const LINK_MD_RE = /(?<!\!)\[([^\]]+)\]\(([^)\s]+)\)/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  type Token =
    | { kind: 'text'; value: string }
    | { kind: 'img'; alt: string; src: string }
    | { kind: 'link'; label: string; href: string }
  const tokens: Token[] = [{ kind: 'text', value: text }]

  const afterImg: Token[] = []
  for (const t of tokens) {
    if (t.kind !== 'text') {
      afterImg.push(t)
      continue
    }
    let last = 0
    IMAGE_MD_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = IMAGE_MD_RE.exec(t.value)) !== null) {
      if (m.index > last) afterImg.push({ kind: 'text', value: t.value.slice(last, m.index) })
      afterImg.push({ kind: 'img', alt: m[1] || '', src: m[2] })
      last = m.index + m[0].length
    }
    if (last < t.value.length) afterImg.push({ kind: 'text', value: t.value.slice(last) })
  }

  const afterLink: Token[] = []
  for (const t of afterImg) {
    if (t.kind !== 'text') {
      afterLink.push(t)
      continue
    }
    let last = 0
    LINK_MD_RE.lastIndex = 0
    let m: RegExpExecArray | null
    while ((m = LINK_MD_RE.exec(t.value)) !== null) {
      if (m.index > last) afterLink.push({ kind: 'text', value: t.value.slice(last, m.index) })
      afterLink.push({ kind: 'link', label: m[1], href: m[2] })
      last = m.index + m[0].length
    }
    if (last < t.value.length) afterLink.push({ kind: 'text', value: t.value.slice(last) })
  }

  const out: ReactNode[] = []
  let idx = 0
  for (const t of afterLink) {
    if (t.kind === 'img') {
      out.push(
        <img
          key={`${keyPrefix}-img${idx++}`}
          src={t.src}
          alt={t.alt}
          loading="lazy"
          className="inline-block w-12 h-12 rounded border border-border-default object-cover align-middle mr-1"
        />
      )
      continue
    }
    if (t.kind === 'link') {
      const isExternal = /^https?:\/\//i.test(t.href)
      if (!isExternal && t.href.startsWith('/')) {
        out.push(
          <Link
            key={`${keyPrefix}-a${idx++}`}
            href={t.href.startsWith('/admin') ? ap(t.href) : t.href}
            className="text-accent-600 dark:text-accent-400 underline decoration-dotted underline-offset-2 hover:decoration-solid"
          >
            {t.label}
          </Link>
        )
        continue
      }
      out.push(
        <a
          key={`${keyPrefix}-a${idx++}`}
          href={t.href}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noreferrer noopener' : undefined}
          className="text-accent-600 dark:text-accent-400 underline decoration-dotted underline-offset-2 hover:decoration-solid"
        >
          {t.label}
        </a>
      )
      continue
    }
    out.push(...renderInlineText(t.value, `${keyPrefix}-t${idx++}`))
  }
  return out
}

function renderInlineText(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0
  ENTITY_RE.lastIndex = 0
  while ((match = ENTITY_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(...renderEmphasis(text.slice(lastIndex, match.index), `${keyPrefix}-t${i++}`))
    }
    const [, kind, id, label] = match
    const builder = ENTITY_ROUTES[kind]
    const href = builder ? ap(builder(id.trim())) : null
    if (href) {
      out.push(
        <Link
          key={`${keyPrefix}-l${i++}`}
          href={href}
          className="text-accent-600 dark:text-accent-400 underline decoration-dotted underline-offset-2 hover:decoration-solid font-medium"
        >
          {label.trim()}
        </Link>
      )
    } else {
      out.push(<span key={`${keyPrefix}-x${i++}`}>{label.trim()}</span>)
    }
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) {
    out.push(...renderEmphasis(text.slice(lastIndex), `${keyPrefix}-tail${i++}`))
  }
  return out
}

function renderEmphasis(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0
  EMPH_RE.lastIndex = 0
  while ((match = EMPH_RE.exec(text)) !== null) {
    if (match.index > lastIndex)
      out.push(<Fragment key={`${keyPrefix}-${i++}`}>{text.slice(lastIndex, match.index)}</Fragment>)
    const [, code, bold, star, under] = match
    if (code !== undefined)
      out.push(
        <code key={`${keyPrefix}-c${i++}`} className="px-1 py-0.5 rounded bg-surface text-[0.85em] font-mono">
          {code}
        </code>
      )
    else if (bold !== undefined)
      out.push(
        <strong key={`${keyPrefix}-b${i++}`} className="font-semibold">
          {bold}
        </strong>
      )
    else out.push(<em key={`${keyPrefix}-i${i++}`}>{star ?? under}</em>)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) out.push(<Fragment key={`${keyPrefix}-${i++}`}>{text.slice(lastIndex)}</Fragment>)
  return out
}

interface Block {
  type: 'p' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'table' | 'code' | 'quote' | 'hr'
  content: string[]
  cells?: string[][]
}

function parseBlocks(src: string): Block[] {
  const lines = src.split(/\r?\n/)
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) {
      i++
      continue
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) {
      blocks.push({ type: 'hr', content: [] })
      i++
      continue
    }
    if (/^#{4,6} /.test(line)) {
      blocks.push({ type: 'h3', content: [line.replace(/^#{4,6} /, '')] })
      i++
      continue
    }
    if (line.startsWith('> ') || line === '>') {
      const buf: string[] = []
      while (i < lines.length && (lines[i].startsWith('> ') || lines[i] === '>')) {
        buf.push(lines[i].replace(/^>\s?/, ''))
        i++
      }
      blocks.push({ type: 'quote', content: buf })
      continue
    }
    if (line.startsWith('### ')) {
      blocks.push({ type: 'h3', content: [line.slice(4)] })
      i++
      continue
    }
    if (line.startsWith('## ')) {
      blocks.push({ type: 'h2', content: [line.slice(3)] })
      i++
      continue
    }
    if (line.startsWith('# ')) {
      blocks.push({ type: 'h1', content: [line.slice(2)] })
      i++
      continue
    }
    if (line.startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) {
        buf.push(lines[i])
        i++
      }
      i++
      blocks.push({ type: 'code', content: buf })
      continue
    }
    if (/^\s*[-*]\s+/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*[-*]\s+/, ''))
        i++
      }
      blocks.push({ type: 'ul', content: buf })
      continue
    }
    if (/^\s*\d+\.\s+/.test(line)) {
      const buf: string[] = []
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        buf.push(lines[i].replace(/^\s*\d+\.\s+/, ''))
        i++
      }
      blocks.push({ type: 'ol', content: buf })
      continue
    }
    if (line.includes('|') && lines[i + 1] && /^\s*\|?\s*-+/.test(lines[i + 1])) {
      const cells: string[][] = []
      const splitRow = (s: string) =>
        s
          .replace(/^\s*\|/, '')
          .replace(/\|\s*$/, '')
          .split('|')
          .map(c => c.trim())
      cells.push(splitRow(line))
      i += 2
      while (i < lines.length && lines[i].includes('|')) {
        cells.push(splitRow(lines[i]))
        i++
      }
      blocks.push({ type: 'table', content: [], cells })
      continue
    }
    const buf: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^([-*#>]|\d+\.)\s/.test(lines[i]) && !lines[i].includes('|')) {
      buf.push(lines[i])
      i++
    }
    blocks.push({ type: 'p', content: buf })
  }
  return blocks
}

export default function AdminAgentMessage({ text, cursor }: { text: string; cursor?: boolean }) {
  const blocks = parseBlocks(text)
  return (
    <div className="space-y-2 text-sm leading-relaxed break-words">
      {blocks.map((b, idx) => {
        const k = `b${idx}`
        switch (b.type) {
          case 'hr':
            return <hr key={k} className="border-border-default" />
          case 'quote':
            return (
              <blockquote key={k} className="border-l-2 border-border-default pl-3 text-foreground-muted whitespace-pre-wrap">
                {renderInline(b.content.join('\n'), k)}
              </blockquote>
            )
          case 'h1':
            return (
              <h3 key={k} className="text-base font-bold mt-2">
                {renderInline(b.content[0], k)}
              </h3>
            )
          case 'h2':
            return (
              <h4 key={k} className="text-sm font-bold mt-2">
                {renderInline(b.content[0], k)}
              </h4>
            )
          case 'h3':
            return (
              <h5 key={k} className="text-xs font-bold uppercase tracking-wide mt-1 opacity-80">
                {renderInline(b.content[0], k)}
              </h5>
            )
          case 'ul':
            return (
              <ul key={k} className="list-disc pl-5 space-y-0.5">
                {b.content.map((c, i) => (
                  <li key={`${k}-${i}`}>{renderInline(c, `${k}-${i}`)}</li>
                ))}
              </ul>
            )
          case 'ol':
            return (
              <ol key={k} className="list-decimal pl-5 space-y-0.5">
                {b.content.map((c, i) => (
                  <li key={`${k}-${i}`}>{renderInline(c, `${k}-${i}`)}</li>
                ))}
              </ol>
            )
          case 'code':
            return (
              <pre
                key={k}
                className="text-[11px] font-mono bg-surface-secondary text-foreground rounded p-2 overflow-x-auto"
              >
                {b.content.join('\n')}
              </pre>
            )
          case 'table':
            return (
              <div key={k} className="overflow-x-auto -mx-1">
                <table className="text-xs border-collapse w-full">
                  <thead>
                    <tr className="border-b border-border-default">
                      {b.cells![0].map((c, i) => (
                        <th key={i} className="text-left font-semibold py-1.5 px-2">
                          {renderInline(c, `${k}-h${i}`)}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.cells!.slice(1).map((row, ri) => (
                      <tr key={ri} className="border-b border-border-default">
                        {row.map((c, ci) => (
                          <td key={ci} className="py-1.5 px-2 align-top">
                            {renderInline(c, `${k}-${ri}-${ci}`)}
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          default:
            return (
              <p key={k} className="whitespace-pre-wrap">
                {renderInline(b.content.join('\n'), k)}
              </p>
            )
        }
      })}
      {cursor && (
        <span className="inline-block w-1.5 h-4 -mt-1 bg-foreground-muted animate-pulse align-middle" aria-hidden="true" />
      )}
    </div>
  )
}

// Control messages the UI sends on the admin's behalf; shown as what they mean, not raw text.
const QUOTATION_CONFIRM = '__quotation_confirm__'

export function parseQuotationConfirm(text: string): Partial<QuotationConfirmItem>[] | null {
  if (!text.startsWith(QUOTATION_CONFIRM)) return null
  try {
    const items = JSON.parse(text.slice(QUOTATION_CONFIRM.length))
    return Array.isArray(items) ? items.filter(i => i && typeof i === 'object') : []
  } catch {
    return []
  }
}

/** One-line stand-in for a control message (chat list previews); null for ordinary text. */
export function internalMessageLabel(text: string | null | undefined): string | null {
  const items = text ? parseQuotationConfirm(text) : null
  if (!items) return null
  const n = items.filter(i => !i.skipped).length
  return `Confirmed ${n} item${n === 1 ? '' : 's'} for the quotation`
}

/** A user bubble's content: plain text, or a readable summary of a control message. */
export function AdminAgentUserMessage({ text }: { text: string }) {
  const items = parseQuotationConfirm(text)
  if (!items) return <p className="whitespace-pre-wrap leading-relaxed [overflow-wrap:anywhere]">{text}</p>
  const skipped = items.filter(i => i.skipped).length
  return (
    <div className="space-y-1.5">
      <p className="flex items-center gap-1.5 font-medium">
        <CheckCircle2 className="h-3.5 w-3.5 shrink-0" />
        <span>
          {internalMessageLabel(text)}
          {skipped > 0 && <span className="font-normal opacity-80"> · {skipped} skipped</span>}
        </span>
      </p>
      {items.length > 0 && (
        <ul className="space-y-0.5 border-t border-white/20 pt-1.5 text-xs">
          {items.map((it, i) => (
            <li key={i} className="flex items-baseline justify-between gap-3">
              <span className={`min-w-0 [overflow-wrap:anywhere] ${it.skipped ? 'line-through opacity-70' : ''}`}>
                {it.requestedText || `Item ${i + 1}`}
              </span>
              <span className="shrink-0 tabular-nums opacity-90">
                {it.skipped ? 'skipped' : `→ ${fmtQty(it.quantity)} ${it.buyUnit || 'pcs'}`}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
