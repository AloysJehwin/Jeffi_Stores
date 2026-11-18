import { randomUUID } from 'crypto'
import { NextRequest, NextResponse } from 'next/server'
import { insertBlock, isPageKey, moveBlock, removeBlock, updateBlock, type PageDoc, type PageKey } from '@jeffi/site-blocks'
import { checkPageParts, compileSection } from '@/lib/site/code/compile'
import { codeLiterals, editCodeLiterals, LiteralEditError, type CodeLiteral, type LiteralEdit } from '@/lib/site/code/literals'
import { fail, readJson, studioOf, studioView } from '@controller/lib/site-studio/http'
import { buildRunning, saveStudioPage } from '@controller/lib/site-studio/sessions'
import { reload } from '@controller/lib/site-studio/build'
import { SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'

export const dynamic = 'force-dynamic'

// The owner arranging the studio's site by hand: move, copy, hide or delete a section, or change its words, links and
// pictures. Free (no AI, not counted against the day's changes) and not while a build runs. The page must keep the
// parts it needs to work (add to cart, the product results, the payment step…) in a shown section.
// GET ?page=store:home&blockId=: the section's editable words, links and pictures.
// POST { page, blockId, op: 'move' (before: id | null) | 'duplicate' | 'hide' (hidden) | 'delete' | 'content' (edits) }.

const NOT_THERE = 'That section is not on the page any more. Reload the preview.'
// `store:home` → home; a Showcase's one page (showcase:home) → showcase.
const pageOf = (key: string): PageKey | null => {
  if (key === SHOWCASE_PAGE_KEY) return 'showcase'
  const p = key.split(':')[1] ?? ''
  return isPageKey(p) ? p : null
}
const partName = (m: string) => (m.match(/<([A-Z]\w*)/)?.[1] ?? 'a part').replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase()
const isEdit = (e: unknown): e is LiteralEdit =>
  !!e && typeof e === 'object' && ['id', 'from', 'to'].every(k => typeof (e as Record<string, unknown>)[k] === 'string')

export async function GET(request: NextRequest) {
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const q = request.nextUrl.searchParams
  const block = ctx.session.pages?.[q.get('page') ?? '']?.blocks?.[q.get('blockId') ?? '']
  if (!block || block.type !== 'code_section') return fail(NOT_THERE, 404)
  return NextResponse.json({ literals: codeLiterals(String(block.props.source ?? '')) })
}

export async function POST(request: NextRequest) {
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const { session } = ctx
  const body = await readJson(request)
  const key = typeof body?.page === 'string' ? body.page : ''
  const blockId = typeof body?.blockId === 'string' ? body.blockId : ''
  const doc = session.pages?.[key]
  const page = pageOf(key)
  const block = doc?.blocks?.[blockId]
  if (!doc || !block || !page || !doc.order.includes(blockId)) return fail(NOT_THERE, 404)
  if (buildRunning(session)) return fail('Your site is being built. Wait for it to finish first.', 409, { code: 'running' })
  const shown = doc.order.filter(id => !doc.blocks[id]?.visibility?.hidden)

  let next: PageDoc
  let literals: CodeLiteral[] | undefined
  switch (body?.op) {
    case 'move': {
      const before = typeof body.before === 'string' && body.before !== blockId && doc.order.includes(body.before) ? body.before : null
      const rest = doc.order.filter(id => id !== blockId)
      next = moveBlock(doc, blockId, before ? rest.indexOf(before) : rest.length)
      break
    }
    case 'duplicate': {
      const label = `${String(block.props.label ?? 'Section')} (copy)`.slice(0, 80)
      next = insertBlock(doc, { ...structuredClone(block), id: randomUUID(), props: { ...structuredClone(block.props), label } }, doc.order.indexOf(blockId) + 1)
      break
    }
    case 'hide': {
      const hidden = body.hidden === true
      if (hidden && shown.length <= 1 && shown.includes(blockId)) return fail('A page keeps at least one section showing.')
      next = updateBlock(doc, blockId, { visibility: hidden ? { ...block.visibility, hidden: true } : { ...block.visibility, hidden: false } })
      break
    }
    case 'delete': {
      if (doc.order.length <= 1) return fail('A page keeps at least one section. Change it, or design the page again.')
      next = removeBlock(doc, blockId)
      break
    }
    case 'content': {
      const edits = Array.isArray(body.edits) ? body.edits.filter(isEdit).slice(0, 50) : []
      if (!edits.length || block.type !== 'code_section') return fail('Nothing to change.')
      let source: string
      try {
        source = editCodeLiterals(String(block.props.source ?? ''), edits)
      } catch (err) {
        if (err instanceof LiteralEditError) return fail(err.message, 422)
        throw err
      }
      const r = await compileSection(source, { page })
      if (!r.ok) return fail(`That change doesn’t fit the section: ${r.issues[0]?.message ?? 'it no longer works'}`, 422)
      next = updateBlock(doc, blockId, { props: { ...block.props, source, compiled: r.section } })
      literals = codeLiterals(source)
      break
    }
    default:
      return fail('Unknown change.')
  }

  const issues = checkPageParts(next, page, null)
  if (issues.length) {
    const op = body?.op
    return fail(
      op === 'delete' || op === 'hide'
        ? `This section holds ${partName(issues[0].message)}, which the page needs to work, so it can’t be ${op === 'delete' ? 'deleted' : 'hidden'}. Change it instead.`
        : op === 'duplicate'
          ? `This section holds ${partName(issues[0].message)}, which a page has only once, so it can’t be copied.`
          : issues[0].message,
      422
    )
  }
  await saveStudioPage(session.id, key, next)
  return NextResponse.json({ ...studioView(await reload(session.id)), page: key, blockId, ...(literals ? { literals } : {}) })
}
