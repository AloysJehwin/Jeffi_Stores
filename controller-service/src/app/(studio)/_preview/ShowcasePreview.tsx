import { cssVarsRule, googleFontsHref, normalizeTheme, themeCssVars, topBlocks } from '@jeffi/site-blocks'
import type { CompiledSection } from '@/lib/site/code/compile'
import CodeSection, { planSections } from '@/components/visitor/site/code/CodeSection'
import SiteEditorLazy from '@/components/visitor/site/editor/SiteEditorLazy'
import { canvasCodeSections } from '@/lib/site/code/compile'
import PhotoCredits from '@/components/visitor/site/PhotoCredits'
import { pageCredits, pictureCredits } from '@/lib/ai/stock-credits'
import { runWithSiteData } from '@/lib/site/data'
import { showcaseSiteData } from '@/lib/showcase/site-data'
import { emptyShowcaseContent, SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'
import type { StudioSession } from '@controller/lib/site-studio/sessions'
import { previewView, sessionShowcase } from '@controller/lib/showcase-builder/site'
import PreviewBridge from './PreviewBridge'

// The studio's preview of a Showcase's one page: its code sections over its site's own details and content (the
// draft site), in the session's look, with the lead form inert. Marked up as the store's preview is, so the bridge's
// picking and arranging work the same. `editing`: the visual editor's canvas, its elements carrying their node ids
// (canvasCodeSections) and its bridge loaded.

export default async function ShowcasePreview({ session, editing = false }: { session: StudioSession; editing?: boolean }) {
  const site = await sessionShowcase(session).catch(() => null)
  const brief = session.brief as { storeName?: string } | null
  const view = previewView(site ?? { business: { name: brief?.storeName ?? 'Your business' }, content: emptyShowcaseContent() })
  const data = showcaseSiteData(view)
  const stored = session.pages?.[SHOWCASE_PAGE_KEY]
  const doc = stored && editing ? canvasCodeSections(stored, 'showcase') : stored
  const theme = normalizeTheme(session.theme ?? (session.direction as { theme?: object } | null)?.theme ?? site?.theme ?? null)
  const css = `${cssVarsRule('.studio-preview.studio-preview', themeCssVars(theme))}
.studio-preview{font-family:var(--font-body),system-ui,sans-serif;background:var(--color-surface);color:var(--color-foreground);min-height:100vh}
.studio-picking .studio-block{cursor:pointer}
.studio-picking .studio-block:hover{outline:2px dashed #c46a46;outline-offset:-2px}
[data-studio-selected]{outline:3px solid #c46a46;outline-offset:-3px}
html{scroll-behavior:smooth}`

  const blocks = doc ? topBlocks(doc).filter(b => b.type === 'code_section' && b.props.compiled && !b.visibility?.hidden) : []
  // As the live page draws them (showcase-service): header and opening always, links only to sections that draw.
  const plan = await planSections(blocks.map(b => b.props.compiled as CompiledSection), data)
  const body = await runWithSiteData(data, async () =>
    blocks.length ? (
      <main>
        {blocks.map((b, i) => (
          <div key={b.id} data-studio-block={b.id} data-block-id={editing ? b.id : undefined} data-studio-page={SHOWCASE_PAGE_KEY} data-studio-label={String(b.props.label ?? 'Section')} className="studio-block">
            <CodeSection section={b.props.compiled as CompiledSection} id={b.id} page="showcase" data={data} priority={i === 0} always={editing || plan.always[i]} anchors={plan.anchors} preview={editing} />
          </div>
        ))}
      </main>
    ) : (
      <div className="flex min-h-[60vh] items-center justify-center px-6 text-center text-sm text-foreground-muted">Your page appears here once it is designed.</div>
    )
  )

  return (
    <>
      <link rel="stylesheet" href={googleFontsHref(theme)} />
      <style dangerouslySetInnerHTML={{ __html: css }} />
      <div className="studio-preview">
        {body}
        <PhotoCredits credits={[...pictureCredits(site?.content.pictures), ...pageCredits(stored)]} className="px-4 py-4 text-center text-xs text-foreground-muted" />
      </div>
      <PreviewBridge audience="store" pages={[SHOWCASE_PAGE_KEY]} />
      {editing && <SiteEditorLazy />}
    </>
  )
}
