import { randomUUID } from 'crypto'
import { normalizeDoc, validateDoc, type Block, type PageDoc, type PageKey } from '@jeffi/site-blocks'
import type { AiChatMessage } from '@/lib/shared/ai-client'
import { siteRegistry } from '../blocks'
import { CODE_SECTION, ONCE_COMPONENTS, checkPageParts, compileSection, countComponent, type CompiledSection } from '../code/compile'
import { CARD_PAGE } from '../code/ast'
import { CARD_KEY } from '../card'
import { chat, StudioAiDownError, StudioBudgetError, studioBudgetLeft } from './ai'
import { partsFor } from './library'
import { plannedPage, replanPage } from './plan'
import { cardLint, studioLint } from './lint'
import { cardSystem, cardUser, repairText, sectionSystem, sectionUser, tweakUser } from './prompts'
import type { PlannedPage, PlannedSection, StudioCtx, StudioEvent } from './types'
// Ready-made theme generation only (scripts/site-themes): both are empty outside its template mode.
import { templateLint, templateRules } from '../themes/template-rules'

// Page generation: each planned section is written as TSX by the model, compiled by the code engine and, when the
// compiler finds problems, sent back with them for repair (two rounds at most). A section that still fails is skipped
// and recorded. Parts the page needs that no section kept get a plain fallback section, so the page always works.

const REPAIRS = 2
const CONCURRENCY = 3
const MAX_TOKENS = 4500
/** The product card is one small component. */
const CARD_TOKENS = 2500

export { CODE_SECTION }

/** The TSX component in a model reply: the fenced block, else from the first export/function/JSX on; imports dropped. */
export function extractTsx(raw: string): string | null {
  const fenced = [...raw.matchAll(/```(?:tsx|jsx|typescript|ts|javascript|js)?\s*\n([\s\S]*?)(?:```|$)/gi)].map(m => m[1]).sort((a, b) => b.length - a.length)[0]
  let src = (fenced ?? raw).trim()
  if (!fenced) {
    const at = src.search(/export\s+default|function\s+[A-Z]|const\s+[A-Z]\w*\s*=|<[a-zA-Z]/)
    if (at < 0) return null
    src = src.slice(at)
  }
  // Library imports are optional and anything else is refused, so every import goes.
  src = src.replace(/^\s*import\s[\s\S]*?from\s*['"][^'"\n]+['"];?[ \t]*$/gm, '').replace(/^\s*import\s+['"][^'"\n]+['"];?[ \t]*$/gm, '').trim()
  if (!src) return null
  // A bare JSX tree (small models skip the wrapper) becomes the component.
  if (src.startsWith('<')) src = `export default function Section() {\n  return (\n${src}\n  )\n}`
  return src.length > 30_000 ? null : src
}

const issueText = (i: { message: string; line?: number }) => (i.line ? `line ${i.line}: ${i.message}` : i.message)

type Written = { ok: true; source: string; compiled: CompiledSection } | { ok: false; reason: string }

/** One section: write, compile, repair. Compile failures come back as { ok: false }; AI errors, budget and abort throw. */
async function writeSection(
  ctx: StudioCtx,
  messages: AiChatMessage[],
  page: PageKey,
  onRepair: (issues: string[]) => void,
  maxTokens = MAX_TOKENS
): Promise<Written> {
  let issues: string[] = []
  // A section that compiled but still hard-codes store data is kept if the repairs do not get it clean.
  let compiledOnce: Written | null = null
  for (let round = 0; round <= REPAIRS; round++) {
    if (ctx.signal?.aborted) throw new Error('Stopped')
    if (round > 0) onRepair(issues)
    const raw = await chat(messages, { maxTokens, temperature: round === 0 ? 0.85 : 0.3 })
    const source = extractTsx(raw)
    if (!source) issues = ['Reply with the component in one ```tsx code block: export default function Section() { return (...) }']
    else {
      const r = await compileSection(source, { page })
      if (r.ok) {
        const notes = (page === CARD_PAGE ? [...studioLint(r.section.ast, page), ...cardLint(r.section.ast)] : studioLint(r.section.ast, page)).concat(templateLint(r.section.ast, page))
        if (!notes.length) return { ok: true, source, compiled: r.section }
        compiledOnce = { ok: true, source, compiled: r.section }
        if (round === REPAIRS) return compiledOnce
        issues = notes
      } else issues = r.issues.map(issueText)
    }
    messages.push({ role: 'assistant', content: raw.slice(0, 30_000) }, { role: 'user', content: repairText(issues) })
  }
  return compiledOnce ?? { ok: false, reason: issues.slice(0, 3).join('; ') || 'could not compile' }
}

