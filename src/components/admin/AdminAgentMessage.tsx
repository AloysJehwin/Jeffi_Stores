'use client'

import Link from 'next/link'
import { Fragment, ReactNode } from 'react'

const ENTITY_ROUTES: Record<string, (id: string) => string> = {
  product: id => `/admin/products/${id}`,
  order: id => `/admin/orders/${id}`,
  customer: id => `/admin/customers/${id}`,
  campaign: kind => `/admin/campaigns/${kind}`,
}

const ENTITY_RE = /\[\[(product|order|customer|campaign):([^|\]]+)\|([^\]]+)\]\]/g
const BOLD_RE = /\*\*([^*]+)\*\*/g

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0
  ENTITY_RE.lastIndex = 0
  while ((match = ENTITY_RE.exec(text)) !== null) {
    if (match.index > lastIndex) {
      out.push(...renderBold(text.slice(lastIndex, match.index), `${keyPrefix}-t${i++}`))
    }
    const [, kind, id, label] = match
    const builder = ENTITY_ROUTES[kind]
    const href = builder ? builder(id.trim()) : null
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
    out.push(...renderBold(text.slice(lastIndex), `${keyPrefix}-tail${i++}`))
  }
  return out
}

function renderBold(text: string, keyPrefix: string): ReactNode[] {
  const out: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0
  BOLD_RE.lastIndex = 0
  while ((match = BOLD_RE.exec(text)) !== null) {
    if (match.index > lastIndex) out.push(<Fragment key={`${keyPrefix}-${i++}`}>{text.slice(lastIndex, match.index)}</Fragment>)
    out.push(<strong key={`${keyPrefix}-b${i++}`} className="font-semibold">{match[1]}</strong>)
    lastIndex = match.index + match[0].length
  }
  if (lastIndex < text.length) out.push(<Fragment key={`${keyPrefix}-${i++}`}>{text.slice(lastIndex)}</Fragment>)
  return out
}

interface Block {
  type: 'p' | 'h1' | 'h2' | 'h3' | 'ul' | 'ol' | 'table' | 'code'
  content: string[]
  cells?: string[][]
}

function parseBlocks(src: string): Block[] {
  const lines = src.split(/\r?\n/)
  const blocks: Block[] = []
  let i = 0
  while (i < lines.length) {
    const line = lines[i]
    if (!line.trim()) { i++; continue }
    if (line.startsWith('### ')) { blocks.push({ type: 'h3', content: [line.slice(4)] }); i++; continue }
    if (line.startsWith('## ')) { blocks.push({ type: 'h2', content: [line.slice(3)] }); i++; continue }
    if (line.startsWith('# ')) { blocks.push({ type: 'h1', content: [line.slice(2)] }); i++; continue }
    if (line.startsWith('```')) {
      const buf: string[] = []
      i++
      while (i < lines.length && !lines[i].startsWith('```')) { buf.push(lines[i]); i++ }
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
      const splitRow = (s: string) => s.replace(/^\s*\|/, '').replace(/\|\s*$/, '').split('|').map(c => c.trim())
      cells.push(splitRow(line))
      i += 2
      while (i < lines.length && lines[i].includes('|')) { cells.push(splitRow(lines[i])); i++ }
      blocks.push({ type: 'table', content: [], cells })
      continue
    }
    const buf: string[] = [line]
    i++
    while (i < lines.length && lines[i].trim() && !/^([-*#>]|\d+\.)\s/.test(lines[i]) && !lines[i].includes('|')) {
      buf.push(lines[i]); i++
    }
    blocks.push({ type: 'p', content: buf })
  }
  return blocks
}

export default function AdminAgentMessage({ text }: { text: string }) {
  const blocks = parseBlocks(text)
  return (
    <div className="space-y-2 text-sm leading-relaxed">
      {blocks.map((b, idx) => {
        const k = `b${idx}`
        switch (b.type) {
          case 'h1':
            return <h3 key={k} className="text-base font-bold mt-2">{renderInline(b.content[0], k)}</h3>
          case 'h2':
            return <h4 key={k} className="text-sm font-bold mt-2">{renderInline(b.content[0], k)}</h4>
          case 'h3':
            return <h5 key={k} className="text-xs font-bold uppercase tracking-wide mt-1 opacity-80">{renderInline(b.content[0], k)}</h5>
          case 'ul':
            return (
              <ul key={k} className="list-disc pl-5 space-y-0.5">
                {b.content.map((c, i) => <li key={`${k}-${i}`}>{renderInline(c, `${k}-${i}`)}</li>)}
              </ul>
            )
          case 'ol':
            return (
              <ol key={k} className="list-decimal pl-5 space-y-0.5">
                {b.content.map((c, i) => <li key={`${k}-${i}`}>{renderInline(c, `${k}-${i}`)}</li>)}
              </ol>
            )
          case 'code':
            return (
              <pre key={k} className="text-[11px] font-mono bg-surface-secondary text-foreground rounded p-2 overflow-x-auto">
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
                        <th key={i} className="text-left font-semibold py-1.5 px-2">{renderInline(c, `${k}-h${i}`)}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {b.cells!.slice(1).map((row, ri) => (
                      <tr key={ri} className="border-b border-border-default/50">
                        {row.map((c, ci) => (
                          <td key={ci} className="py-1.5 px-2 align-top">{renderInline(c, `${k}-${ri}-${ci}`)}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          default:
            return <p key={k} className="whitespace-pre-wrap">{renderInline(b.content.join('\n'), k)}</p>
        }
      })}
    </div>
  )
}
