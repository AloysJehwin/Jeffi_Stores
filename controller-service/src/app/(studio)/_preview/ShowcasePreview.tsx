import { cssVarsRule, googleFontsHref, normalizeTheme, themeCssVars, topBlocks } from '@jeffi/site-blocks'
import type { CompiledSection } from '@/lib/site/code/compile'
import CodeSection from '@/components/visitor/site/code/CodeSection'
import { runWithSiteData } from '@/lib/site/data'
import { showcaseSiteData } from '@/lib/showcase/site-data'
import { getShowcaseByOwner } from '@/lib/showcase/store'
import { emptyShowcaseContent, SHOWCASE_PAGE_KEY } from '@/lib/showcase/types'
import type { StudioSession } from '@controller/lib/site-studio/sessions'
import { previewView } from '@controller/lib/showcase-builder/site'
import PreviewBridge from './PreviewBridge'

// The studio's preview of a Showcase's one page: its code sections over the owner's own details and content (the
// draft site), in the session's look, with the lead form inert. Marked up as the store's preview is, so the bridge's
// picking and arranging work the same.

export default async function ShowcasePreview({ session }: { session: StudioSession }) {
  const site = await getShowcaseByOwner(session.owner_id).catch(() => null)
  const brief = session.brief as { storeName?: string } | null
  const view = previewView(site ?? { business: { name: brief?.storeName ?? 'Your business' }, content: emptyShowcaseContent() })
  const data = showcaseSiteData(view)
  const doc = session.pages?.[SHOWCASE_PAGE_KEY]
  const theme = normalizeTheme(session.theme ?? (session.direction as { theme?: object } | null)?.theme ?? site?.theme ?? null)
  const css = `${cssVarsRule('.studio-preview.studio-preview', themeCssVars(theme))}
.studio-preview{font-family:var(--font-body),system-ui,sans-serif;background:var(--color-surface);color:var(--color-foreground);min-height:100vh}
.studio-picking .studio-block{cursor:pointer}
.studio-picking .studio-block:hover{outline:2px dashed #c46a46;outline-offset:-2px}
[data-studio-selected]{outline:3px solid #c46a46;outline-offset:-3px}
html{scroll-behavior:smooth}`

  const blocks = doc ? topBlocks(doc).filter(b => b.type === 'code_section' && b.props.compiled && !b.visibility?.hidden) : []
  const body = await runWithSiteData(data, async () =>
    blocks.length ? (
      <main>
        {blocks.map((b, i) => (
          <div key={b.id} data-studio-block={b.id} data-studio-page={SHOWCASE_PAGE_KEY} data-studio-label={String(b.props.label ?? 'Section')} className="studio-block">
            <CodeSection section={b.props.compiled as CompiledSection} id={b.id} page="showcase" data={data} priority={i === 0} always={i === 0} />
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
      <div className="studio-preview">{body}</div>
      <PreviewBridge audience="store" pages={[SHOWCASE_PAGE_KEY]} />
    </>
  )
}