function codeBlock(label: string, source: string, compiled: CompiledSection, id: string = randomUUID()): Block {
  return { id, type: CODE_SECTION, v: siteRegistry.get(CODE_SECTION)?.v ?? 1, props: { label, source, compiled } }
}

// A plain section holding parts the page needs when no written section kept them.
function fallbackSource(parts: string[]): string {
  return `export default function Section() {
  return (
    <section className="mx-auto w-full max-w-6xl px-4 py-8 md:py-12">
      <div className="flex flex-col gap-6">
${parts.map(p => `        <${p} />`).join('\n')}
      </div>
    </section>
  )
}`
}

async function runLimited<T>(items: T[], limit: number, fn: (item: T, i: number) => Promise<void>) {
  let next = 0
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    for (let i = next++; i < items.length; i = next++) await fn(items[i], i)
  }))
}

/** The page's sections written as code sections, in plan order, ready for `web` and `web_mobile` alike. */
export async function generatePage(ctx: StudioCtx, page: PlannedPage | string, onEvent: (e: StudioEvent) => void = () => {}): Promise<PageDoc> {
  const p = plannedPage(ctx.plan, page)
  if (!p) throw new Error(`No page ${String(page)} in the plan`)
  // Out of budget before the page starts: stop the build here (a page that runs out midway keeps what it has).
  if (studioBudgetLeft() <= 0) throw new StudioBudgetError()
  const total = p.sections.length
  onEvent({ type: 'page', page: p.key, label: p.label, sections: total })
  const blocks: (Block | null)[] = new Array(total).fill(null)
  const skipped: { label: string; reason: string }[] = []
  let budgetOut = false
  try {
    await runLimited(p.sections, CONCURRENCY, async (s: PlannedSection, index) => {
      if (budgetOut) {
        skipped.push({ label: s.label, reason: 'The free generation budget is spent' })
        onEvent({ type: 'section', page: p.key, index, total, label: s.label, status: 'skipped', issues: ['budget'] })
        return
      }
      onEvent({ type: 'section', page: p.key, index, total, label: s.label, status: 'writing' })
      const messages: AiChatMessage[] = [
        { role: 'system', content: sectionSystem(p.page, ctx.direction) + templateRules(p.page) },
        { role: 'user', content: sectionUser(ctx.brief, ctx.direction, p, s, index) },
      ]
      let r: Written
      try {
        r = await writeSection(ctx, messages, p.page, issues => onEvent({ type: 'section', page: p.key, index, total, label: s.label, status: 'repairing', issues }))
      } catch (err) {
        if (err instanceof StudioBudgetError) budgetOut = true
        else if (err instanceof StudioAiDownError || ctx.signal?.aborted) throw err
        r = { ok: false, reason: (err as Error).message?.slice(0, 200) ?? 'AI error' }
      }
      if (r.ok) {
        blocks[index] = codeBlock(s.label, r.source, r.compiled)
        onEvent({ type: 'section', page: p.key, index, total, label: s.label, status: 'done' })
      } else {
        skipped.push({ label: s.label, reason: r.reason })
        onEvent({ type: 'section', page: p.key, index, total, label: s.label, status: 'skipped', issues: [r.reason] })
      }
    })
  } catch (err) {
    onEvent({ type: 'error', page: p.key, message: (err as Error).message?.slice(0, 200) ?? 'Stopped' })
    throw err
  }

  const kept = blocks.filter((b): b is Block => !!b)
  if (!kept.length && total) onEvent({ type: 'error', page: p.key, message: `No section could be written: ${skipped[0]?.reason ?? 'unknown'}` })
  const doc = await withRequiredParts(kept, p, skipped)
  onEvent({ type: 'done', page: p.key, doc, skipped })
  return doc
}

const compiledOf = (b: Block) => b.props.compiled as CompiledSection | undefined

/**
 * The doc for the kept blocks, held to the page rules: a once-only part (the payment step) stays in the first section
 * that has it, and parts the page must have that no section kept go into a plain fallback section.
 */
