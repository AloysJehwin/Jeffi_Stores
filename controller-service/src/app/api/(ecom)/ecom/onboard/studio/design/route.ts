import { NextRequest, NextResponse } from 'next/server'
import { normalizeDoc, validateDoc, type PageDoc } from '@jeffi/site-blocks'
import { siteRegistry } from '@/lib/site/blocks'
import { CodeSectionInvalid, recompileCodeSections, upgradeCodeSections } from '@/lib/site/code/compile'
import { siteEditorEnabled } from '@/lib/site/store'
import { SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'
import { fail, readJson, studioOf, studioOwner } from '@controller/lib/site-studio/http'
import { buildRunning, saveStudioPage } from '@controller/lib/site-studio/sessions'

export const dynamic = 'force-dynamic'

// The visual editor (docs/plans/SITE_EDITOR_PLAN.md) on a Showcase's page, while site_settings site_editor_enabled is
// on. The session is the request's (`?product=showcase&site=`), so each site edits its own.
// GET ?check=1: { enabled }. GET: { doc }, the page with its code sections as v2 trees.
// PUT { doc }: saves the page. Every tree is printed and compiled again (compileCodeProps), and the page must keep
// the parts it needs; the saved page comes back. Free, like arranging by hand, and not while a build runs.

const KEY = SHOWCASE_PAGE_KEY
const REF = { audience: 'store', surface: 'web', page: 'showcase' } as const

export async function GET(request: NextRequest) {
  if (request.nextUrl.searchParams.get('check')) {
    const owner = await studioOwner(request)
    if (owner instanceof NextResponse) return owner
    return NextResponse.json({ enabled: await siteEditorEnabled().catch(() => false) })
  }
  if (!(await siteEditorEnabled())) return fail('The visual editor is not switched on', 404)
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  if (ctx.session.product !== 'showcase') return fail('The visual editor works on a Showcase page', 400)
  const doc = ctx.session.pages?.[KEY]
  if (!doc) return fail('Your page is not designed yet', 404)
  return NextResponse.json({ doc: upgradeCodeSections(normalizeDoc(doc), 'showcase') })
}

export async function PUT(request: NextRequest) {
  if (!(await siteEditorEnabled())) return fail('The visual editor is not switched on', 404)
  const ctx = await studioOf(request)
  if (ctx instanceof NextResponse) return ctx
  const { session } = ctx
  if (session.product !== 'showcase') return fail('The visual editor works on a Showcase page', 400)
  if (buildRunning(session)) return fail('Your site is being built. Wait for it to finish first.', 409, { code: 'running' })
  const body = await readJson(request)
  const v = validateDoc(body?.doc, siteRegistry, REF)
  if (!v.ok) return fail(v.issues[0]?.message ?? 'That page could not be read', 400)
  if (Object.values(v.doc.blocks).some(b => b.type !== 'code_section')) return fail('A Showcase page holds code sections only', 400)
  if (!v.doc.order.length) return fail('Your page keeps at least one section', 400)
  let doc: PageDoc
  try {
    doc = await recompileCodeSections(v.doc, { page: 'showcase', coreType: null })
  } catch (err) {
    if (err instanceof CodeSectionInvalid) return fail(err.issues[0]?.message ?? 'That change does not fit the page', 422)
    throw err
  }
  await saveStudioPage(session.id, KEY, doc)
  return NextResponse.json({ doc })
}