async function withRequiredParts(kept: Block[], p: PlannedPage, skipped: { label: string; reason: string }[]): Promise<PageDoc> {
  const list: Block[] = []
  const seen = new Set<string>()
  for (const b of kept) {
    const ast = compiledOf(b)?.ast
    const once = [...ONCE_COMPONENTS].filter(n => countComponent(ast, n) > 0)
    if (once.some(n => seen.has(n))) {
      skipped.push({ label: String(b.props.label), reason: `repeats <${once.join(', ')} />, which the page has once` })
      continue
    }
    once.forEach(n => seen.add(n))
    list.push(b)
  }
  const used = new Set(list.flatMap(b => compiledOf(b)?.components ?? []))
  const missing = p.required.filter(x => !used.has(x))
  if (missing.length) {
    const source = fallbackSource(missing)
    const r = await compileSection(source, { page: p.page })
    if (r.ok) list.push(codeBlock(missing.join(', '), source, r.section))
    else skipped.push({ label: 'Required parts', reason: r.issues.map(issueText).join('; ').slice(0, 300) })
  }
  const doc = normalizeDoc({ blocks: Object.fromEntries(list.map(b => [b.id, b])), order: list.map(b => b.id) })
  for (const i of checkPageParts(doc, p.page, null)) skipped.push({ label: 'Page', reason: i.message })
  const v = validateDoc(doc, siteRegistry, { audience: p.audience, surface: 'web', page: p.page })
  for (const i of v.issues) skipped.push({ label: String(list.find(b => b.id === i.blockId)?.props.label ?? 'Section'), reason: i.message })
  return v.doc
}

/** A page planned again and written again: a different set of sections, not a reshuffle. Returns both. */
export async function regeneratePage(ctx: StudioCtx, page: PlannedPage | string, onEvent?: (e: StudioEvent) => void): Promise<{ page: PlannedPage; doc: PageDoc }> {
  const current = plannedPage(ctx.plan, page)
  if (!current) throw new Error(`No page ${String(page)} in the plan`)
  const fresh = (await replanPage(ctx.brief, ctx.plan, current.key)) ?? current
  const plan = { ...ctx.plan, pages: ctx.plan.pages.map(x => (x.key === fresh.key ? fresh : x)) }
  return { page: fresh, doc: await generatePage({ ...ctx, plan }, fresh, onEvent) }
}

/**
 * The site's product card (lib/site/card.ts), written for the direction and the owner's style: a `card` page holding
 * one code section, saved under CARD_KEY. Throws when it could not be written; the store's ProductCard stands in.
 */
export async function generateCard(ctx: StudioCtx): Promise<PageDoc> {
  if (studioBudgetLeft() <= 0) throw new StudioBudgetError()
  const messages: AiChatMessage[] = [
    { role: 'system', content: cardSystem(ctx.direction) + templateRules(CARD_PAGE) },
    { role: 'user', content: cardUser(ctx.brief, ctx.direction) },
  ]
  const r = await writeSection(ctx, messages, CARD_PAGE, () => {}, CARD_TOKENS)
  if (!r.ok) throw new Error(`The product card could not be written: ${r.reason}`)
  const block = codeBlock('Product card', r.source, r.compiled)
  const v = validateDoc(normalizeDoc({ blocks: { [block.id]: block }, order: [block.id] }), siteRegistry, { audience: 'store', surface: 'web', page: CARD_PAGE })
  if (!v.doc.order.length) throw new Error(`The product card was refused: ${v.issues[0]?.message ?? 'invalid'}`)
  return v.doc
}

/** The page a code section belongs on: the given one, else the first planned page that allows all its parts. */
function pageForBlock(ctx: StudioCtx, block: Block, page?: PlannedPage | string): PageKey {
  if (page === CARD_KEY || page === CARD_PAGE) return CARD_PAGE
  const given = page ? plannedPage(ctx.plan, page) : null
  if (given) return given.page
  const used = compiledOf(block)?.components ?? []
  return ctx.plan.pages.find(x => used.every(c => partsFor(x.page).includes(c)))?.page ?? 'home'
}

/**
 * One code section changed as the owner asks (same block id). `page` (a plan key or page) tells the compiler which
 * parts are allowed; without it the first planned page that allows the section's parts is used.
 */
export async function tweakSection(ctx: StudioCtx, block: Block, instruction: string, page?: PlannedPage | string): Promise<Block> {
  const label = String(block.props.label ?? 'Section')
  const source = String(block.props.source ?? '')
  if (!source) throw new Error('That block has no code to change')
  const key = pageForBlock(ctx, block, page)
  const messages: AiChatMessage[] = [
    { role: 'system', content: sectionSystem(key, ctx.direction) },
    { role: 'user', content: tweakUser(ctx.brief, ctx.direction, label, source, instruction.trim().slice(0, 1000)) },
  ]
  const r = await writeSection(ctx, messages, key, () => {})
  if (!r.ok) throw new Error(`The AI could not make that change: ${r.reason}`)
  return codeBlock(label, r.source, r.compiled, block.id)
}
